/**
 * Runs the agent and every Rendobar tool. Mock mode points the client at the
 * shared conformance mock, live mode at a real Rendobar API (three ffprobe
 * jobs and one 2-second ffmpeg trim). The model is always the scripted one.
 *
 *   RENDOBAR_MODE=mock|live RENDOBAR_API_URL=... RENDOBAR_API_KEY=... npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isToolFailure, rendobarToolDefinitions, type JobResult, type JobSummary, type ToolResult } from "@rendobar/agent-toolkit";
import { rendobarTools, type RendobarTools } from "@rendobar/agent-toolkit/ai-sdk";
import { rendobarTools as langchainTools, type RendobarLangChainTool } from "@rendobar/agent-toolkit/langchain";
import { createClient, isApiError, type ClientConfig } from "@rendobar/sdk";
import { generateText, stepCountIs, type StaticToolResult, type StepResult } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { runEditor, SAMPLE_VIDEO, trimRequest } from "../src/agent.js";
import { answer, field, scriptedEditor, toolCall } from "../src/editor-model.js";

const live = process.env["RENDOBAR_MODE"] === "live";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
}

const skipInMock = (why: string) => console.log(`SKIP (mock: ${why})`);

const client = (config: Omit<ClientConfig, "apiKey" | "baseUrl"> = {}) => createClient({ apiKey: required("RENDOBAR_API_KEY"), baseUrl: required("RENDOBAR_API_URL"), ...config });

/** A client that counts what it sends, to prove a refusal sent nothing. */
function counting() {
  const sent: string[] = [];
  const rb = client({
    fetch: (url, init) => {
      sent.push(String(url));
      return fetch(url, init);
    },
  });
  return { rb, sent };
}

function jobOf(result: ToolResult<JobResult>): JobSummary {
  if (isToolFailure(result)) assert.fail(`${result.error.code}: ${result.error.message}`);
  return result.job;
}

/** The results of Rendobar's tools, typed per tool. Dynamic tools, which this agent has none of, are left out. */
const toolResults = (steps: Array<StepResult<RendobarTools>>) =>
  steps.flatMap((step) => step.toolResults).filter((r): r is StaticToolResult<RendobarTools> => r.dynamic !== true);

const durationOf = (job: JobSummary) => (job.status === "complete" ? field(job.data, "summary", "durationSec") : undefined);

describe("the editor agent (AI SDK)", () => {
  it("probes the video, trims its first 2 seconds and answers with the URL", async () => {
    const result = await runEditor({ model: scriptedEditor(), client: client(), prompt: trimRequest(SAMPLE_VIDEO) });

    console.log(`Agent: ${result.text}`);
    const calls = toolResults(result.steps);
    assert.deepEqual(
      calls.map((c) => c.toolName),
      ["list_job_types", "list_job_types", "probe_media", "run_job", "get_job"],
    );
    const [types, schema, probe, trim, read] = calls;

    assert.ok(types?.toolName === "list_job_types" && !isToolFailure(types.output) && "jobTypes" in types.output);
    assert.ok(types.output.jobTypes.length > 0, "no job types");
    assert.ok(schema?.toolName === "list_job_types" && !isToolFailure(schema.output) && "params" in schema.output, "no ffmpeg params schema");

    assert.ok(probe?.toolName === "probe_media");
    const probed = jobOf(probe.output);
    assert.equal(probed.status, "complete");
    if (live) {
      const duration = durationOf(probed);
      assert.ok(typeof duration === "number" && duration > 0, `duration ${String(duration)}`);
    } else {
      skipInMock("its ffprobe output has no summary, so there is no duration");
    }

    assert.ok(trim?.toolName === "run_job");
    const trimmed = jobOf(trim.output);
    assert.ok(trimmed.status === "complete", `trim ended ${trimmed.status}`);
    const url = trimmed.url;
    assert.ok(url !== null && url.startsWith("https://"), `url ${String(url)}`);
    assert.ok(result.text.endsWith(url), result.text);

    assert.ok(read?.toolName === "get_job");
    assert.equal(jobOf(read.output).id, trimmed.id);

    if (live) {
      const file = trimmed.files[0];
      assert.ok(file !== undefined && file.size > 0, "no output file");
      const download = await fetch(url);
      assert.equal(download.status, 200);
      assert.ok((await download.arrayBuffer()).byteLength > 0, "empty output");
    } else {
      skipInMock("its output URL is a placeholder, so the file is not downloaded");
    }
  });

  it("refuses bad input before any request, and the agent loop goes on", async () => {
    const { rb, sent } = counting();
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCall("call_1", "probe_media", { url: "file:///etc/passwd" }),
        toolCall("call_2", "run_job", { type: "ffmpeg", inputs: { "in.mp4": "javascript:alert(1)" } }),
        toolCall("call_3", "get_job", {}),
        answer("Those inputs were refused."),
      ],
    });
    const result = await generateText({ model, tools: rendobarTools({ client: rb }), stopWhen: stepCountIs(5), prompt: "x" });

    const refusals = toolResults(result.steps).map((c) => (isToolFailure(c.output) ? c.output.error : null));
    assert.deepEqual(
      refusals.map((e) => [e?.code, e?.problems?.map((p) => p.path.join("."))]),
      [
        ["VALIDATION_ERROR", ["url"]],
        ["VALIDATION_ERROR", ["inputs.in.mp4"]],
        ["VALIDATION_ERROR", ["id"]],
      ],
    );
    assert.equal(result.text, "Those inputs were refused.");

    // The same check runs when a definition is called directly: a URL that would add an ffprobe flag.
    const flag = await rendobarToolDefinitions({ client: rb }).probe_media.run({ url: `${SAMPLE_VIDEO} -show_frames` });
    assert.ok(isToolFailure(flag) && flag.error.code === "VALIDATION_ERROR");
    assert.deepEqual(sent, []);
  });

  it("takes asset:// and storage:// inputs as they are", async () => {
    // The submit is answered here, not sent: this proves the tool passes the inputs on, at no cost.
    const bodies: unknown[] = [];
    const rb = client({
      maxRetries: 0,
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "Stopped by the example" } }), { status: 400 });
      },
    });
    const inputs = { "a.mp4": "asset://asset_example123", "b.mp4": "storage://my-bucket/raw/b.mp4" };
    const result = await rendobarToolDefinitions({ client: rb }).run_job.run({ type: "ffmpeg", inputs, params: { command: "-i a.mp4 -i b.mp4 out.mp4" }, wait: false });

    assert.ok(isToolFailure(result) && result.error.message === "Stopped by the example", JSON.stringify(result));
    assert.equal(bodies.length, 1);
    assert.deepEqual(field(bodies[0], "inputs"), inputs);
  });

  it("stops waiting when the run is cancelled, and returns the job's id", async () => {
    const controller = new AbortController();
    // Cancel the agent run on the tool's first status check, so the job exists and the wait is cut short.
    const rb = client({
      fetch: (url, init) => {
        if ((init?.method ?? "GET") === "GET" && /\/jobs\/job_[^/]+$/.test(new URL(String(url)).pathname)) controller.abort();
        return fetch(url, init);
      },
    });
    const model = new MockLanguageModelV4({ doGenerate: [toolCall("call_1", "run_job", { type: "ffprobe", params: { command: SAMPLE_VIDEO } }), answer("Stopped.")] });

    const outputs: unknown[] = [];
    await assert.rejects(
      generateText({
        model,
        tools: rendobarTools({ client: rb }),
        stopWhen: stepCountIs(3),
        prompt: "x",
        abortSignal: controller.signal,
        onStepFinish: (step) => {
          outputs.push(...step.toolResults.map((r) => r.output));
        },
      }),
      (e: unknown) => e instanceof Error && e.name === "AbortError",
    );
    const aborted = outputs[0];
    assert.equal(field(aborted, "error", "code"), "ABORTED");
    const id = field(aborted, "id");
    assert.ok(typeof id === "string" && id.startsWith("job_"), `id ${String(id)}`);

    // The job keeps running on Rendobar. Cancel it, unless it already finished.
    try {
      await client().jobs.cancel(id);
    } catch (e) {
      if (!(isApiError(e) && e.statusCode === 409)) throw e;
    }
  });
});

describe("the same tools on LangChain.js", () => {
  const tools = langchainTools({ client: client() });
  function byName(name: string): RendobarLangChainTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    return tool;
  }

  it("lists job types and answers bad input as data, not a throw", async () => {
    const types = await byName("list_job_types").invoke({});
    assert.ok(Array.isArray(field(types, "jobTypes")));
    const refused = await byName("probe_media").invoke({ url: "example.com/a.mp4" });
    assert.equal(field(refused, "error", "code"), "VALIDATION_ERROR");
  });

  it("answers a tool call from the model with a ToolMessage", async () => {
    const message = await byName("probe_media").invoke({ name: "probe_media", args: { url: SAMPLE_VIDEO }, id: "call_1", type: "tool_call" });
    assert.equal(message.tool_call_id, "call_1");
    const content: unknown = JSON.parse(String(message.content));
    assert.equal(field(content, "job", "status"), "complete");
    if (live) {
      const duration = field(content, "job", "data", "summary", "durationSec");
      assert.ok(typeof duration === "number" && duration > 0, `duration ${String(duration)}`);
    } else {
      skipInMock("its ffprobe output has no summary, so there is no duration");
    }
  });
});
