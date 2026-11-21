/**
 * run_job against the shared conformance mock: a submitted job reports running,
 * then complete. Once a job exists, a failure must point at get_job, because
 * resubmitting would create and bill a second job.
 */
import { createClient } from "@rendobar/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { rendobarToolDefinitions } from "../src/core.js";

const MOCK = process.env.RENDOBAR_MOCK ?? "http://127.0.0.1:4100";

beforeEach(async () => {
  await fetch(`${MOCK}/__reset`, { method: "POST" });
});

describe("run_job", () => {
  it("waits for the job and returns its output URL", async () => {
    const tools = rendobarToolDefinitions({ client: createClient({ apiKey: "rb_test", baseUrl: MOCK }) });

    const result = await tools.run_job.run({ type: "ffprobe", params: { command: "https://x/a.mp4" }, wait: true });

    expect(result).toMatchObject({ status: "complete", url: expect.stringMatching(/^https:/) });
  });

  it("returns the job id, not a retry hint, when the wait fails after the job was created", async () => {
    let polls = 0;
    const client = createClient({
      apiKey: "rb_test",
      baseUrl: MOCK,
      maxRetries: 0,
      fetch: async (url, init) => {
        if ((init?.method ?? "GET") === "GET" && String(url).includes("/jobs/job_")) {
          polls += 1;
          throw new TypeError("connection reset");
        }
        return fetch(url, init);
      },
    });
    const tools = rendobarToolDefinitions({ client });

    const result = await tools.run_job.run({ type: "ffprobe", params: { command: "https://x/a.mp4" }, wait: true });

    expect(polls).toBeGreaterThan(0);
    expect(result).toMatchObject({ id: expect.stringMatching(/^job_/), error: { code: "WAIT_FAILED" } });
    expect(JSON.stringify(result)).not.toMatch(/can be retried/);
  });

  it("returns the key it used when the submit gets no answer, and a retry reuses it", async () => {
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

    expect(first).toMatchObject({ idempotencyKey: expect.stringMatching(/^sdk_[0-9a-f]{32}$/), error: { code: "REQUEST_FAILED" } });
    expect(first).not.toHaveProperty("id");
    const key = (first as { idempotencyKey: string }).idempotencyKey;
    expect(keys).toEqual([key]);
  });

  it("offers a rate-limited submit as a retry, but not a refused one", async () => {
    const answering = (status: number, code: string) =>
      createClient({
        apiKey: "rb_test",
        baseUrl: MOCK,
        maxRetries: 0,
        fetch: async () => new Response(JSON.stringify({ error: { code, message: "no" } }), { status, headers: { "content-type": "application/json" } }),
      });
    const params = { type: "ffprobe", params: { command: "https://x/a.mp4" }, wait: false };

    const limited = await rendobarToolDefinitions({ client: answering(429, "RATE_LIMITED") }).run_job.run(params);
    const refused = await rendobarToolDefinitions({ client: answering(400, "VALIDATION_ERROR") }).run_job.run(params);

    expect(limited).toMatchObject({ idempotencyKey: expect.stringMatching(/^sdk_/), error: { code: "RATE_LIMITED" } });
    expect(refused).toEqual({ error: { code: "VALIDATION_ERROR", message: "no", requestId: null } });
  });

  it("reads a job type's schema through the caller's client", async () => {
    const seen: string[] = [];
    const client = createClient({
      baseUrl: MOCK,
      fetch: async (url, init) => {
        seen.push(String(url));
        return fetch(url, init);
      },
    });
    const tools = rendobarToolDefinitions({ client });

    await tools.list_job_types.run({ type: "ffprobe" });

    expect(seen.some((u) => u.startsWith(MOCK) && u.includes("/jobs/types/ffprobe/schema"))).toBe(true);
  });
});
