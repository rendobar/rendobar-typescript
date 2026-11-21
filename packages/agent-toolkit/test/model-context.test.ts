/**
 * What a finished ffprobe job costs the model. Its raw sections repeat the
 * summary at several times the size, so the tools return the summary and leave
 * the raw output to get_job with `raw: true`.
 */
import { createClient } from "@rendobar/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { rendobarToolDefinitions } from "../src/core.js";

const MOCK = process.env.RENDOBAR_MOCK ?? "http://127.0.0.1:4100";
const PROBE = {
  summary: { kind: "video", durationSec: 10, video: { codec: "h264", width: 1280, height: 720 } },
  format: { filename: "https://x/a.mp4", format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "10.000000" },
  streams: [{ index: 0, codec_type: "video", codec_name: "h264", width: 1280, height: 720, disposition: { default: 1 } }],
  chapters: [],
  warnings: [{ code: "NO_AUDIO", message: "The file has no audio stream." }],
};

/** The mock's job, as a completed ffprobe job carrying PROBE. */
function probeClient(type = "ffprobe", cost: unknown = { amount: 1000000, currency: "USD", formatted: "$0.0010" }) {
  return createClient({
    apiKey: "rb_test",
    baseUrl: MOCK,
    fetch: async (url, init) => {
      const res = await fetch(url, init);
      if ((init?.method ?? "GET") !== "GET" || !String(url).includes("/jobs/job_")) return res;
      const body = await res.json();
      body.data = { ...body.data, type, status: "complete", cost, output: { data: PROBE, file: null, files: [], expiresAt: 1731000000000 } };
      return new Response(JSON.stringify(body), { status: res.status, headers: { "content-type": "application/json" } });
    },
  });
}

beforeEach(async () => {
  await fetch(`${MOCK}/__reset`, { method: "POST" });
});

describe("ffprobe results", () => {
  it("returns the summary and warnings, and says how to get the raw output", async () => {
    const result = await rendobarToolDefinitions({ client: probeClient() }).get_job.run({ id: "job_1" });

    expect(result).toMatchObject({ id: "job_1", status: "complete", data: { summary: PROBE.summary, warnings: PROBE.warnings } });
    expect(result).toHaveProperty("data", { summary: PROBE.summary, warnings: PROBE.warnings });
    expect(JSON.stringify(result)).toMatch(/get_job .*raw: true/);
  });

  it("returns every raw section when asked for raw", async () => {
    const result = await rendobarToolDefinitions({ client: probeClient() }).get_job.run({ id: "job_1", raw: true });

    expect(result).toHaveProperty("data", PROBE);
    expect(result).not.toHaveProperty("hint");
  });

  it("trims probe_media's result the same way", async () => {
    const result = await rendobarToolDefinitions({ client: probeClient() }).probe_media.run({ url: "https://x/a.mp4" });

    expect(result).toHaveProperty("data", { summary: PROBE.summary, warnings: PROBE.warnings });
  });

  it("leaves another job type's data alone", async () => {
    const result = await rendobarToolDefinitions({ client: probeClient("ffmpeg") }).get_job.run({ id: "job_1" });

    expect(result).toHaveProperty("data", PROBE);
  });

  it("says when the cost has not settled yet, instead of reporting none", async () => {
    const settled = await rendobarToolDefinitions({ client: probeClient("ffmpeg") }).get_job.run({ id: "job_1" });
    const unsettled = await rendobarToolDefinitions({ client: probeClient("ffmpeg", null) }).get_job.run({ id: "job_1" });

    // Integer nanodollars, as every Rendobar SDK reports cost, with the display string beside it.
    expect(settled).toMatchObject({ cost: { amount: 1000000, currency: "USD", formatted: "$0.0010" } });
    expect(settled).not.toHaveProperty("hint");
    expect(unsettled).not.toHaveProperty("cost");
    expect(unsettled).toHaveProperty("hint", "The cost settles shortly after completion. Call get_job later to read it.");
  });
});
