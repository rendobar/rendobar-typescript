/**
 * Every failure reaches the model as data with one shape: `{ error: { code,
 * message, requestId, ... } }`. A thrown error would end the whole agent loop.
 */
import { createClient } from "@rendobar/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rendobarToolDefinitions } from "../src/core.js";
import { answering, recording } from "./helpers.js";

describe("tool errors", () => {
  it("returns a network failure as an error object instead of throwing", async () => {
    const client = createClient({
      apiKey: "rb_test",
      baseUrl: "http://api.test",
      maxRetries: 0,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });

    const result = await rendobarToolDefinitions({ client }).get_job.run({ id: "job_1" });

    expect(result).toEqual({ error: { code: "REQUEST_FAILED", message: "fetch failed. The call can be retried.", requestId: null } });
  });

  it("reports a missing job type as NOT_FOUND with the request id", async () => {
    const result = await rendobarToolDefinitions({ client: answering(404, { code: "NOT_FOUND", message: "no" }) }).list_job_types.run({ type: "bogus" });

    expect(result).toEqual({ error: { code: "NOT_FOUND", message: 'Job type "bogus" is not live. Call list_job_types.', requestId: null } });
  });
});

describe("input checks", () => {
  it("names the field, in the problems shape an API refusal uses, and sends nothing", async () => {
    const { client, sent } = recording();

    const result = await rendobarToolDefinitions({ client }).probe_media.run({ url: "not a url" });

    expect(result).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid input for probe_media. url: Invalid URL.", requestId: null, problems: [{ path: ["url"], message: "Invalid URL" }] },
    });
    expect(sent).toEqual([]);
  });

  it("refuses an id that is not a job id before sending anything", async () => {
    const { client, sent } = recording();
    const tools = rendobarToolDefinitions({ client });

    for (const id of ["", "a/b", ".."]) {
      expect(await tools.get_job.run({ id })).toMatchObject({ error: { code: "INVALID_ARGUMENT", requestId: null } });
    }
    expect(sent).toEqual([]);
  });
});

describe("no API key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the SDK's local MISSING_API_KEY as data, sending nothing", async () => {
    vi.stubEnv("RENDOBAR_API_KEY", "");
    const { client: keyless, sent } = recording(null);

    for (const tools of [rendobarToolDefinitions(), rendobarToolDefinitions({ client: keyless })]) {
      for (const result of [await tools.run_job.run({ type: "ffprobe" }), await tools.get_job.run({ id: "job_1" }), await tools.probe_media.run({ url: "https://x/a.mp4" })]) {
        expect(result).toMatchObject({ error: { code: "MISSING_API_KEY", message: expect.stringContaining("RENDOBAR_API_KEY"), requestId: null } });
      }
    }
    expect(sent).toEqual([]);
  });
});
