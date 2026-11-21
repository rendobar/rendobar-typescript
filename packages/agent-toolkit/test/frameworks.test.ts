/**
 * The Mastra, LangChain.js and AI SDK adapters, each driven through its
 * framework's own tool interface against the shared conformance mock. They
 * must hand the model the same schema, report bad input the same way, and
 * pass each framework's cancellation through.
 */
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { asSchema, type FlexibleSchema } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { rendobarTools as aiSdkTools } from "../src/ai-sdk.js";
import { buildTools } from "../src/core.js";
import { rendobarTools as langchainTools, type RendobarLangChainTool } from "../src/langchain.js";
import { rendobarTools as mastraTools } from "../src/mastra.js";
import { mockClient, requests, reset } from "./helpers.js";

const NAMES = ["get_job", "list_job_types", "probe_media", "run_job"] as const;

beforeEach(() => reset());

function byName(tools: RendobarLangChainTool[], name: string): RendobarLangChainTool {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`no LangChain tool named ${name}`);
  return found;
}

/** A JSON Schema without its `$schema` dialect line, which frameworks add or drop. */
function bare(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null) return schema;
  return Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "$schema"));
}

describe("every framework", () => {
  it("hands the model each tool's own JSON Schema, unchanged", async () => {
    const client = mockClient();
    const core = buildTools({ client });
    const ai = aiSdkTools({ client });
    const lc = langchainTools({ client });
    for (const name of NAMES) {
      const aiSchema: FlexibleSchema<unknown> = ai[name].inputSchema;
      expect(bare(await asSchema(aiSchema).jsonSchema), `ai-sdk ${name}`).toEqual(core[name].jsonSchema);
      expect(bare(convertToOpenAITool(byName(lc, name)).function.parameters), `langchain ${name}`).toEqual(core[name].jsonSchema);
    }
    expect(core.run_job.jsonSchema).toMatchObject({ required: ["type"] });
  });

  it("answers the same bad input with the same VALIDATION_ERROR result", async () => {
    const client = mockClient();
    const bad = { url: "https://x/a.mp4 -show_frames" };
    const expected = await buildTools({ client }).probe_media.run(bad);
    const ai = aiSdkTools({ client });
    const mastra = mastraTools({ client });

    const results = [
      await ai.probe_media.execute?.(bad, { toolCallId: "1", messages: [], context: {} }),
      await mastra.probe_media.execute?.(bad, {}),
      await byName(langchainTools({ client }), "probe_media").invoke(bad),
    ];

    expect(expected).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(results).toEqual([expected, expected, expected]);
    expect((await requests()).length).toBe(0);
  });

  it("stops polling when the framework cancels the run", async () => {
    const client = mockClient();
    const runs: Array<(signal: AbortSignal) => Promise<unknown>> = [
      async (signal) => aiSdkTools({ client }).run_job.execute?.({ type: "ffprobe" }, { toolCallId: "1", messages: [], context: {}, abortSignal: signal }),
      async (signal) => mastraTools({ client }).run_job.execute?.({ type: "ffprobe" }, { abortSignal: signal }),
      // LangChain itself rejects an invoke whose signal aborts; the tool must still stop polling.
      (signal) => byName(langchainTools({ client }), "run_job").invoke({ type: "ffprobe" }, { signal }).catch((e: unknown) => e),
    ];
    for (const run of runs) {
      await reset();
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 300);
      const started = Date.now();
      await run(controller.signal);
      expect(Date.now() - started).toBeLessThan(1500);
      const polls = (await requests()).length;
      await new Promise((r) => setTimeout(r, 2200));
      expect((await requests()).length).toBe(polls);
    }
  }, 15_000);
});

describe("Mastra adapter", () => {
  it("runs a job and reports a missing one as data", async () => {
    const tools = mastraTools({ client: mockClient() });
    expect(Object.keys(tools).sort()).toEqual([...NAMES]);

    const created = await tools.run_job.execute?.({ type: "ffprobe", params: { command: "https://x/a.mp4" }, wait: false }, {});
    const missing = await tools.get_job.execute?.({ id: "job_404" }, {});

    expect(created).toMatchObject({ job: { id: expect.stringMatching(/^job_/) } });
    expect(missing).toMatchObject({ error: { code: "NOT_FOUND", requestId: expect.stringMatching(/^req_/) } });
  });
});

describe("LangChain.js adapter", () => {
  it("returns one list of same-typed tools to look up by name", async () => {
    const tools = langchainTools({ client: mockClient() });
    expect(tools.map((t) => t.name).sort()).toEqual([...NAMES]);

    const created = await byName(tools, "run_job").invoke({ type: "ffprobe", params: { command: "https://x/a.mp4" }, wait: false });
    const missing = await byName(tools, "get_job").invoke({ id: "job_404" });

    expect(created).toMatchObject({ job: { id: expect.stringMatching(/^job_/) } });
    expect(missing).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("answers a bad tool call with error data in a ToolMessage, so a LangGraph tool node keeps going", async () => {
    const tools = langchainTools({ client: mockClient() });
    const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

    const message = await byName(tools, "run_job").invoke({ name: "run_job", args: { params: {} }, id: "c", type: "tool_call" });
    // The README's LangGraph tool node: one bad call must not reject the batch.
    const batch = await Promise.all(
      [
        { name: "run_job", args: { params: {} }, id: "a", type: "tool_call" as const },
        { name: "get_job", args: { id: "job_404" }, id: "b", type: "tool_call" as const },
      ].map((call) => toolsByName[call.name]?.invoke(call)),
    );

    expect(message).toMatchObject({ tool_call_id: "c", content: expect.stringContaining('"code":"VALIDATION_ERROR"') });
    expect(batch.map((m) => JSON.stringify(m))).toEqual([expect.stringContaining("VALIDATION_ERROR"), expect.stringContaining("NOT_FOUND")]);
    const submits = (await requests()).filter((r) => r.method === "POST");
    expect(submits).toHaveLength(0);
  });
});
