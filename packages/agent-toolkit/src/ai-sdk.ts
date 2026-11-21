/**
 * Rendobar tools for the Vercel AI SDK.
 *
 *   import { generateText } from "ai";
 *   import { rendobarTools } from "@rendobar/agent-toolkit/ai-sdk";
 *
 *   const { text } = await generateText({ model, tools: rendobarTools(), prompt: "Trim this video to 10 seconds: https://..." });
 */
import { tool, type Tool } from "ai";
import { rendobarToolDefinitions, type ToolkitOptions } from "./core.js";

export type { ToolkitOptions } from "./core.js";

/** The four Rendobar tools, keyed by the names the model sees. */
export type RendobarTools = {
  list_job_types: Tool;
  run_job: Tool;
  get_job: Tool;
  probe_media: Tool;
};

export function rendobarTools(options: ToolkitOptions = {}): RendobarTools {
  const d = rendobarToolDefinitions(options);
  return {
    list_job_types: tool({ description: d.list_job_types.description, inputSchema: d.list_job_types.input, execute: d.list_job_types.run }),
    run_job: tool({ description: d.run_job.description, inputSchema: d.run_job.input, execute: d.run_job.run }),
    get_job: tool({ description: d.get_job.description, inputSchema: d.get_job.input, execute: d.get_job.run }),
    probe_media: tool({ description: d.probe_media.description, inputSchema: d.probe_media.input, execute: d.probe_media.run }),
  };
}
