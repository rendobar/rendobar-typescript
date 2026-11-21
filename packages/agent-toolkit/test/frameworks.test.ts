/**
 * The Mastra and LangChain.js adapters, each driven through its framework's own
 * tool interface against the shared conformance mock. Same tools, same
 * behaviour as the AI SDK adapter: errors come back as data.
 */
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { zodToJsonSchema } from "@mastra/core/utils/zod-to-json";
import { createClient } from "@rendobar/sdk";
import { asSchema, type FlexibleSchema } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { rendobarTools as aiSdkTools } from "../src/ai-sdk.js";
import { rendobarTools as langchainTools } from "../src/langchain.js";
import { rendobarTools as mastraTools } from "../src/mastra.js";

const MOCK = process.env.RENDOBAR_MOCK ?? "http://127.0.0.1:4100";
const client = () => createClient({ apiKey: "rb_test", baseUrl: MOCK, maxRetries: 0 });

beforeEach(async () => {
  await fetch(`${MOCK}/__reset`, { method: "POST" });
});

describe("Mastra adapter", () => {
  it("runs a job and reports a missing one as data", async () => {
    const tools = mastraTools({ client: client() });
    expect(Object.keys(tools).sort()).toEqual(["get_job", "list_job_types", "probe_media", "run_job"]);
    const created = await tools.run_job.execute!({ type: "ffprobe", params: { command: "https://x/a.mp4" }, wait: false }, {} as never);
    expect((created as { id: string }).id).toMatch(/^job_/);
    const missing = await tools.get_job.execute!({ id: "job_404" }, {} as never);
    expect(missing).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("LangChain.js adapter", () => {
  it("answers input that does not match the schema with error data, not a throw", async () => {
    const tools = langchainTools({ client: client() });
    const runJob = tools[1];
    const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

    const message = await runJob.invoke({ name: "run_job", args: { params: {} }, id: "c", type: "tool_call" });
    // The README's LangGraph tool node: one bad call must not reject the batch.
    const batch = await Promise.all(
      [{ name: "run_job", args: { params: {} }, id: "a", type: "tool_call" as const }, { name: "get_job", args: { id: "job_404" }, id: "b", type: "tool_call" as const }].map(
        (call) => toolsByName[call.name]?.invoke(call),
      ),
    );

    expect(message).toMatchObject({ tool_call_id: "c", content: expect.stringContaining('"code":"VALIDATION_ERROR"') });
    expect(String(message.content)).toMatch(/type: /);
    expect(batch.map((m) => String(m?.content))).toEqual([expect.stringContaining("VALIDATION_ERROR"), expect.stringContaining("NOT_FOUND")]);
    const created = await (await fetch(`${MOCK}/__created`)).json();
    expect(created.data.count).toBe(0);
  });

  it("runs a job and reports a missing one as data", async () => {
    const tools = langchainTools({ client: client() });
    expect(tools.map((t) => t.name).sort()).toEqual(["get_job", "list_job_types", "probe_media", "run_job"]);
    const [, runJob, getJob] = tools;
    const created = await runJob.invoke({ type: "ffprobe", params: { command: "https://x/a.mp4" }, wait: false });
    expect((created as { id: string }).id).toMatch(/^job_/);
    const missing = await getJob.invoke({ id: "job_404" });
    expect(missing).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

/** The `required` list of a JSON Schema, sorted, or [] when it has none. */
function required(schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null || !("required" in schema) || !Array.isArray(schema.required)) return [];
  return schema.required.map(String).sort();
}

describe("every framework", () => {
  it("shows the model the same required fields for each tool", async () => {
    const ai = aiSdkTools({ client: client() });
    const mastra = mastraTools({ client: client() });
    const seen: Record<string, string[][]> = {};
    for (const t of langchainTools({ client: client() })) {
      // LangChain names its tools at runtime; the list is the same four keys as the other adapters.
      const name = t.name as keyof typeof ai;
      const aiSchema: FlexibleSchema<unknown> = ai[name].inputSchema;
      seen[name] = [
        required(convertToOpenAITool(t).function.parameters),
        required(await asSchema(aiSchema).jsonSchema),
        required(zodToJsonSchema(mastra[name].inputSchema)),
      ];
    }
    expect(seen).toEqual({
      list_job_types: [[], [], []],
      run_job: [["type"], ["type"], ["type"]],
      get_job: [["id"], ["id"], ["id"]],
      probe_media: [["url"], ["url"], ["url"]],
    });
  });
});
