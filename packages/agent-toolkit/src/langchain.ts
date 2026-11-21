/**
 * Rendobar tools for LangChain.js and LangGraph.js agents.
 *
 *   import { createAgent } from "langchain";
 *   import { rendobarTools } from "@rendobar/agent-toolkit/langchain";
 *
 *   const agent = createAgent({ model, tools: rendobarTools() });
 */
import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { buildTools, runUnchecked, type CoreTool, type RendobarToolName, type ToolkitOptions } from "./core.js";
import type { JobResult, JobTypeList, JobTypeParams, ToolResult } from "./results.js";

export type { ToolkitOptions } from "./core.js";

/**
 * The schema LangChain parses with: any object passes, and it carries the
 * tool's JSON Schema as zod metadata, which zod copies into the JSON Schema it
 * generates, so the model sees exactly the tool's schema. LangChain parses
 * input before calling a tool and throws ToolInputParsingException on a
 * mismatch, which rejects a LangGraph tool node. The tool checks input itself
 * instead and answers a mismatch with data, as in every other framework.
 */
type LangChainSchema = z.ZodObject<{}, z.core.$loose>;
type LangChainInput = z.output<LangChainSchema>;

/** Whatever a Rendobar tool returns: a job, the job type list, one type's params, or a failure. */
export type RendobarToolResult = ToolResult<JobResult> | ToolResult<JobTypeList | JobTypeParams>;

/** Every Rendobar tool has this one type, so `toolsByName[call.name].invoke(call)` type-checks. */
export type RendobarLangChainTool = DynamicStructuredTool<LangChainSchema, LangChainInput, LangChainInput, RendobarToolResult, unknown, RendobarToolName>;

function langchainTool<I extends z.ZodType, R extends RendobarToolResult>(d: CoreTool<I, R>): RendobarLangChainTool {
  const schema: LangChainSchema = z.looseObject({}).meta(d.jsonSchema);
  // LangChain hands the run config to the tool. Its signal stops the tool's polling when the run is cancelled.
  return tool(async (input: LangChainInput, config): Promise<RendobarToolResult> => runUnchecked(d, input, config.signal === undefined ? {} : { signal: config.signal }), {
    name: d.name,
    description: d.description,
    schema,
  });
}

/** The four Rendobar tools, as `createAgent` takes them. Find one by its `name`, not by its place in the list. */
export function rendobarTools(options: ToolkitOptions = {}): RendobarLangChainTool[] {
  const d = buildTools(options);
  return [langchainTool(d.list_job_types), langchainTool(d.run_job), langchainTool(d.get_job), langchainTool(d.probe_media)];
}
