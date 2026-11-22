/**
 * Compile-time checks, run by `tsc --noEmit` (pnpm typecheck), never executed.
 * Each `@ts-expect-error` line is a program that must not compile: if it ever
 * compiles, the directive itself fails the typecheck.
 */
import { createAgent } from "langchain";
import { rendobarToolDefinitions, isToolFailure, type JobSummary, type ToolResult, type JobResult } from "../src/index.js";
import { rendobarTools as aiSdkTools } from "../src/ai-sdk.js";
import { rendobarTools as langchainTools, type RendobarLangChainTool } from "../src/langchain.js";

const tools = rendobarToolDefinitions();

// Inputs are typed by each tool's schema.
void tools.run_job.run({ type: "ffprobe", params: { command: "https://x/a.mp4" }, wait: false });
// @ts-expect-error wait must be a boolean
void tools.run_job.run({ type: "ffprobe", wait: "yes" });
// @ts-expect-error type is required
void tools.run_job.run({ params: {} });
// @ts-expect-error inputs are URL strings
void tools.run_job.run({ type: "ffmpeg", inputs: { source: 42 } });
// @ts-expect-error get_job takes an id, not a url
void tools.get_job.run({ url: "https://x/a.mp4" });
// The run option is an options object, so a new option is never a signature break.
void tools.get_job.run({ id: "job_1" }, { signal: new AbortController().signal });

// Results are a union told apart by `error`, and a job by its status.
async function read(): Promise<string> {
  const result: ToolResult<JobResult> = await tools.get_job.run({ id: "job_1" });
  // @ts-expect-error a result may be a failure, which has no job
  void result.job;
  if (isToolFailure(result)) return result.error.code;
  const job: JobSummary = result.job;
  // @ts-expect-error only a complete job has a url
  void job.url;
  switch (job.status) {
    case "complete":
      return job.url ?? "no headline file";
    case "failed":
      return job.error.code;
    case "unknown":
      return job.reportedStatus;
    default:
      return job.status;
  }
}
void read;

// AI SDK tools keep each tool's own input type.
const ai = aiSdkTools();
// @ts-expect-error probe_media takes a url
void ai.probe_media.execute?.({ id: "job_1" }, { toolCallId: "1", messages: [], context: {} });

// LangChain: one element type, a plain mutable list createAgent takes, looked up by name.
const lc: RendobarLangChainTool[] = langchainTools();
createAgent({ model: "openai:gpt-4o", tools: lc });
const name: "list_job_types" | "run_job" | "get_job" | "probe_media" | undefined = lc[0]?.name;
void name;
