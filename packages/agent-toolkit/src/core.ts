/**
 * The Rendobar tools, framework-neutral. Each adapter (`./ai-sdk`, ...) wraps
 * these four in its framework's tool shape and adds nothing else, so every
 * framework sees the same tools with the same behaviour.
 *
 * The verbs match Rendobar's MCP server, so an agent behaves the same through
 * either. Descriptions never list job types: `list_job_types` reads the live
 * registry, so a new job type reaches every agent with no release.
 */
import { createClient, isApiError, outputUrl, WaitTimeoutError, type RendobarClient } from "@rendobar/sdk";
import { z } from "zod";
import { VERSION } from "./version.js";

export type ToolkitOptions = {
  /** A configured client. Defaults to `createClient()`, which reads RENDOBAR_API_KEY. */
  client?: RendobarClient;
  /**
   * API base URL. Default https://api.rendobar.com. Used for the client the
   * toolkit builds and for the job-type schema endpoint, so pass the same one
   * your own `client` uses when you pass both.
   */
  baseUrl?: string;
};

export type ToolDefinition<I extends z.ZodType> = {
  name: string;
  description: string;
  input: I;
  run: (input: z.infer<I>) => Promise<unknown>;
};

/** Types a tool from its own input schema. */
function define<I extends z.ZodType>(d: ToolDefinition<I>): ToolDefinition<I> {
  return d;
}

/** What an agent needs from a job, and nothing it would have to wade through. */
function summarize(job: Awaited<ReturnType<RendobarClient["jobs"]["get"]>>): Record<string, unknown> {
  const out: Record<string, unknown> = { id: job.id, type: job.type, status: job.status };
  if (job.status === "complete") {
    out.url = outputUrl(job) ?? null;
    out.files = job.output.files.map((f) => ({ url: f.url, type: f.type, path: f.path, size: f.size }));
    if (job.output.data !== null) out.data = job.output.data;
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

export function rendobarToolDefinitions(options: ToolkitOptions = {}) {
  // A client the caller built keeps its own attribution. Ours names this package, not the SDK.
  const baseUrl = options.baseUrl ?? "https://api.rendobar.com";
  const rb = options.client ?? createClient({ client: `agent-toolkit/${VERSION}`, baseUrl });

  const listJobTypes = define({
    name: "list_job_types",
    description:
      "List what Rendobar can do right now: every live media job type (video, audio, image, captions, compose, AI generation) with its use cases. Pass `type` to get that type's full params schema. Call this before run_job.",
    input: z.object({ type: z.string().optional().describe("A job type from the list, to get its params schema") }),
    run: ({ type }) =>
      guarded(async () => {
        if (type === undefined) return (await rb.jobs.types()).map((t) => ({ type: t.type, summary: t.summary, useCases: t.useCases }));
        const res = await fetch(`${baseUrl}/jobs/types/${encodeURIComponent(type)}/schema`);
        if (res.status === 404) return { error: { code: "NOT_FOUND", message: `Job type "${type}" is not live. Call list_job_types.` } };
        if (!res.ok) return { error: { code: "REQUEST_FAILED", message: `The schema endpoint answered ${res.status}. The call can be retried.` } };
        const body: unknown = await res.json();
        return body;
      }),
  });

  const runJob = define({
    name: "run_job",
    description:
      "Run a Rendobar media job and return its result: status, output URL, files and data. Waits until the job finishes unless `wait` is false. Get valid `type` values and params from list_job_types first. URLs in params or inputs must be public or signed.",
    input: z.object({
      type: z.string().describe("Job type, from list_job_types"),
      params: z.record(z.string(), z.unknown()).default({}).describe("Params for this job type, per its schema"),
      inputs: z.record(z.string(), z.unknown()).optional().describe("Named input files, as URLs"),
      wait: z.boolean().default(true).describe("Wait for the job to finish. False returns the created job at once"),
    }),
    run: ({ type, params, inputs, wait }) =>
      guarded(async () => {
        const body = inputs === undefined ? { type, params } : { type, params, inputs };
        if (!wait) return await rb.jobs.create(body);
        return summarize(await rb.jobs.run(body, { throwOnFailure: false }));
      }),
  });

  const getJob = define({
    name: "get_job",
    description: "Get a Rendobar job's current status and, once complete, its output URL, files and data.",
    input: z.object({ id: z.string().describe("Job id, such as job_abc123") }),
    run: ({ id }) => guarded(async () => summarize(await rb.jobs.get(id))),
  });

  const probeMedia = define({
    name: "probe_media",
    description: "Inspect a media file by URL: duration, format, streams, codecs, resolution, frame rate. Runs as a short ffprobe job, billed like any other job.",
    input: z.object({ url: z.string().url().describe("Public or signed URL of the media file") }),
    run: ({ url }) =>
      guarded(async () => summarize(await rb.jobs.run({ type: "ffprobe", params: { command: url } }, { throwOnFailure: false }))),
  });

  return { list_job_types: listJobTypes, run_job: runJob, get_job: getJob, probe_media: probeMedia };
}
