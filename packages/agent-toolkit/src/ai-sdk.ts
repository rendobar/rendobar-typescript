/**
 * Rendobar tools for the Vercel AI SDK.
 *
 *   import { generateText } from "ai";
 *   import { rendobarTools } from "@rendobar/agent-toolkit/ai-sdk";
 *
 *   const { text } = await generateText({ model, tools: rendobarTools(), prompt: "Trim this video to 10 seconds: https://..." });
 */
import { tool, type Tool } from "ai";
import type { z } from "zod";
import { buildTools, inputSchemaOf, runUnchecked, type CoreTool, type ToolkitOptions } from "./core.js";
import type { ToolResult } from "./results.js";

export type { ToolkitOptions } from "./core.js";

type Built = ReturnType<typeof buildTools>;

/** The AI SDK's tool context type. The tools read none of it. */
type Context = Record<string, unknown>;

/** The four Rendobar tools, keyed by the names the model sees, each typed by its own input and result. */
export type RendobarTools = { [Name in keyof Built]: Built[Name] extends CoreTool<infer I, infer R> ? Tool<z.input<I>, ToolResult<R>, Context> : never };

/** The AI SDK's abort signal, as the tool's run option: a cancelled agent run stops the tool's polling. */
const runOptions = ({ abortSignal }: { abortSignal?: AbortSignal | undefined }) => (abortSignal === undefined ? {} : { signal: abortSignal });

export function rendobarTools(options: ToolkitOptions = {}): RendobarTools {
  const d = buildTools(options);
  // Written out per tool: the AI SDK's tool() cannot resolve its output type through a generic helper.
  return {
    list_job_types: tool({
      description: d.list_job_types.description,
      inputSchema: inputSchemaOf(d.list_job_types),
      execute: (input, opts) => runUnchecked(d.list_job_types, input, runOptions(opts)),
    }),
    run_job: tool({
      description: d.run_job.description,
      inputSchema: inputSchemaOf(d.run_job),
      execute: (input, opts) => runUnchecked(d.run_job, input, runOptions(opts)),
    }),
    get_job: tool({
      description: d.get_job.description,
      inputSchema: inputSchemaOf(d.get_job),
      execute: (input, opts) => runUnchecked(d.get_job, input, runOptions(opts)),
    }),
    probe_media: tool({
      description: d.probe_media.description,
      inputSchema: inputSchemaOf(d.probe_media),
      execute: (input, opts) => runUnchecked(d.probe_media, input, runOptions(opts)),
    }),
  };
}
