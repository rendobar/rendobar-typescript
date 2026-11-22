/**
 * Rendobar tools for Mastra agents.
 *
 *   import { Agent } from "@mastra/core/agent";
 *   import { rendobarTools } from "@rendobar/agent-toolkit/mastra";
 *
 *   const editor = new Agent({ id: "editor", name: "Editor", instructions: "...", model, tools: rendobarTools() });
 */
import { createTool, type Tool, type ToolExecutionContext } from "@mastra/core/tools";
import type { z } from "zod";
import { buildTools, inputSchemaOf, resultSchemaOf, runUnchecked, type CoreTool, type RendobarToolName, type ToolkitOptions } from "./core.js";
import type { ToolResult } from "./results.js";

export type { ToolkitOptions } from "./core.js";

/** Mastra's abort signal, as the tool's run option: a cancelled agent run stops the tool's polling. */
const runOptions = (context: { abortSignal?: AbortSignal | undefined } | undefined) =>
  context?.abortSignal === undefined ? {} : { signal: context.abortSignal };

type Built = ReturnType<typeof buildTools>;

/** One Rendobar tool as Mastra types it: its own input and result, no suspend or resume, no request context. */
export type RendobarMastraTool<I, R> = Tool<I, R, unknown, unknown, ToolExecutionContext<unknown, unknown, unknown>, RendobarToolName, unknown>;

/** The four Rendobar tools, keyed by the names the model sees. */
export type RendobarMastraTools = {
  [Name in keyof Built]: Built[Name] extends CoreTool<infer I, infer R> ? RendobarMastraTool<z.input<I>, ToolResult<R>> : never;
};

export function rendobarTools(options: ToolkitOptions = {}): RendobarMastraTools {
  const d = buildTools(options);
  // Written out per tool so Mastra infers each tool's own input and result types.
  return {
    list_job_types: createTool({
      id: d.list_job_types.name,
      description: d.list_job_types.description,
      inputSchema: inputSchemaOf(d.list_job_types),
      outputSchema: resultSchemaOf(d.list_job_types),
      execute: (input, context) => runUnchecked(d.list_job_types, input, runOptions(context)),
    }),
    run_job: createTool({
      id: d.run_job.name,
      description: d.run_job.description,
      inputSchema: inputSchemaOf(d.run_job),
      outputSchema: resultSchemaOf(d.run_job),
      execute: (input, context) => runUnchecked(d.run_job, input, runOptions(context)),
    }),
    get_job: createTool({
      id: d.get_job.name,
      description: d.get_job.description,
      inputSchema: inputSchemaOf(d.get_job),
      outputSchema: resultSchemaOf(d.get_job),
      execute: (input, context) => runUnchecked(d.get_job, input, runOptions(context)),
    }),
    probe_media: createTool({
      id: d.probe_media.name,
      description: d.probe_media.description,
      inputSchema: inputSchemaOf(d.probe_media),
      outputSchema: resultSchemaOf(d.probe_media),
      execute: (input, context) => runUnchecked(d.probe_media, input, runOptions(context)),
    }),
  };
}
