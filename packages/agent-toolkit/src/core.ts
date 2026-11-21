/**
 * The Rendobar tools, framework-neutral. Each adapter (`./ai-sdk`, ...) wraps
 * these four in its framework's tool shape. Every adapter hands the framework
 * the same JSON Schema and lets the tool check the input itself, so input that
 * does not match comes back as the same VALIDATION_ERROR result everywhere,
 * and a result is the same shape whichever framework called the tool.
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
import { createClient, generateIdempotencyKey, isApiError, outputUrl, type ApiError, type ApiProblem, type CreateJobParams, type RendobarClient } from "@rendobar/sdk";
import { z } from "zod";
import {
  isJsonValue,
  type JobResult,
  type JobSummary,
  type JobTypeList,
  type JobTypeParams,
  type JsonValue,
  type ToolError,
  type ToolErrorCode,
  type ToolFailure,
  type ToolResult,
} from "./results.js";
import { fitSchema } from "./schema-fit.js";
import { VERSION } from "./version.js";

export type ToolkitOptions = {
  /**
   * A configured client, for any other key, server, timeout or retry setting.
   * Defaults to a client that reads RENDOBAR_API_KEY.
   */
  client?: RendobarClient | undefined;
};

/** Per call. Pass the framework's abort signal so a cancelled agent run stops polling. */
export type RunOptions = { signal?: AbortSignal | undefined };

export type RendobarToolName = "list_job_types" | "run_job" | "get_job" | "probe_media";

/** The params JSON Schema a framework hands the model. */
export type ToolJsonSchema = { [key: string]: JsonValue };

export type ToolDefinition<I extends z.ZodType, R> = {
  name: RendobarToolName;
  description: string;
  /** The input schema. `run` checks input against it, so a framework need not. */
  input: I;
  /** `input` as JSON Schema, computed once. */
  jsonSchema: ToolJsonSchema;
  /** Checks `input` first: a mismatch comes back as a VALIDATION_ERROR result, never a throw. */
  run: (input: z.input<I>, options?: RunOptions) => Promise<ToolResult<R>>;
};

/**
 * A tool's input contract for a framework that takes a Standard Schema
 * (standardschema.dev): the tool's JSON Schema for the model, and a validate
 * step that lets every input through. The tool checks input itself in `run`,
 * so a mismatch is the same VALIDATION_ERROR result in every framework rather
 * than each framework's own error.
 */
export type PassThroughSchema<T> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: "rendobar";
    readonly validate: (value: unknown) => { readonly value: T };
    readonly types?: { readonly input: T; readonly output: T };
    readonly jsonSchema: { readonly input: () => ToolJsonSchema; readonly output: () => ToolJsonSchema };
  };
};

function passThrough<T>(jsonSchema: ToolJsonSchema): PassThroughSchema<T> {
  const schema = () => jsonSchema;
  return {
    "~standard": {
      version: 1,
      vendor: "rendobar",
      // Not checked here, by design: `run` checks input and answers a mismatch as data, and a
      // result is built by the tool itself. The type is the contract a framework types calls with.
      validate: (value) => ({ value: value as T }),
      jsonSchema: { input: schema, output: schema },
    },
  };
}

/** A tool's input, for a framework that takes a Standard Schema. */
export const inputSchemaOf = <I extends z.ZodType, R>(tool: CoreTool<I, R>): PassThroughSchema<z.input<I>> => passThrough(tool.jsonSchema);

/** A tool's result type, for a framework that types results only through an output schema (Mastra). */
export const resultSchemaOf = <I extends z.ZodType, R>(_tool: CoreTool<I, R>): PassThroughSchema<ToolResult<R>> => passThrough({});

/** A definition plus the step that runs input already checked. Adapters use it; it is not exported from the package. */
export type CoreTool<I extends z.ZodType, R> = ToolDefinition<I, R> & {
  execute: (input: z.output<I>, options: RunOptions) => Promise<ToolResult<R>>;
};

function failure(code: ToolErrorCode, message: string, extra: Omit<ToolError, "code" | "message" | "requestId"> = {}, requestId: string | null = null): { error: ToolError } {
  return { error: { code, message, requestId, ...extra } };
}

/**
 * Checks input nobody has checked yet, such as a model's tool call, then runs
 * the tool. A mismatch names each field, in the same `problems` shape an API
 * refusal carries, so the model reads one form either way.
 */
export async function runUnchecked<I extends z.ZodType, R>(tool: CoreTool<I, R>, input: unknown, options: RunOptions = {}): Promise<ToolResult<R>> {
  const parsed = tool.input.safeParse(input);
  if (parsed.success) return tool.execute(parsed.data, options);
  const problems: ApiProblem[] = parsed.error.issues.map((i) => ({
    path: i.path.map((p) => (typeof p === "number" ? p : String(p))),
    message: i.message,
  }));
  const named = problems.map((p) => `${p.path.length > 0 ? p.path.join(".") : "input"}: ${p.message}`);
  return failure("VALIDATION_ERROR", `Invalid input for ${tool.name}. ${named.join(". ")}.`, { problems });
}

function define<I extends z.ZodType, R>(spec: Omit<CoreTool<I, R>, "run" | "jsonSchema">): CoreTool<I, R> {
  const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(spec.input, { io: "output" });
  const tool: CoreTool<I, R> = {
    ...spec,
    // zod's JSON Schema output is plain JSON; the guard proves it to the type checker.
    jsonSchema: Object.fromEntries(Object.entries(jsonSchema).filter((e): e is [string, JsonValue] => isJsonValue(e[1]))),
    run: (input, options) => runUnchecked(tool, input, options),
  };
  return tool;
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
function modelData(type: string, data: unknown, raw: boolean): { data: JsonValue | null; trimmed: boolean } {
  const json = isJsonValue(data) ? data : null;
  if (raw || type !== "ffprobe" || !isRecord(json) || !("summary" in json)) return { data: json, trimmed: false };
  const kept: { [key: string]: JsonValue } = {};
  for (const key of ["summary", "warnings", "reportUrl"]) {
    const v = json[key];
    if (v !== undefined && isJsonValue(v)) kept[key] = v;
  }
  return { data: kept, trimmed: true };
}

/** What an agent needs from a job, and nothing it would have to wade through. */
function summarize(job: Job, raw: boolean): JobResult {
  const base = { id: job.id, type: job.type, cost: job.cost ?? null };
  const hints: string[] = [];
  let summary: JobSummary;
  switch (job.status) {
    case "waiting":
    case "dispatched":
    case "running":
      summary = { ...base, status: job.status };
      break;
    case "complete": {
      const { data, trimmed } = modelData(job.type, job.output.data, raw);
      if (trimmed) hints.push("This is ffprobe's summary. For its full raw output, call get_job with this id and raw: true.");
      // Billing settles just after a job completes, so a job read at completion may have no cost yet.
      if (job.cost === null) hints.push("The cost settles shortly after completion. Call get_job later to read it.");
      summary = {
        ...base,
        status: "complete",
        url: outputUrl(job) ?? null,
        files: job.output.files.map((f) => ({ url: f.url, type: f.type, path: f.path, size: f.size })),
        data,
      };
      break;
    }
    case "failed":
      summary = { ...base, status: "failed", error: { code: job.error.code, message: job.error.message } };
      break;
    case "cancelled":
      summary = { ...base, status: "cancelled" };
      break;
    default: {
      // A status a newer API added. The SDK passes it through; the model gets it as data.
      const reported: unknown = Reflect.get(job, "status");
      summary = { ...base, status: "unknown", reportedStatus: String(reported) };
    }
  }
  return hints.length > 0 ? { job: summary, hint: hints.join(" ") } : { job: summary };
}

/** The SDK's per-call options, with the signal only when there is one. */
const withSignal = (options: RunOptions): { signal?: AbortSignal } => (options.signal === undefined ? {} : { signal: options.signal });

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\.?$/, ".");

/** An API refusal as the model sees it. `problems` names each field the API refused, when it listed them. */
function refusal(e: ApiError): { error: ToolError } {
  return failure(e.code, e.message, e.problems === undefined ? {} : { problems: e.problems }, e.requestId ?? null);
}

/** A read that failed, as data: thrown errors would end the agent's whole loop. */
function readFailure(e: unknown, options: RunOptions): { error: ToolError } {
  if (options.signal?.aborted === true) return failure("ABORTED", "The call was cancelled.");
  if (isApiError(e)) return refusal(e);
  return failure("REQUEST_FAILED", `${messageOf(e)} The call can be retried.`);
}

const isWaitTimeout = (e: unknown): e is Error & { lastStatus: string } =>
  e instanceof Error && e.name === "WaitTimeoutError" && typeof Reflect.get(e, "lastStatus") === "string";

/**
 * Reads a job that already exists. Any failure from here on comes back with
 * the job id and a pointer to get_job, never "retry": resubmitting would create
 * and bill a second job.
 */
async function readCreated(rb: RendobarClient, id: string, wait: boolean, options: RunOptions): Promise<ToolResult<JobResult>> {
  try {
    const job = wait ? await rb.jobs.wait(id, { throwOnFailure: false, ...withSignal(options) }) : await rb.jobs.get(id, withSignal(options));
    return summarize(job, false);
  } catch (e) {
    const status = isWaitTimeout(e) ? e.lastStatus : "unknown";
    const { error } = isWaitTimeout(e) ? failure("WAIT_TIMEOUT", messageOf(e)) : options.signal?.aborted === true ? failure("ABORTED", "The wait was cancelled.") : failure("WAIT_FAILED", messageOf(e), {}, isApiError(e) ? (e.requestId ?? null) : null);
    const failed: ToolFailure = { error, id, status, hint: "The job exists. Call get_job with this id. Do not submit it again." };
    return failed;
  }
}

/**
 * Submits a job. A failure after which the job may exist (no answer, a 429 or a
 * 5xx) comes back with the key it used inside `error`, as every Rendobar SDK
 * reports a cut-off submit: only the same key makes a retry return that job
 * instead of billing a second one. A refusal (a 4xx other than 429) created
 * nothing and carries no key: the call itself must change.
 */
async function submit(rb: RendobarClient, body: CreateJobParams, options: RunOptions): Promise<{ id: string } | ToolFailure> {
  // Chosen here, not left to the SDK, so the key is known even when the failure
  // is not an ApiError (an abort or a timeout) and carries none.
  const idempotencyKey = body.idempotencyKey ?? generateIdempotencyKey();
  try {
    const created = await rb.jobs.create({ ...body, idempotencyKey }, withSignal(options));
    return { id: created.id };
  } catch (e) {
    if (isApiError(e) && e.statusCode < 500 && e.statusCode !== 429) {
      // The API's message names its REST route. The model's way to the list is this toolkit's tool.
      return e.code === "INVALID_JOB_TYPE" ? { ...refusal(e), hint: "Call list_job_types for the live job types." } : refusal(e);
    }
    const code = options.signal?.aborted === true ? "ABORTED" : isApiError(e) ? e.code : "REQUEST_FAILED";
    return failure(code, `${messageOf(e)} The call can be retried with this idempotencyKey.`, { idempotencyKey }, isApiError(e) ? (e.requestId ?? null) : null);
  }
}

/**
 * A URL that reaches the ffprobe command as exactly one argument. The API
 * splits the command on whitespace and quotes, and treats a token starting
 * with `-` as a flag, so a URL carrying any of those could add flags to a
 * billed job. Only http and https: anything else is not a media URL here.
 *
 * The characters are checked on the raw value, first: the URL check parses
 * with WHATWG rules, which silently drop a tab or newline, so checking after
 * it would accept "https://x/a.mp4<tab>-f" as a different URL than was sent.
 */
const mediaUrl = z
  .string()
  .check(
    z.refine((url: string) => !/[\s"'\\]/.test(url), { message: "A media URL cannot contain whitespace, quotes or backslashes", abort: true }),
    z.url({ protocol: /^https?$/ }),
  )
  .describe("Public or signed http(s) URL of the media file");

/** The four tools with their adapter-only step, for the adapters in this package (not exported from it). */
export function buildTools(options: ToolkitOptions) {
  // A client the caller built keeps its own attribution. Ours names this package, not the SDK.
  const rb = options.client ?? createClient({ client: `agent-toolkit/${VERSION}` });

  const listJobTypes = define<z.ZodObject<{ type: z.ZodOptional<z.ZodString>; full: z.ZodOptional<z.ZodBoolean> }>, JobTypeList | JobTypeParams>({
    name: "list_job_types",
    description:
      "List what Rendobar can do right now: every live media job type (video, audio, image, captions, compose, AI generation) with its use cases. Pass `type` to get that type's params schema and input names. Call this before run_job.",
    input: z.object({
      type: z.string().optional().describe("A job type from the list, to get its params schema"),
      full: z.boolean().optional().describe("Return the type's complete schema even when it is very large. Off by default"),
    }),
    execute: async ({ type, full }, opts) => {
      try {
        if (type === undefined) {
          const types = await rb.jobs.types(withSignal(opts));
          return { jobTypes: types.map((t) => ({ type: t.type, summary: t.summary, useCases: t.useCases })) };
        }
        const schema = await rb.jobs.typeSchema(type, withSignal(opts));
        const json = isJsonValue(schema.jsonSchema) ? schema.jsonSchema : null;
        const fitted = full === true ? { params: json } : fitSchema(json);
        const result: JobTypeParams = {
          type: schema.type,
          params: fitted.params,
          inputs: { names: schema.inputs.fields.map((f) => f.name), anyName: schema.inputs.variadic },
        };
        if (fitted.trimmed === undefined) return result;
        return { ...result, trimmed: fitted.trimmed, hint: `Shortened to fit (${fitted.trimmed}). Call list_job_types with this type and full: true for the complete schema.` };
      } catch (e) {
        if (type !== undefined && isApiError(e) && e.statusCode === 404) {
          return failure("NOT_FOUND", `Job type "${type}" is not live. Call list_job_types.`, {}, e.requestId ?? null);
        }
        return readFailure(e, opts);
      }
    },
  });

  const runJobInput = z.object({
    type: z.string().describe("Job type, from list_job_types"),
    params: z.record(z.string(), z.unknown()).optional().describe("Params for this job type, per its schema. Omitted means {}"),
    inputs: z.record(z.string(), z.url()).optional().describe("Named input files, each a URL"),
    wait: z.boolean().optional().describe("Wait for the job to finish (the default). False returns the job as soon as it is created"),
    idempotencyKey: z
      .string()
      .optional()
      .describe("Reuse the key a failed run_job returned to retry it with the same type, params and inputs, without creating a second job. Omit on a first call"),
  });
  const runJob = define<typeof runJobInput, JobResult>({
    name: "run_job",
    description:
      "Run a Rendobar media job and return its result: status, output URL, files and data. Waits until the job finishes unless `wait` is false. Get valid `type` values and params from list_job_types first. URLs in params or inputs must be public or signed.",
    input: runJobInput,
    execute: async ({ type, params, inputs, wait, idempotencyKey }, opts) => {
      const body: CreateJobParams = {
        type,
        params: params ?? {},
        ...(inputs === undefined ? {} : { inputs }),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      };
      // Only the submit may be retried by the model. Once a job exists, failures say so.
      const created = await submit(rb, body, opts);
      return "error" in created ? created : readCreated(rb, created.id, wait !== false, opts);
    },
  });

  const getJobInput = z.object({
    id: z.string().describe("Job id, such as job_abc123"),
    raw: z.boolean().optional().describe("Return the job's full output data, such as every raw ffprobe section. Off by default"),
  });
  const getJob = define<typeof getJobInput, JobResult>({
    name: "get_job",
    description:
      "Get a Rendobar job's current status and, once complete, its output URL, files and data. An ffprobe job returns its summary unless `raw` is true.",
    input: getJobInput,
    execute: async ({ id, raw }, opts) => {
      try {
        return summarize(await rb.jobs.get(id, withSignal(opts)), raw === true);
      } catch (e) {
        return readFailure(e, opts);
      }
    },
  });

  const probeInput = z.object({ url: mediaUrl });
  const probeMedia = define<typeof probeInput, JobResult>({
    name: "probe_media",
    description: "Inspect a media file by URL: duration, format, streams, codecs, resolution, frame rate. Runs as a short ffprobe job, billed like any other job.",
    input: probeInput,
    execute: async ({ url }, opts) => {
      const created = await submit(rb, { type: "ffprobe", params: { command: url } }, opts);
      return "error" in created ? created : readCreated(rb, created.id, true, opts);
    },
  });

  return { list_job_types: listJobTypes, run_job: runJob, get_job: getJob, probe_media: probeMedia };
}

type Built = ReturnType<typeof buildTools>;
/** The four tools, keyed by the names the model sees. */
export type RendobarToolDefinitions = { [Name in keyof Built]: Built[Name] extends CoreTool<infer I, infer R> ? ToolDefinition<I, R> : never };

export function rendobarToolDefinitions(options: ToolkitOptions = {}): RendobarToolDefinitions {
  return buildTools(options);
}
