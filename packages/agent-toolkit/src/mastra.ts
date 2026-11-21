/**
 * Rendobar tools for Mastra agents.
 *
 *   import { Agent } from "@mastra/core/agent";
 *   import { rendobarTools } from "@rendobar/agent-toolkit/mastra";
 *
 *   const editor = new Agent({ id: "editor", name: "Editor", instructions: "...", model, tools: rendobarTools() });
 */
import { createTool } from "@mastra/core/tools";
import { rendobarToolDefinitions, type ToolkitOptions } from "./core.js";

export type { ToolkitOptions } from "./core.js";

export function rendobarTools(options: ToolkitOptions = {}) {
  const d = rendobarToolDefinitions(options);
  return {
    list_job_types: createTool({ id: d.list_job_types.name, description: d.list_job_types.description, inputSchema: d.list_job_types.input, execute: (input) => d.list_job_types.run(input) }),
    run_job: createTool({ id: d.run_job.name, description: d.run_job.description, inputSchema: d.run_job.input, execute: (input) => d.run_job.run(input) }),
    get_job: createTool({ id: d.get_job.name, description: d.get_job.description, inputSchema: d.get_job.input, execute: (input) => d.get_job.run(input) }),
    probe_media: createTool({ id: d.probe_media.name, description: d.probe_media.description, inputSchema: d.probe_media.input, execute: (input) => d.probe_media.run(input) }),
  };
}
