/**
 * Rendobar tools for LangChain.js and LangGraph.js agents.
 *
 *   import { createAgent } from "langchain";
 *   import { rendobarTools } from "@rendobar/agent-toolkit/langchain";
 *
 *   const agent = createAgent({ model, tools: rendobarTools() });
 */
import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import type { z } from "zod";
import { rendobarToolDefinitions, runUnchecked, type ToolDefinition, type ToolkitOptions } from "./core.js";

export type { ToolkitOptions } from "./core.js";

/**
 * The four tools in a plain mutable list, as `createAgent` takes them, in this
 * order: list_job_types, run_job, get_job, probe_media. Every entry has the one
 * element type, so `toolsByName[call.name].invoke(call)` type-checks: a union of
 * four differently typed tools has no callable `invoke`. Each tool still checks
 * its input against its own schema when it runs.
 */
export type RendobarTools = [DynamicStructuredTool, DynamicStructuredTool, DynamicStructuredTool, DynamicStructuredTool];

/**
 * LangChain parses a tool's input before calling it and throws
 * ToolInputParsingException on a mismatch, which rejects a LangGraph tool node.
 * So LangChain parses with a catch that hands any input through, and the tool
 * checks the input itself, answering a mismatch with error data like every
 * other failure. A catch converts to its inner JSON Schema, so the model sees
 * the same schema.
 */
function langchainTool<I extends z.ZodType>(d: ToolDefinition<I>): DynamicStructuredTool {
  const schema: z.ZodType = d.input;
  // zod's JSON Schema conversion calls the catch with no context, looking for a
  // static default. Answering undefined adds none to the schema the model sees.
  const lenient = schema.catch((ctx: z.core.$ZodCatchCtx | undefined) => ctx?.input);
  return tool((input) => runUnchecked(d, input), { name: d.name, description: d.description, schema: lenient });
}

export function rendobarTools(options: ToolkitOptions = {}): RendobarTools {
  const d = rendobarToolDefinitions(options);
  return [langchainTool(d.list_job_types), langchainTool(d.run_job), langchainTool(d.get_job), langchainTool(d.probe_media)];
}
