/**
 * Every example runs here: it submits a job to the shared conformance mock,
 * refuses an unsigned webhook, and accepts one signed the way Rendobar signs.
 */
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createClient } from "@rendobar/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp as expressApp } from "../src/express.js";
import { createApp as honoApp } from "../src/hono.js";

const MOCK = process.env.RENDOBAR_MOCK ?? "http://127.0.0.1:4100";
const SECRET = "whsec_examples";
const rb = () => createClient({ apiKey: "rb_test", baseUrl: MOCK, maxRetries: 0 });

function signed(body: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  return { "content-type": "application/json", "x-rendobar-timestamp": ts, "x-rendobar-signature": `sha256=${sig}` };
}

// The same envelope a real delivery carries (rendobar/openapi conformance/webhook-vectors.json).
const event = JSON.stringify({ version: "1", event: "job.completed", data: { jobId: "job_1" } });
type Call = (path: string, init: RequestInit) => Promise<Response>;

function suite(name: string, call: () => Promise<Call>) {
  describe(name, () => {
    let send: Call;
    beforeAll(async () => {
      send = await call();
    });

    it("submits a job", async () => {
      const res = await send("/videos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://x/a.mp4" }) });
      expect(res.status).toBe(202);
      expect((await res.json()).jobId).toMatch(/^job_/);
    });

    it("refuses an unsigned webhook", async () => {
      const res = await send("/rendobar-webhook", { method: "POST", headers: { "content-type": "application/json" }, body: event });
      expect(res.status).toBe(401);
    });

    it("accepts a signed webhook", async () => {
      const res = await send("/rendobar-webhook", { method: "POST", headers: signed(event), body: event });
      expect(res.status).toBe(204);
    });
  });
}

suite("Express", async () => {
  const server = expressApp(rb(), SECRET).listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo; // listen(0) on TCP always yields an AddressInfo
  return (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
});

describe("startup", () => {
  it("refuses to start without a webhook secret", () => {
    expect(() => expressApp(rb(), "")).toThrow(/RENDOBAR_WEBHOOK_SECRET/);
    expect(() => honoApp(rb(), "")).toThrow(/RENDOBAR_WEBHOOK_SECRET/);
  });
});

suite("Hono", async () => {
  const app = honoApp(rb(), SECRET);
  return async (path, init) => app.request(path, init);
});

suite("Next.js route handlers", async () => {
  process.env.RENDOBAR_API_KEY = "rb_test";
  process.env.RENDOBAR_API_URL = MOCK;
  process.env.RENDOBAR_WEBHOOK_SECRET = SECRET;
  const videos = await import("../src/nextjs/app/api/videos/route.js");
  const webhook = await import("../src/nextjs/app/api/rendobar-webhook/route.js");
  return async (path, init) => {
    const request = new Request(`http://localhost${path}`, init);
    return path === "/videos" ? videos.POST(request) : webhook.POST(request);
  };
});
