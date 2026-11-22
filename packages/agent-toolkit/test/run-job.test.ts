/**
 * run_job against the shared conformance mock: a submitted job reports running,
 * then complete. Once a job exists, a failure must point at get_job, because
 * resubmitting would create and bill a second job.
 */
import { createClient, WaitTimeoutError } from "@rendobar/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { rendobarToolDefinitions } from "../src/core.js";
import { abortingOnFirstPoll, answering, createdCount, MOCK, mockClient, recording, refusingSubmits, requests, reset } from "./helpers.js";

beforeEach(() => reset());

describe("run_job", () => {
  it("waits for the job by default and returns it complete, with {} for omitted params", async () => {
    const result = await rendobarToolDefinitions({ client: mockClient() }).run_job.run({ type: "ffprobe" });

    expect(result).toMatchObject({ job: { id: expect.stringMatching(/^job_/), status: "complete", url: expect.stringMatching(/^https:/) } });
    const submits = (await requests()).filter((r) => r.method === "POST" && r.path === "/jobs");
    expect(submits).toHaveLength(1);
  });

  it("returns the job as soon as it is created when wait is false", async () => {
    const result = await rendobarToolDefinitions({ client: mockClient() }).run_job.run({ type: "ffprobe", params: { command: "https://x/a.mp4" }, wait: false });

    expect(result).toMatchObject({ job: { id: expect.stringMatching(/^job_/), status: "running" } });
  });

  it("reports a cancelled job as the job, not as an error", async () => {
    await reset("?cancel_created=1");

    const result = await rendobarToolDefinitions({ client: mockClient() }).run_job.run({ type: "ffprobe", params: { command: "https://x/a.mp4" } });

    expect(result).toMatchObject({ job: { status: "cancelled" } });
    expect(result).not.toHaveProperty("error");
  });

  it("returns the job id, not a retry hint, when the wait fails after the job was created", async () => {
    let polls = 0;
    const client = mockClient({
      maxRetries: 0,
      fetch: async (url, init) => {
        if ((init?.method ?? "GET") === "GET" && String(url).includes("/jobs/job_")) {
          polls += 1;
          throw new TypeError("connection reset");
        }
        return fetch(url, init);
      },
    });

    const result = await rendobarToolDefinitions({ client }).run_job.run({ type: "ffprobe", params: { command: "https://x/a.mp4" } });

    expect(polls).toBeGreaterThan(0);
    // No poll was answered, so the last status known is the one the submit reported.
    expect(result).toMatchObject({ id: expect.stringMatching(/^job_/), status: "waiting", error: { code: "WAIT_FAILED", requestId: null }, hint: expect.stringContaining("get_job") });
    expect(JSON.stringify(result)).not.toMatch(/can be retried/);
  });

  it("reports a wait that runs out as WAIT_TIMEOUT with the job id and its last status", async () => {
    const client = mockClient();
    client.jobs.wait = async (id) => {
      throw new WaitTimeoutError(id, "running", 1000);
    };

    const result = await rendobarToolDefinitions({ client }).run_job.run({ type: "ffprobe", params: { command: "https://x/a.mp4" } });

    expect(result).toMatchObject({ id: expect.stringMatching(/^job_/), status: "running", error: { code: "WAIT_TIMEOUT", requestId: null } });
  });

  it("stops waiting when the signal aborts, and returns the job's id and last status", async () => {
    const controller = new AbortController();
    const { client, seen } = abortingOnFirstPoll(controller);

    const result = await rendobarToolDefinitions({ client }).run_job.run({ type: "ffprobe", params: { command: "https://x/a.mp4" } }, { signal: controller.signal });

    expect(result).toEqual({ id: "job_1", status: "running", error: { code: "ABORTED", message: "The wait was cancelled.", requestId: null }, hint: expect.stringContaining("get_job") });
    expect(seen).toEqual({ submits: 1, polls: 1 });
  });

  it("returns the key it used inside error when the submit gets no answer, and sent that key", async () => {
    const keys: string[] = [];
    const down = createClient({
      apiKey: "rb_test",
      baseUrl: MOCK,
      maxRetries: 0,
      fetch: async (_url, init) => {
        keys.push(JSON.parse(String(init?.body)).idempotencyKey);
        throw new TypeError("connection reset");
      },
    });

    const first = await rendobarToolDefinitions({ client: down }).run_job.run({ type: "ffprobe", params: { command: "https://x/a.mp4" }, wait: false });

    expect(first).toMatchObject({ error: { code: "REQUEST_FAILED", requestId: null, idempotencyKey: expect.stringMatching(/^sdk_[0-9a-f]{32}$/) } });
    expect(first).not.toHaveProperty("job");
    expect(keys).toEqual(["error" in first ? first.error.idempotencyKey : "none"]);
  });

  it("offers a rate-limited submit as a retry, but not a refused one", async () => {
    const params = { type: "ffprobe", params: { command: "https://x/a.mp4" }, wait: false };

    const limited = await rendobarToolDefinitions({ client: answering(429, { code: "RATE_LIMITED", message: "no" }) }).run_job.run(params);
    const refused = await rendobarToolDefinitions({ client: answering(400, { code: "VALIDATION_ERROR", message: "no" }) }).run_job.run(params);

    expect(limited).toMatchObject({ error: { code: "RATE_LIMITED", idempotencyKey: expect.stringMatching(/^sdk_/) } });
    expect(refused).toEqual({ error: { code: "VALIDATION_ERROR", message: "no", requestId: null } });
  });

  it("refuses an empty idempotency key, an empty type and any input that is not an API input form, sending nothing", async () => {
    const { client, sent } = recording();
    const runJob = rendobarToolDefinitions({ client }).run_job;
    const refusedInputs = [
      "file:///etc/passwd",
      "javascript:1",
      "data:video/mp4;base64,AAAA",
      "ftp://x/a.mp4",
      "https://x/a.mp4 -f",
      "https://x/a\tb.mp4",
      "asset://abc123",
      "asset://asset_../x",
      "storage://media-1",
      "storage://media-1/",
      "storage://Media/clip.mp4",
      "storage://m/clip.mp4",
      "storage://media-1/../secret.mp4",
      "storage://media-1/a/%2e%2e/b.mp4",
      "storage://media-1/a//b.mp4",
      "storage://media-1/a b.mp4",
      "storage://media-1/a\u0001b.mp4",
      "storage://media-1/a.mp4?x=1",
      "storage://media-1/a'b.mp4",
    ];

    const attempts = [{ type: "ffmpeg", idempotencyKey: "" }, { type: "" }, ...refusedInputs.map((source) => ({ type: "ffmpeg", inputs: { source } }))];
    for (const input of attempts) {
      expect(await runJob.run(input), JSON.stringify(input)).toMatchObject({ error: { code: "VALIDATION_ERROR", requestId: null } });
    }
    expect(sent).toEqual([]);
  });

  it("sends http(s) URLs, uploaded assets and connected-bucket files as inputs, unchanged", async () => {
    const { client, bodies } = refusingSubmits();
    const inputs = {
      a: "https://cdn.example.com/a.mp4?sig=x-y",
      b: "http://example.com/b.wav",
      c: "asset://asset_Ab3_x-9",
      d: "storage://media-1/folder/clip.mp4",
      e: "storage://media-1/50%25.mp4",
    };

    expect(await rendobarToolDefinitions({ client }).run_job.run({ type: "ffmpeg", inputs })).toMatchObject({ error: { message: "stop here" } });

    expect(bodies).toMatchObject([{ type: "ffmpeg", inputs }]);
  });

  it("keeps probe_media to http(s) URLs, which is what ffprobe takes", async () => {
    const { client, sent } = recording();

    for (const url of ["asset://asset_abc", "storage://media-1/clip.mp4"]) {
      expect(await rendobarToolDefinitions({ client }).probe_media.run({ url }), url).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    }
    expect(sent).toEqual([]);
  });

  it("hands the model each problem the API listed on a refused submit", async () => {
    const result = await rendobarToolDefinitions({ client: mockClient() }).run_job.run({ type: "no_such_type", params: {} });

    expect(result).toMatchObject({
      error: { code: "VALIDATION_ERROR", requestId: expect.stringMatching(/^req_/), problems: [{ path: ["type"], message: 'Unknown job type "no_such_type"' }] },
    });
  });

  it("points an unknown job type at list_job_types, the tool the model has", async () => {
    const client = answering(400, { code: "INVALID_JOB_TYPE", message: 'Unknown job type "bogus".' });

    const result = await rendobarToolDefinitions({ client }).run_job.run({ type: "bogus" });

    expect(result).toEqual({
      error: { code: "INVALID_JOB_TYPE", message: 'Unknown job type "bogus".', requestId: null },
      hint: "Call list_job_types for the live job types.",
    });
  });

  it("reports a key reused with different params as a CONFLICT, with no key to retry", async () => {
    const tools = rendobarToolDefinitions({ client: mockClient() });
    await tools.run_job.run({ type: "ffprobe", params: { command: "https://x/a.mp4" }, idempotencyKey: "k-reuse", wait: false });

    const result = await tools.run_job.run({ type: "ffprobe", params: { command: "https://x/b.mp4" }, idempotencyKey: "k-reuse", wait: false });

    expect(result).toMatchObject({ error: { code: "CONFLICT", requestId: expect.stringMatching(/^req_/) } });
    expect(result).not.toHaveProperty("error.idempotencyKey");
    expect(await createdCount()).toBe(1);
  });
});
