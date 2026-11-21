/**
 * Every failure reaches the model as data with one shape: `{ error: { code,
 * message, requestId, ... } }`. A thrown error would end the whole agent loop.
 */
import { createClient } from "@rendobar/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rendobarToolDefinitions } from "../src/core.js";
import { answering, MOCK, recording, secondSdkCopy } from "./helpers.js";

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

describe("a client from another copy of the SDK", () => {
  it("still has its refusals and wait timeouts recognised, through the SDK's brand checks", async () => {
    const { sdk, remove } = await secondSdkCopy();
    try {
      const client = sdk.createClient({ apiKey: "rb_test", baseUrl: MOCK, maxRetries: 0 });
      client.jobs.wait = async (id) => {
        throw new sdk.WaitTimeoutError(id, "running", 1000);
      };
      const tools = rendobarToolDefinitions({ client });

      expect(await tools.get_job.run({ id: "job_404" })).toMatchObject({ error: { code: "NOT_FOUND", requestId: expect.stringMatching(/^req_/) } });
      expect(await tools.run_job.run({ type: "ffprobe", params: { command: "https://x/a.mp4" } })).toMatchObject({ error: { code: "WAIT_TIMEOUT" }, status: "running" });
    } finally {
      remove();
    }
  });
});

describe("input checks", () => {
  it("names the field, in the problems shape an API refusal uses, and sends nothing", async () => {
    const { client, sent } = recording();

    const result = await rendobarToolDefinitions({ client }).probe_media.run({ url: "example.com/a.mp4" });

    expect(result).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid input for probe_media. url: Invalid URL.", requestId: null, problems: [{ path: ["url"], message: "Invalid URL" }] },
    });
    expect(sent).toEqual([]);
  });

  it("refuses a URL that could add flags to the ffprobe command, sending nothing", async () => {
    const { client, sent } = recording();
    const probe = rendobarToolDefinitions({ client }).probe_media;
    const attempts = [
      "https://x/a.mp4 -show_frames -show_packets",
      "https://x/a.mp4\t-f",
      "https://x/a.mp4\n-o out",
      "-show_frames",
      "https://x/a'b.mp4",
      'https://x/a"b.mp4',
      "https://x/a\\b.mp4",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "ftp://x/a.mp4",
      "data:video/mp4;base64,AAAA",
    ];

    for (const url of attempts) {
      expect(await probe.run({ url }), url).toMatchObject({ error: { code: "VALIDATION_ERROR", problems: [{ path: ["url"] }] } });
    }
    expect(sent).toEqual([]);
  });

  it("sends a valid URL as the whole ffprobe command, unchanged", async () => {
    const bodies: unknown[] = [];
    const client = createClient({
      apiKey: "rb_test",
      baseUrl: "http://api.test",
      maxRetries: 0,
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "stop here" } }), { status: 400 });
      },
    });

    await rendobarToolDefinitions({ client }).probe_media.run({ url: "https://cdn.example.com/a.mp4?sig=x-y&t=1" });

    expect(bodies).toMatchObject([{ type: "ffprobe", params: { command: "https://cdn.example.com/a.mp4?sig=x-y&t=1" } }]);
  });

  it("refuses an empty job type for list_job_types instead of asking the API", async () => {
    const { client, sent } = recording();

    const result = await rendobarToolDefinitions({ client }).list_job_types.run({ type: "" });

    expect(result).toMatchObject({ error: { code: "VALIDATION_ERROR", problems: [{ path: ["type"] }] } });
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
