/**
 * A real AI SDK agent loop (`generateText` with `stopWhen`) drives the tools
 * against the shared conformance mock. Only the model is scripted: the AI SDK
 * validates inputs, runs `execute`, and feeds results back exactly as it would
 * with a real model.
 */
import { createClient } from "@rendobar/sdk";
import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import { rendobarTools } from "../src/ai-sdk.js";

const MOCK = process.env.RENDOBAR_MOCK ?? "http://127.0.0.1:4100";
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const call = (id: string, toolName: string, input: unknown) => ({
  content: [{ type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage,
  warnings: [],
});
const done = {
  content: [{ type: "text" as const, text: "Done." }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage,
  warnings: [],
};

beforeEach(async () => {
  await fetch(`${MOCK}/__reset`, { method: "POST" });
});

describe("rendobarTools() in a generateText agent loop", () => {
  it("lists job types, submits a job, and reports a missing job as data", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        call("1", "list_job_types", {}),
        call("2", "run_job", { type: "ffprobe", params: { command: "https://cdn.rendobar.com/assets/examples/sample.mp4" }, wait: false }),
        call("3", "get_job", { id: "job_404" }),
        done,
      ],
    });
    const client = createClient({ apiKey: "rb_conformance", baseUrl: MOCK });

    const result = await generateText({
      model,
      tools: rendobarTools({ client }),
      stopWhen: stepCountIs(5),
      prompt: "Probe this video.",
    });

    const outputs = result.steps.flatMap((s) => s.toolResults.map((r) => ({ tool: r.toolName, output: r.output })));
    expect(outputs.map((o) => o.tool)).toEqual(["list_job_types", "run_job", "get_job"]);
    expect(Array.isArray(outputs[0]?.output)).toBe(true);
    expect(outputs[1]?.output).toMatchObject({ id: expect.stringMatching(/^job_/) });
    expect(outputs[2]?.output).toMatchObject({ error: { code: "NOT_FOUND", requestId: expect.stringMatching(/^req_/) } });
    expect(result.text).toBe("Done.");

    // One job was created, through the SDK's retry-safe submit.
    const created = await (await fetch(`${MOCK}/__created`)).json();
    expect(created.data.count).toBe(1);
  });

  it("rejects input the schema does not allow before anything is called", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [call("1", "probe_media", { url: "not a url" }), done] });
    const client = createClient({ apiKey: "rb_conformance", baseUrl: MOCK });

    const result = await generateText({ model, tools: rendobarTools({ client }), stopWhen: stepCountIs(3), prompt: "x" });

    const errors = result.steps.flatMap((s) => s.content.filter((c) => c.type === "tool-error"));
    expect(errors).toHaveLength(1);
    const created = await (await fetch(`${MOCK}/__created`)).json();
    expect(created.data.count).toBe(0);
  });
});
