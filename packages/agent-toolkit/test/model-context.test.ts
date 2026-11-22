/**
 * What a result costs the model's context, and that it stays typed data: an
 * ffprobe job returns its summary, a huge params schema is shortened, and a
 * status from a newer API arrives as an `unknown` job instead of a crash.
 */
import { createClient } from "@rendobar/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { rendobarToolDefinitions } from "../src/core.js";
import { MOCK, reset, rewritingJobs } from "./helpers.js";

const PROBE = {
  summary: { kind: "video", durationSec: 10, video: { codec: "h264", width: 1280, height: 720 } },
  format: { filename: "https://x/a.mp4", format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "10.000000" },
  streams: [{ index: 0, codec_type: "video", codec_name: "h264", width: 1280, height: 720, disposition: { default: 1 } }],
  chapters: [],
  warnings: [{ code: "NO_AUDIO", message: "The file has no audio stream." }],
};
const COST = { amount: 1000000, currency: "USD", formatted: "$0.0010" };

/** The mock's job, as a completed job of this type carrying PROBE. */
const completed = (type = "ffprobe", cost: unknown = COST) =>
  rewritingJobs((job) => ({ ...job, type, status: "complete", cost, output: { data: PROBE, file: null, files: [], expiresAt: 1731000000000 } }));

beforeEach(() => reset());

describe("ffprobe results", () => {
  it("returns the summary and warnings, and says how to get the raw output", async () => {
    const result = await rendobarToolDefinitions({ client: completed() }).get_job.run({ id: "job_1" });

    expect(result).toEqual({
      job: { id: "job_1", type: "ffprobe", status: "complete", cost: COST, url: null, files: [], data: { summary: PROBE.summary, warnings: PROBE.warnings } },
      hint: "This is ffprobe's summary. For its full raw output, call get_job with this id and raw: true.",
    });
  });

  it("returns every raw section when asked for raw", async () => {
    const result = await rendobarToolDefinitions({ client: completed() }).get_job.run({ id: "job_1", raw: true });

    expect(result).toMatchObject({ job: { data: PROBE } });
    expect(result).not.toHaveProperty("hint");
  });

  it("trims probe_media's result the same way", async () => {
    const result = await rendobarToolDefinitions({ client: completed() }).probe_media.run({ url: "https://x/a.mp4" });

    expect(result).toMatchObject({ job: { data: { summary: PROBE.summary, warnings: PROBE.warnings } } });
  });

  it("leaves another job type's data alone", async () => {
    const result = await rendobarToolDefinitions({ client: completed("ffmpeg") }).get_job.run({ id: "job_1" });

    expect(result).toMatchObject({ job: { data: PROBE } });
  });
});

describe("cost", () => {
  it("is integer nanodollars beside the display string, and null with a hint until billing settles", async () => {
    const settled = await rendobarToolDefinitions({ client: completed("ffmpeg") }).get_job.run({ id: "job_1" });
    const unsettled = await rendobarToolDefinitions({ client: completed("ffmpeg", null) }).get_job.run({ id: "job_1" });

    expect(settled).toMatchObject({ job: { cost: COST } });
    expect(settled).not.toHaveProperty("hint");
    expect(unsettled).toEqual(expect.objectContaining({ job: expect.objectContaining({ cost: null }), hint: "The cost settles shortly after completion. Call get_job later to read it." }));
  });
});

describe("a newer API", () => {
  it("delivers a status this toolkit does not know as an unknown job with the reported status", async () => {
    const result = await rendobarToolDefinitions({ client: createClient({ apiKey: "rb_test", baseUrl: MOCK }) }).get_job.run({ id: "job_future" });

    expect(result).toEqual({ job: { id: "job_future", type: expect.any(String), cost: expect.anything(), status: "unknown", reportedStatus: "paused" } });
  });

  it("ends run_job's wait on an unknown status the API marks terminal, and returns that job", async () => {
    await reset("?archive_created=1");

    const result = await rendobarToolDefinitions({ client: createClient({ apiKey: "rb_test", baseUrl: MOCK }) }).run_job.run({ type: "ffprobe", params: { command: "https://x/a.mp4" } });

    expect(result).toMatchObject({ job: { status: "unknown", reportedStatus: "archived" } });
    expect(result).not.toHaveProperty("error");
  });
});

describe("list_job_types", () => {
  /** A client whose schema endpoint answers with a schema of about `kb` KB. */
  const schemaOf = (kb: number) => {
    const properties = Object.fromEntries(
      Array.from({ length: kb * 4 }, (_, i) => [`field${i}`, { type: "object", description: `Field ${i}. ${"More words. ".repeat(10)}`, properties: { x: { type: "number" } } }]),
    );
    const jsonSchema = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties };
    return createClient({
      baseUrl: MOCK,
      fetch: async () =>
        new Response(JSON.stringify({ data: { type: "big", fields: [], inputs: { fields: [{ key: "source", name: "source" }], variadic: false }, jsonSchema } }), {
          headers: { "content-type": "application/json" },
        }),
    });
  };

  it("returns a small schema whole, without connector fields, and the input names", async () => {
    const result = await rendobarToolDefinitions({ client: schemaOf(1) }).list_job_types.run({ type: "big" });

    expect(result).toMatchObject({ type: "big", inputs: { names: ["source"], anyName: false } });
    expect(result).not.toHaveProperty("trimmed");
    expect(result).not.toHaveProperty("fields");
    expect(JSON.stringify(result)).not.toContain("$schema");
  });

  it("shortens a schema too large for a model's context, and says how to get it whole", async () => {
    const tools = rendobarToolDefinitions({ client: schemaOf(200) });

    const short = await tools.list_job_types.run({ type: "big" });
    const full = await tools.list_job_types.run({ type: "big", full: true });

    expect(JSON.stringify(short).length).toBeLessThan(17_000);
    expect(short).toMatchObject({ trimmed: expect.stringMatching(/descriptions|outline/), hint: expect.stringContaining("full: true") });
    expect(JSON.stringify(full).length).toBeGreaterThan(150_000);
    expect(full).not.toHaveProperty("trimmed");
  });

  it("lists job types as an object the API can add to", async () => {
    const result = await rendobarToolDefinitions({ client: createClient({ baseUrl: MOCK }) }).list_job_types.run({});

    expect(result).toMatchObject({ jobTypes: expect.arrayContaining([expect.objectContaining({ type: expect.any(String) })]) });
  });
});
