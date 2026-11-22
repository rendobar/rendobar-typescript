/**
 * Boots the example app and talks to it over HTTP. Mock mode points it at the
 * shared conformance mock, live mode at a real Rendobar API (one ffprobe job).
 *
 *   RENDOBAR_MODE=mock|live RENDOBAR_API_URL=... RENDOBAR_API_KEY=... npm test
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test, type TestingModule } from "@nestjs/testing";
import { RendobarClient, type WebhookEventDataMap } from "@rendobar/nestjs";
import { createClient, isApiError, type WebhookEndpoint } from "@rendobar/sdk";
import { AppModule } from "../src/app.module";
import { createApp } from "../src/main";
import { VideosService } from "../src/videos.service";
import { WebhookReceiverModule } from "../src/webhook-receiver.module";

const live = process.env["RENDOBAR_MODE"] === "live";
const SAMPLE = "https://cdn.rendobar.com/assets/examples/sample.mp4";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
}

const skipInMock = (why: string) => console.log(`SKIP (mock: ${why})`);

/** Signs a body the way Rendobar does: HMAC-SHA256 over `${timestamp}.${body}`. */
function signed(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): Record<string, string> {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { "content-type": "application/json", "x-rendobar-signature": `sha256=${signature}`, "x-rendobar-timestamp": String(timestamp) };
}

/** A delivery body as Rendobar sends it. `event` is a string so a test can send one newer than the SDK. */
const envelope = (event: string, data: object) =>
  JSON.stringify({ version: "1", event, deliveryId: "whd_example", timestamp: Math.floor(Date.now() / 1000), orgId: "org_example", data });

const outFile = { url: "https://cdn.rendobar.com/out.mp4", path: "out.mp4", type: "video", size: 1024, sha256: null } as const;
const completed = {
  jobId: "job_1",
  jobType: "ffmpeg",
  status: "complete",
  output: { data: null, file: outFile, files: [outFile], expiresAt: 1733592000000 },
  timing: { createdAt: 1731000000000, completedAt: 1731000002000 },
} satisfies WebhookEventDataMap["job.completed"];
const failed = {
  jobId: "job_2",
  jobType: "ffmpeg",
  status: "failed",
  error: { code: "INPUT_UNREADABLE", message: "The input could not be read", detail: null, retryable: false },
  timing: { createdAt: 1731000000000, failedAt: 1731000001000 },
} satisfies WebhookEventDataMap["job.failed"];

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

async function body(res: Response): Promise<unknown> {
  const text = await res.text();
  return text === "" ? null : JSON.parse(text);
}

async function listen(app: NestExpressApplication): Promise<string> {
  await app.listen(0, "127.0.0.1");
  return app.getUrl();
}

describe("AppModule: forRootAsync with ConfigService", () => {
  const rb = createClient({ apiKey: required("RENDOBAR_API_KEY"), baseUrl: required("RENDOBAR_API_URL") });
  let endpoint: WebhookEndpoint | undefined;
  let app: NestExpressApplication | undefined;
  let base = "";

  before(async () => {
    // A real endpoint gives a real signing secret. Rendobar cannot reach this app,
    // so the test signs its own deliveries with that secret.
    endpoint = await rb.webhooks.create({ name: "nestjs example", url: "https://example.com/rendobar-webhook", subscribedEvents: ["job.completed"] });
    process.env["RENDOBAR_WEBHOOK_SECRET"] = endpoint.signingSecret;
    app = await createApp({ logger: false });
    base = await listen(app);
  });

  after(async () => {
    await app?.close();
    if (endpoint) await rb.webhooks.delete(endpoint.id);
  });

  const secret = () => required("RENDOBAR_WEBHOOK_SECRET");
  const deliver = (payload: string, headers = signed(secret(), payload)) => fetch(`${base}/webhooks/rendobar`, { method: "POST", headers, body: payload });

  it("injects the SDK client by type", async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      assert.ok(moduleRef.get(VideosService) instanceof VideosService);
      const types = await moduleRef.get(RendobarClient).jobs.types();
      assert.ok(types.length > 0, "no job types");
    } finally {
      await moduleRef.close();
    }
  });

  it("POST /videos/probe runs ffprobe and answers the typed result", async () => {
    const res = await fetch(`${base}/videos/probe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: SAMPLE }) });
    assert.equal(res.status, 200);
    const facts = await body(res);
    const jobId = field(facts, "jobId");
    assert.ok(typeof jobId === "string" && jobId.startsWith("job_"), `jobId ${String(jobId)}`);

    if (live) {
      const duration = field(facts, "durationSec");
      const width = field(facts, "width");
      assert.ok(typeof duration === "number" && duration > 0, `durationSec ${String(duration)}`);
      assert.ok(typeof width === "number" && width > 0, `width ${String(width)}`);
      assert.equal(typeof field(facts, "videoCodec"), "string");
    } else {
      skipInMock("its ffprobe output has no summary, so duration and size are null");
    }

    const status = await fetch(`${base}/videos/jobs/${jobId}`);
    assert.equal(status.status, 200);
    assert.equal(field(await body(status), "status"), "complete");
  });

  it("POST /videos/probe without a url answers 400", async () => {
    const res = await fetch(`${base}/videos/probe`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 400);
  });

  it("answers a Rendobar refusal with 502, not Rendobar's own 404", async () => {
    const res = await fetch(`${base}/videos/jobs/job_404`);
    assert.equal(res.status, 502);
    assert.deepEqual(await body(res), { statusCode: 502, message: "Bad Gateway" });
  });

  it("dispatches each verified event by type", async () => {
    const cases: Array<[string, string]> = [
      [envelope("job.completed", completed), "job job_1 complete: https://cdn.rendobar.com/out.mp4"],
      [envelope("job.failed", failed), "job job_2 failed: INPUT_UNREADABLE"],
      [envelope("test", { message: "hello", endpointId: "whe_1" }), "test delivery for endpoint whe_1"],
      // An event newer than this SDK is acknowledged, not refused.
      [envelope("job.paused", { jobId: "job_3" }), "ignored job.paused"],
    ];
    for (const [payload, handled] of cases) {
      const res = await deliver(payload);
      assert.equal(res.status, 200, payload);
      assert.deepEqual(await body(res), { handled });
    }
  });

  it("refuses a bad or stale signature with 401, and a signed non-envelope with 400", async () => {
    const payload = envelope("test", { message: "hello", endpointId: "whe_1" });
    assert.equal((await deliver(payload, signed("whsec_wrong", payload))).status, 401);
    assert.equal((await deliver(payload, signed(secret(), payload, Math.floor(Date.now() / 1000) - 3600))).status, 401);
    assert.equal((await deliver(payload, { "content-type": "application/json" })).status, 401);
    assert.equal((await deliver('{"hello":"world"}')).status, 400);
  });
});

/** One case of rendobar/openapi conformance/webhook-vectors.json. Only the fields this test reads. */
type Vector = { name: string; expect: boolean; headers: Record<string, string>; body: string | undefined; ownSecret: boolean; now: number | undefined; skipped: boolean };
type Vectors = { secret: string; timestamp: number; body: string; cases: Vector[] };

const optional = <T>(value: unknown, guard: (v: unknown) => v is T): T | undefined => (guard(value) ? value : undefined);
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number";

function toVector(c: unknown): Vector {
  const name = field(c, "name");
  const expect = field(c, "expect");
  const rawHeaders = field(c, "headers");
  if (typeof name !== "string" || typeof expect !== "boolean" || typeof rawHeaders !== "object" || rawHeaders === null) throw new Error("malformed webhook vector");
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders)) if (typeof value === "string") headers[key] = value;
  const notFor = field(c, "notFor");
  return {
    name,
    expect,
    headers,
    body: optional(field(c, "body"), isString),
    ownSecret: field(c, "secret") !== undefined,
    now: optional(field(c, "now"), isNumber),
    skipped: Array.isArray(notFor) && notFor.includes("typescript"),
  };
}

function readVectors(file: string): Vectors {
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  const secret = field(raw, "secret");
  const timestamp = field(raw, "timestamp");
  const signedBody = field(raw, "body");
  const cases = field(raw, "cases");
  if (typeof secret !== "string" || typeof timestamp !== "number" || typeof signedBody !== "string" || !Array.isArray(cases)) {
    throw new Error(`${file} is not the webhook vectors file`);
  }
  return { secret, timestamp, body: signedBody, cases: cases.map((c: unknown) => toVector(c)) };
}

describe("WebhookReceiverModule: webhooks only, no API key", () => {
  const vectorsFile = process.env["RENDOBAR_WEBHOOK_VECTORS"];
  // The shared vectors from rendobar/openapi conformance/webhook-vectors.json, when given.
  const vectors = vectorsFile ? readVectors(vectorsFile) : undefined;
  const secret = vectors?.secret ?? `whsec_${"e".repeat(64)}`;
  const savedKey = process.env["RENDOBAR_API_KEY"];
  let moduleRef: TestingModule | undefined;
  let app: NestExpressApplication | undefined;
  let base = "";

  before(async () => {
    delete process.env["RENDOBAR_API_KEY"];
    moduleRef = await Test.createTestingModule({ imports: [WebhookReceiverModule.withSecret(secret)] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false });
    base = await listen(app);
  });

  after(async () => {
    await app?.close();
    if (savedKey !== undefined) process.env["RENDOBAR_API_KEY"] = savedKey;
  });

  it("starts without a key and handles a signed delivery", async () => {
    const payload = envelope("test", { message: "hello", endpointId: "whe_1" });
    const res = await fetch(`${base}/webhooks/rendobar`, { method: "POST", headers: signed(secret, payload), body: payload });
    assert.equal(res.status, 200);
    assert.deepEqual(await body(res), { handled: "test delivery for endpoint whe_1" });
  });

  it("refuses an API call with MISSING_API_KEY before sending it", async () => {
    if (!moduleRef) throw new Error("the module did not compile");
    await assert.rejects(moduleRef.get(RendobarClient).jobs.get("job_x"), (e: unknown) => isApiError(e) && e.code === "MISSING_API_KEY");
  });

  it("agrees with every shared webhook vector signed with the endpoint's secret", async (t) => {
    if (!vectors) {
      t.skip("set RENDOBAR_WEBHOOK_VECTORS to rendobar/openapi conformance/webhook-vectors.json");
      return;
    }
    // Cases with their own secret need a receiver built with that secret; the SDK's conformance run covers them.
    const cases = vectors.cases.filter((c) => !c.ownSecret && !c.skipped);
    assert.ok(cases.length >= 5, `only ${cases.length} vectors apply`);
    const realNow = Date.now;
    try {
      for (const c of cases) {
        // Each case is checked at its own clock.
        Date.now = () => (c.now ?? vectors.timestamp) * 1000;
        const res: Response = await fetch(`${base}/webhooks/rendobar`, { method: "POST", headers: { "content-type": "application/json", ...c.headers }, body: c.body ?? vectors.body });
        // The vectors' body is signed but is not a full envelope: an accepted signature then gets 400.
        assert.equal(res.status, c.expect ? 400 : 401, c.name);
      }
    } finally {
      Date.now = realNow;
    }
  });
});
