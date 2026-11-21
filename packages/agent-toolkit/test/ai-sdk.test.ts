/**
 * A real AI SDK agent loop (`generateText` with `stopWhen`) drives the tools
 * against the shared conformance mock. Only the model is scripted: the AI SDK
 * validates inputs, runs `execute`, and feeds results back exactly as it would
 * with a real model.
 */
import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import { rendobarTools } from "../src/ai-sdk.js";
import { createdCount, mockClient, reset } from "./helpers.js";

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

beforeEach(() => reset());

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
    const result = await generateText({
      model,
      tools: rendobarTools({ client: mockClient() }),
      stopWhen: stepCountIs(5),
      prompt: "Probe this video.",
    });

    const outputs = result.steps.flatMap((s) => s.toolResults.map((r) => ({ tool: r.toolName, output: r.output })));
    expect(outputs.map((o) => o.tool)).toEqual(["list_job_types", "run_job", "get_job"]);
    expect(outputs[0]?.output).toMatchObject({ jobTypes: expect.any(Array) });
    expect(outputs[1]?.output).toMatchObject({ job: { id: expect.stringMatching(/^job_/) } });
    expect(outputs[2]?.output).toMatchObject({ error: { code: "NOT_FOUND", requestId: expect.stringMatching(/^req_/) } });
    expect(result.text).toBe("Done.");

    // One job was created, through the SDK's retry-safe submit.
    expect(await createdCount()).toBe(1);
  });

  it("answers input the schema does not allow with a VALIDATION_ERROR result the model can fix", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [call("1", "probe_media", { url: "example.com/a.mp4" }), done] });

    const result = await generateText({ model, tools: rendobarTools({ client: mockClient() }), stopWhen: stepCountIs(3), prompt: "x" });

    const outputs = result.steps.flatMap((s) => s.toolResults.map((r) => r.output));
    expect(outputs).toEqual([expect.objectContaining({ error: expect.objectContaining({ code: "VALIDATION_ERROR", problems: [{ path: ["url"], message: "Invalid URL" }] }) })]);
    expect(await createdCount()).toBe(0);
  });
});
