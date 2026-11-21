/**
 * Rendobar tools for LangChain.js and LangGraph.js agents.
 *
 *   import { createAgent } from "langchain";
 *   import { rendobarTools } from "@rendobar/agent-toolkit/langchain";
 *
 *   const agent = createAgent({ model, tools: rendobarTools() });
 */
import { tool } from "@langchain/core/tools";
import { rendobarToolDefinitions, type ToolkitOptions } from "./core.js";

export type { ToolkitOptions } from "./core.js";

/** The four Rendobar tools as LangChain tools, in a list as agents take them (list_job_types, run_job, get_job, probe_media). */
export function rendobarTools(options: ToolkitOptions = {}) {
  const d = rendobarToolDefinitions(options);
  return [
    tool((input) => d.list_job_types.run(input), { name: d.list_job_types.name, description: d.list_job_types.description, schema: d.list_job_types.input }),
    tool((input) => d.run_job.run(input), { name: d.run_job.name, description: d.run_job.description, schema: d.run_job.input }),
    tool((input) => d.get_job.run(input), { name: d.get_job.name, description: d.get_job.description, schema: d.get_job.input }),
    tool((input) => d.probe_media.run(input), { name: d.probe_media.name, description: d.probe_media.description, schema: d.probe_media.input }),
  ] as const;
}
