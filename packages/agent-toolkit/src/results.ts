/**
 * What the tools return. Every result is either the tool's own shape or a
 * `ToolFailure`, told apart by the `error` key, which only a failure has. A job
 * that failed is a successful read of a failed job: its error sits on
 * `job.error`, never on the top-level `error`.
 *
 * Sets the API can grow (job statuses, error codes) are typed as the known
 * values plus an open case, so a new value from a newer API is data, not a
 * crash and not a breaking release.
 */
import type { ApiErrorCode, ApiProblem, Cost, Job, JobError, JobTypeName, OutputFile } from "@rendobar/sdk";

/** Any JSON value, as a job's output data is. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value).every(isJsonValue);
  return false;
}

/** A job status: the SDK's known ones, or one a newer API sends. */
export type JobStatusName = Job["status"] | (string & {});

/** The toolkit's own error codes, then every code the SDK knows, then any code a newer API sends. */
export type ToolErrorCode = "REQUEST_FAILED" | "WAIT_TIMEOUT" | "WAIT_FAILED" | "ABORTED" | ApiErrorCode;

export type ToolError = {
  code: ToolErrorCode;
  message: string;
  /** The API's request id, for support. Null when no request answered. */
  requestId: string | null;
  /** Each field a refusal named, when it listed them. */
  problems?: ApiProblem[];
  /** On a submit that may have created a job: resend run_job with this key to get that job instead of a second one. */
  idempotencyKey?: string;
};

export type ToolFailure = {
  error: ToolError;
  /** The job the failure is about, when one exists. */
  id?: string;
  /** That job's last known status. */
  status?: JobStatusName;
  /** What the model should do next. */
  hint?: string;
};

export type ToolResult<T> = T | ToolFailure;

export function isToolFailure<T>(result: ToolResult<T>): result is ToolFailure {
  return typeof result === "object" && result !== null && "error" in result;
}

export type JobFile = Pick<OutputFile, "url" | "type" | "path" | "size">;

type JobBase = {
  id: string;
  type: JobTypeName;
  /** Null until billing settles, just after the job completes. `amount` is integer nanodollars. */
  cost: Cost | null;
};

export type PendingJob = JobBase & { status: "waiting" | "dispatched" | "running" };
export type CompleteJob = JobBase & {
  status: "complete";
  /** The job's headline output, `output.file.url`. Null for a job whose output is data or a file set. */
  url: string | null;
  files: JobFile[];
  data: JsonValue | null;
};
export type FailedJob = JobBase & { status: "failed"; error: Pick<JobError, "code" | "message"> };
export type CancelledJob = JobBase & { status: "cancelled" };
/** A status this toolkit does not know yet, as a newer API may report. */
export type UnknownStatusJob = JobBase & { status: "unknown"; reportedStatus: string };

export type JobSummary = PendingJob | CompleteJob | FailedJob | CancelledJob | UnknownStatusJob;

export type JobResult = { job: JobSummary; hint?: string };

export type JobTypeSummary = { type: JobTypeName; summary: string; useCases: string[] };
export type JobTypeList = { jobTypes: JobTypeSummary[] };

export type JobTypeParams = {
  type: JobTypeName;
  /** The params JSON Schema, trimmed to fit a model's context unless `full` was asked for. */
  params: JsonValue;
  /** The named inputs this job type takes. `anyName` means it takes inputs under any name. */
  inputs: { names: string[]; anyName: boolean };
  /** How the schema was shortened: descriptions cut to a sentence, or deeper levels left out. */
  trimmed?: "descriptions" | "outline";
  hint?: string;
};
