/**
 * Rendobar tools for LangChain.js and LangGraph.js agents.
 *
 *   import { createAgent } from "langchain";
 *   import { rendobarTools } from "@rendobar/agent-toolkit/langchain";
 *
 *   const agent = createAgent({ model, tools: rendobarTools() });
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
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

/**
 * Built with the DynamicStructuredTool class, not the `tool()` helper: the
 * helper rejects with an AbortError the moment the run's signal aborts, which
 * would drop the result and with it the id of a job that is still running and
 * billing. The class hands the signal to the tool, which stops polling and
 * returns ABORTED with that id, as in every other framework.
 */
function langchainTool<I extends z.ZodType, R extends RendobarToolResult>(d: CoreTool<I, R>): RendobarLangChainTool {
  return new DynamicStructuredTool<LangChainSchema, LangChainInput, LangChainInput, RendobarToolResult, unknown, RendobarToolName>({
    name: d.name,
    description: d.description,
    schema: z.looseObject({}).meta(d.jsonSchema),
    func: (input, _runManager, config) => runUnchecked(d, input, config?.signal === undefined ? {} : { signal: config.signal }),
  });
}

/** The four Rendobar tools, as `createAgent` takes them. Find one by its `name`, not by its place in the list. */
export function rendobarTools(options: ToolkitOptions = {}): RendobarLangChainTool[] {
  const d = buildTools(options);
  return [langchainTool(d.list_job_types), langchainTool(d.run_job), langchainTool(d.get_job), langchainTool(d.probe_media)];
}
