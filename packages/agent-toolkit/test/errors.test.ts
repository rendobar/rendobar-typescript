/**
 * Every failure reaches the model as data. A thrown error would end the whole
 * agent loop, so a dropped connection must come back as something to act on.
 */
import { createClient } from "@rendobar/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rendobarToolDefinitions } from "../src/core.js";

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
    const tools = rendobarToolDefinitions({ client });

    const result = await tools.get_job.run({ id: "job_1" });

    expect(result).toEqual({ error: { code: "REQUEST_FAILED", message: "fetch failed. The call can be retried." } });
  });

  it("checks input itself, so a bad url names url and sends nothing", async () => {
    const sent: string[] = [];
    const client = createClient({
      apiKey: "rb_test",
      baseUrl: "http://api.test",
      fetch: async (url) => {
        sent.push(String(url));
        return new Response("{}");
      },
    });

    const result = await rendobarToolDefinitions({ client }).probe_media.run({ url: "not a url" });

    expect(result).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid input for probe_media. url: Invalid URL.", problems: [{ path: ["url"], message: "Invalid URL" }] },
    });
    expect(sent).toEqual([]);
  });
});

describe("no API key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the SDK's local MISSING_API_KEY as data, sending nothing", async () => {
    vi.stubEnv("RENDOBAR_API_KEY", "");
    const sent: string[] = [];
    const keyless = createClient({
      baseUrl: "http://api.test",
      fetch: async (url) => {
        sent.push(String(url));
        return new Response("{}");
      },
    });

    for (const tools of [rendobarToolDefinitions(), rendobarToolDefinitions({ client: keyless })]) {
      for (const result of [await tools.run_job.run({ type: "ffprobe" }), await tools.get_job.run({ id: "job_1" }), await tools.probe_media.run({ url: "https://x/a.mp4" })]) {
        expect(result).toMatchObject({ error: { code: "MISSING_API_KEY", message: expect.stringContaining("RENDOBAR_API_KEY") } });
      }
    }
    expect(sent).toEqual([]);
  });
});
