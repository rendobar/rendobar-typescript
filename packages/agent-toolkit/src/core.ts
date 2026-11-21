/**
 * The Rendobar tools, framework-neutral. Each adapter (`./ai-sdk`, ...) wraps
 * these four in its framework's tool shape and adds nothing else, so every
 * framework sees the same tools with the same behaviour.
 *
 * list_job_types, get_job and probe_media share their names with Rendobar's MCP
 * server. run_job is MCP's submit_job plus the wait for the result. Descriptions
 * never list job types: `list_job_types` reads the live registry, so a new job
 * type reaches every agent with no release.
 *
 * Optional inputs are `.optional()`, never `.default()`: a default makes a field
 * required in a schema converted for output (LangChain's OpenAI conversion) and
 * optional in one converted for input (the AI SDK, Mastra), so the model would
 * see a different contract per framework.
 */
import { createClient, isApiError, outputUrl, WaitTimeoutError, type RendobarClient } from "@rendobar/sdk";
import { z } from "zod";
import { VERSION } from "./version.js";

export type ToolkitOptions = {
  /**
   * A configured client, for any other key, server, timeout or retry setting.
   * Defaults to a client that reads RENDOBAR_API_KEY.
   */
  client?: RendobarClient;
};

export type ToolDefinition<I extends z.ZodType> = {
  name: string;
  description: string;
  input: I;
  run: (input: z.infer<I>) => Promise<unknown>;
};

function isCreated(value: unknown): value is { id: string; status: string } {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" && !("error" in value);
}

/** Types a tool from its own input schema. */
function define<I extends z.ZodType>(d: ToolDefinition<I>): ToolDefinition<I> {
  return d;
}

type Job = Awaited<ReturnType<RendobarClient["jobs"]["get"]>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * An ffprobe result carries a `summary` and ffprobe's own raw sections, which
 * repeat it at several times the size. The model gets the summary unless it
 * asked for raw. Output in another shape (a non-JSON writer, no summary) is what
 * the command asked for and passes through whole.
 */
function modelData(type: string, data: unknown, raw: boolean): { data: unknown; trimmed: boolean } {
  if (raw || type !== "ffprobe" || !isRecord(data) || !("summary" in data)) return { data, trimmed: false };
  const { summary, warnings, reportUrl } = data;
  return {
    data: { summary, ...(warnings === undefined ? {} : { warnings }), ...(reportUrl === undefined ? {} : { reportUrl }) },
    trimmed: true,
  };
}

/** What an agent needs from a job, and nothing it would have to wade through. */
function summarize(job: Job, raw: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { id: job.id, type: job.type, status: job.status };
  if (job.status === "complete") {
    out.url = outputUrl(job) ?? null;
    out.files = job.output.files.map((f) => ({ url: f.url, type: f.type, path: f.path, size: f.size }));
    if (job.output.data !== null) {
      const { data, trimmed } = modelData(job.type, job.output.data, raw);
      out.data = data;
      if (trimmed) out.hint = "This is ffprobe's summary. For its full raw output, call get_job with this id and raw: true.";
    }
  }
  if (job.status === "failed") out.error = { code: job.error.code, message: job.error.message };
  if (job.cost) out.cost = job.cost.formatted;
  return out;
}

/**
 * Errors go back to the model as data it can act on, never as a thrown stack.
 * Every kind, not only API refusals: a wait that runs out or a dropped
 * connection would otherwise end the agent's whole loop.
 */
async function guarded(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (e) {
    if (isApiError(e)) return { error: { code: e.code, message: e.message, requestId: e.requestId ?? null } };
    if (e instanceof WaitTimeoutError) {
      return { id: e.jobId, status: e.lastStatus, error: { code: "WAIT_TIMEOUT", message: `${e.message} Call get_job with this id later.` } };
    }
    const message = (e instanceof Error ? e.message : String(e)).replace(/\.?$/, ".");
    return { error: { code: "REQUEST_FAILED", message: `${message} The call can be retried.` } };
  }
}

/**
 * Waits for a job that already exists. Any failure from here on comes back with
 * the job id and a pointer to get_job, never "retry": resubmitting would create
 * and bill a second job, because each submit carries its own idempotency key.
 */
async function waitFor(rb: RendobarClient, id: string): Promise<unknown> {
  try {
    return summarize(await rb.jobs.wait(id, { throwOnFailure: false }), false);
  } catch (e) {
    const status = e instanceof WaitTimeoutError ? e.lastStatus : "unknown";
    const message = (e instanceof Error ? e.message : String(e)).replace(/\.?$/, ".");
    return { id, status, error: { code: e instanceof WaitTimeoutError ? "WAIT_TIMEOUT" : "WAIT_FAILED", message }, hint: "The job exists. Call get_job with this id. Do not submit it again." };
  }
}

/** `sdk_` plus 32 hex characters, the same shape the SDK and the Python agents use. */
function newIdempotencyKey(): string {
  return `sdk_${crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * Submits a job. A failure before the job exists comes back with the key it
 * used: a lost response may hide a created job, and only the same key makes a
 * retry return that job instead of billing a second one. A refusal (a 4xx other
 * than 429) created nothing and carries no key: the call itself must change.
 */
async function submit(rb: RendobarClient, body: Parameters<RendobarClient["jobs"]["create"]>[0]): Promise<unknown> {
  const idempotencyKey = body.idempotencyKey ?? newIdempotencyKey();
  try {
    return await rb.jobs.create({ ...body, idempotencyKey });
  } catch (e) {
    if (isApiError(e) && e.statusCode < 500 && e.statusCode !== 429) {
      const refusal = { error: { code: e.code, message: e.message, requestId: e.requestId ?? null } };
      // The API's message names its REST route. The model's way to the list is this toolkit's tool.
      return e.code === "INVALID_JOB_TYPE" ? { ...refusal, hint: "Call list_job_types for the live job types." } : refusal;
    }
    const code = isApiError(e) ? e.code : "REQUEST_FAILED";
    const message = (e instanceof Error ? e.message : String(e)).replace(/\.?$/, ".");
    return { error: { code, message: `${message} The call can be retried with this idempotencyKey.` }, idempotencyKey };
  }
}

export function rendobarToolDefinitions(options: ToolkitOptions = {}) {
  // A client the caller built keeps its own attribution. Ours names this package, not the SDK.
  const rb = options.client ?? createClient({ client: `agent-toolkit/${VERSION}` });

  const listJobTypes = define({
    name: "list_job_types",
    description:
      "List what Rendobar can do right now: every live media job type (video, audio, image, captions, compose, AI generation) with its use cases. Pass `type` to get that type's full params schema. Call this before run_job.",
    input: z.object({ type: z.string().optional().describe("A job type from the list, to get its params schema") }),
    run: ({ type }) =>
      guarded(async () => {
        if (type === undefined) return (await rb.jobs.types()).map((t) => ({ type: t.type, summary: t.summary, useCases: t.useCases }));
        try {
          return await rb.jobs.typeSchema(type);
        } catch (e) {
          if (isApiError(e) && e.statusCode === 404) return { error: { code: "NOT_FOUND", message: `Job type "${type}" is not live. Call list_job_types.` } };
          throw e;
        }
      }),
  });

  const runJob = define({
    name: "run_job",
    description:
      "Run a Rendobar media job and return its result: status, output URL, files and data. Waits until the job finishes unless `wait` is false. Get valid `type` values and params from list_job_types first. URLs in params or inputs must be public or signed.",
    input: z.object({
      type: z.string().describe("Job type, from list_job_types"),
      params: z.record(z.string(), z.unknown()).optional().describe("Params for this job type, per its schema. Omitted means {}"),
      inputs: z.record(z.string(), z.unknown()).optional().describe("Named input files, as URLs"),
      wait: z.boolean().optional().describe("Wait for the job to finish (the default). False returns the created job at once"),
      idempotencyKey: z
        .string()
        .optional()
        .describe(
          "Reuse the key a failed run_job returned to retry it with the same type, params and inputs, without creating a second job. Omit on a first call",
        ),
    }),
    run: async ({ type, params, inputs, wait, idempotencyKey }) => {
      const body = { type, params: params ?? {}, ...(inputs === undefined ? {} : { inputs }), ...(idempotencyKey === undefined ? {} : { idempotencyKey }) };
      // Only the submit may be retried by the model. Once a job exists, failures say so.
      const created = await submit(rb, body);
      if (!isCreated(created)) return created;
      return wait === false ? created : waitFor(rb, created.id);
    },
  });

  const getJob = define({
    name: "get_job",
    description:
      "Get a Rendobar job's current status and, once complete, its output URL, files and data. An ffprobe job returns its summary unless `raw` is true.",
    input: z.object({
      id: z.string().describe("Job id, such as job_abc123"),
      raw: z.boolean().optional().describe("Return the job's full output data, such as every raw ffprobe section. Off by default"),
    }),
    run: ({ id, raw }) => guarded(async () => summarize(await rb.jobs.get(id), raw === true)),
  });

  const probeMedia = define({
    name: "probe_media",
    description: "Inspect a media file by URL: duration, format, streams, codecs, resolution, frame rate. Runs as a short ffprobe job, billed like any other job.",
    input: z.object({ url: z.string().url().describe("Public or signed URL of the media file") }),
    run: async ({ url }) => {
      const created = await submit(rb, { type: "ffprobe", params: { command: url } });
      return isCreated(created) ? waitFor(rb, created.id) : created;
    },
  });

  return { list_job_types: listJobTypes, run_job: runJob, get_job: getJob, probe_media: probeMedia };
}
