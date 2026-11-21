/**
 * The Mastra and LangChain.js adapters, each driven through its framework's own
 * tool interface against the shared conformance mock. Same tools, same
 * behaviour as the AI SDK adapter: errors come back as data.
 */
import { createClient } from "@rendobar/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { rendobarTools as langchainTools } from "../src/langchain.js";
import { rendobarTools as mastraTools } from "../src/mastra.js";

const MOCK = process.env.RENDOBAR_MOCK ?? "http://127.0.0.1:4100";
const client = () => createClient({ apiKey: "rb_test", baseUrl: MOCK, maxRetries: 0 });

beforeEach(async () => {
  await fetch(`${MOCK}/__reset`, { method: "POST" });
});

describe("Mastra adapter", () => {
  it("runs a job and reports a missing one as data", async () => {
    const tools = mastraTools({ client: client() });
    expect(Object.keys(tools).sort()).toEqual(["get_job", "list_job_types", "probe_media", "run_job"]);
    const created = await tools.run_job.execute!({ type: "ffprobe", params: { command: "https://x/a.mp4" }, wait: false }, {} as never);
    expect((created as { id: string }).id).toMatch(/^job_/);
    const missing = await tools.get_job.execute!({ id: "job_404" }, {} as never);
    expect(missing).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("LangChain.js adapter", () => {
  it("runs a job and reports a missing one as data", async () => {
    const tools = langchainTools({ client: client() });
    expect(tools.map((t) => t.name).sort()).toEqual(["get_job", "list_job_types", "probe_media", "run_job"]);
    const [, runJob, getJob] = tools;
    const created = await runJob.invoke({ type: "ffprobe", params: { command: "https://x/a.mp4" }, wait: false });
    expect((created as { id: string }).id).toMatch(/^job_/);
    const missing = await getJob.invoke({ id: "job_404" });
    expect(missing).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
