/**
 * A real NestJS app (platform-express) with RendobarModule: the client is
 * injected by type and calls the conformance mock, a webhook handler sits
 * behind @RendobarWebhook(), and Rendobar's refusals stay out of responses.
 * Only the network peer is a mock.
 */
import "reflect-metadata";
import { createHmac } from "node:crypto";
import { cpSync, realpathSync, rmSync } from "node:fs";
import { Agent, request } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { Controller, Get, HttpCode, Module, Post, type INestApplication, type Type } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { ApiError } from "@rendobar/sdk";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { isKnownWebhookEvent, RendobarClient, RendobarModule, RendobarWebhook, type RendobarWebhookEvent } from "../src/index";

const MOCK = process.env["RENDOBAR_MOCK"] ?? "http://127.0.0.1:4100";
const SECRET = "whsec_" + "c".repeat(64);
const CLIENT = { apiKey: "rb_conformance", baseUrl: MOCK };

/**
 * A second copy of the SDK, loaded as CommonJS, as in an app with two installs
 * or a CommonJS app beside an ESM wrapper. Its ApiError is not this package's
 * class, so only the SDK's brand check can recognise it.
 */
const installedSdk = realpathSync(resolve(process.cwd(), "node_modules/@rendobar/sdk"));
const sdkCopy = join(dirname(installedSdk), "sdk-second-copy-cjs");
cpSync(installedSdk, sdkCopy, { recursive: true });
const otherSdk: typeof import("@rendobar/sdk") = createRequire(join(sdkCopy, "package.json"))(join(sdkCopy, "dist/index.cjs"));
afterAll(() => rmSync(sdkCopy, { recursive: true, force: true }));

@Controller()
class JobsController {
  constructor(private readonly rb: RendobarClient) {}

  @Get("job")
  async job() {
    return { id: (await this.rb.jobs.get("job_x")).id };
  }

  @Get("missing")
  async missing() {
    return this.rb.jobs.get("job_404");
  }

  @Get("other-copy")
  otherCopy(): never {
    throw new otherSdk.ApiError("INSUFFICIENT_CREDITS", 402, "Insufficient credits");
  }
}

@Controller("webhooks")
class WebhooksController {
  @Post("rendobar")
  @HttpCode(200)
  @RendobarWebhook()
  received(event: RendobarWebhookEvent) {
    return { received: event.event, known: isKnownWebhookEvent(event) };
  }
}

async function start(rendobar: ReturnType<typeof RendobarModule.forRoot>, options: { rawBody?: boolean; controllers?: Type[]; jsonLimit?: string } = {}) {
  @Module({ imports: [rendobar], controllers: options.controllers ?? [JobsController, WebhooksController] })
  class AppModule {}
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: options.rawBody ?? true, logger: false });
  if (options.jsonLimit !== undefined) app.useBodyParser("json", { limit: options.jsonLimit });
  await app.listen(0, "127.0.0.1");
  return { app, base: await app.getUrl() };
}

function signed(body: string, { secret = SECRET, ts = Math.floor(Date.now() / 1000), type = "application/json" } = {}) {
  const sig = "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return { "content-type": type, "x-rendobar-signature": sig, "x-rendobar-timestamp": String(ts) };
}

const envelope = (event: string, data: unknown) => JSON.stringify({ version: "1", event, deliveryId: "whd_1", timestamp: 1700000000, orgId: "org_1", data });
const TEST_EVENT = envelope("test", { message: "hello", endpointId: "whe_1" });
const post = (base: string, headers: Record<string, string>, body = TEST_EVENT) => fetch(`${base}/webhooks/rendobar`, { method: "POST", headers, body });

/** A POST through one keep-alive socket, so a second call reuses the first call's connection. */
function postKeepAlive(agent: Agent, base: string, headers: Record<string, string>, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(`${base}/webhooks/rendobar`, { method: "POST", agent, headers: { ...headers, "content-length": String(Buffer.byteLength(body)) } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end(body);
  });
}


describe("RendobarModule.forRootAsync", () => {
  let app: INestApplication;
  let base = "";
  beforeAll(async () => {
    ({ app, base } = await start(RendobarModule.forRootAsync({ useFactory: () => ({ client: CLIENT, webhooks: { secret: SECRET } }) })));
  });
  afterAll(async () => {
    await app.close();
  });

  it("injects the client by type", async () => {
    const res = await fetch(`${base}/job`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "job_x" });
  });

  it("hands a correctly signed webhook's event to the handler, typed", async () => {
    const res = await post(base, signed(TEST_EVENT));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: "test", known: true });
  });

  it("delivers an event newer than this SDK as an unknown event, not an error", async () => {
    const body = envelope("job.paused", { jobId: "job_1" });
    const res = await post(base, signed(body), body);
    expect(await res.json()).toEqual({ received: "job.paused", known: false });
  });

  it("refuses a webhook signed with another secret", async () => {
    expect((await post(base, signed(TEST_EVENT, { secret: "whsec_wrong" }))).status).toBe(401);
  });

  it("refuses a webhook whose body was changed after signing", async () => {
    expect((await post(base, signed(TEST_EVENT), TEST_EVENT.replace("hello", "bye"))).status).toBe(401);
  });

  it("refuses a webhook signed more than five minutes ago", async () => {
    expect((await post(base, signed(TEST_EVENT, { ts: Math.floor(Date.now() / 1000) - 301 }))).status).toBe(401);
  });

  it("verifies a signed body of any content type, not only JSON", async () => {
    const res = await post(base, signed(TEST_EVENT, { type: "text/plain" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: "test", known: true });
  });

  it("answers 400 to a validly signed body that is not a webhook envelope", async () => {
    for (const body of ["not json", JSON.stringify({ hello: "world" })]) {
      expect((await post(base, signed(body, { type: "text/plain" }), body)).status, body).toBe(400);
    }
  });

  it("answers 413 to a body no parser took that is over the cap, before verifying it", async () => {
    const big = "x".repeat(101 * 1024);
    expect((await post(base, signed(big, { type: "text/plain" }), big)).status).toBe(413);
  });

  it("keeps the next request on a keep-alive connection working after a 413", async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      // Far over the cap, so the guard answers while the client is still sending.
      const big = "x".repeat(8 * 1024 * 1024);
      expect(await postKeepAlive(agent, base, signed(big, { type: "text/plain" }), big)).toBe(413);
      expect(await postKeepAlive(agent, base, signed(TEST_EVENT), TEST_EVENT)).toBe(200);
    } finally {
      agent.destroy();
    }
  });

  it("answers an uncaught Rendobar refusal with a generic 502, not Rendobar's status and message", async () => {
    const res = await fetch(`${base}/missing`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ statusCode: 502, message: "Bad Gateway" });
  });

  it("catches an ApiError from another copy of the SDK too", async () => {
    const res = await fetch(`${base}/other-copy`);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("credits");
  });
});

describe("large webhook bodies", () => {
  const data = { message: "x".repeat(150 * 1024), endpointId: "whe_1" };
  const body = envelope("test", data);

  it("are refused by the JSON parser's default 100 KB limit", async () => {
    const { app, base } = await start(RendobarModule.forRoot({ client: CLIENT, webhooks: { secret: SECRET } }));
    try {
      expect((await post(base, signed(body), body)).status).toBe(413);
    } finally {
      await app.close();
    }
  });

  it("are verified once the app raises it with useBodyParser", async () => {
    const { app, base } = await start(RendobarModule.forRoot({ client: CLIENT, webhooks: { secret: SECRET } }), { jsonLimit: "1mb" });
    try {
      expect((await post(base, signed(body), body)).status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("under webhooks.maxBodyBytes for a content type no parser takes", async () => {
    const { app, base } = await start(RendobarModule.forRoot({ client: CLIENT, webhooks: { secret: SECRET, maxBodyBytes: 1024 * 1024 } }));
    try {
      expect((await post(base, signed(body, { type: "text/plain" }), body)).status).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe("RendobarModule.forRoot", () => {
  it("lets Rendobar's status through when the filter is turned off", async () => {
    const { app, base } = await start(RendobarModule.forRoot({ client: CLIENT, apiErrorFilter: false }), { controllers: [JobsController] });
    try {
      expect((await fetch(`${base}/missing`)).status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("refuses to start when a webhook handler exists and no webhooks are configured", async () => {
    await expect(start(RendobarModule.forRoot({ client: CLIENT }))).rejects.toThrow(/webhooks: \{ secret \}/);
  });

  it("starts without webhooks when no handler needs them", async () => {
    const { app, base } = await start(RendobarModule.forRoot({ client: CLIENT }), { controllers: [JobsController] });
    try {
      expect((await fetch(`${base}/job`)).status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("answers 500, naming the fix, when the app was created without rawBody", async () => {
    const { app, base } = await start(RendobarModule.forRoot({ client: CLIENT, webhooks: { secret: SECRET } }), { rawBody: false });
    try {
      const res = await post(base, signed(TEST_EVENT));
      expect(res.status).toBe(500);
    } finally {
      await app.close();
    }
  });
});

describe("RendobarModule without an API key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to start with MISSING_API_KEY, naming the option and the environment variable", async () => {
    vi.stubEnv("RENDOBAR_API_KEY", "");
    const starting = start(RendobarModule.forRoot({ client: { baseUrl: MOCK } }), { controllers: [JobsController] });
    await expect(starting).rejects.toThrow(/client\.apiKey .*RENDOBAR_API_KEY/);
    await expect(starting).rejects.toMatchObject({ code: "MISSING_API_KEY" });
  });

  it("refuses an empty apiKey rather than falling through to the variable, as the SDK would not", async () => {
    vi.stubEnv("RENDOBAR_API_KEY", "rb_from_env");
    await expect(start(RendobarModule.forRoot({ client: { apiKey: "", baseUrl: MOCK } }), { controllers: [JobsController] })).rejects.toBeInstanceOf(ApiError);
  });

  it("refuses to start from forRootAsync too", async () => {
    vi.stubEnv("RENDOBAR_API_KEY", "");
    const module = RendobarModule.forRootAsync({ useFactory: () => ({ client: { baseUrl: MOCK } }) });
    await expect(start(module, { controllers: [JobsController] })).rejects.toThrow(/RENDOBAR_API_KEY/);
  });

  it("starts when RENDOBAR_API_KEY is set", async () => {
    vi.stubEnv("RENDOBAR_API_KEY", "rb_conformance");
    const { app, base } = await start(RendobarModule.forRoot({ client: { baseUrl: MOCK } }), { controllers: [JobsController] });
    try {
      expect(await (await fetch(`${base}/job`)).json()).toEqual({ id: "job_x" });
    } finally {
      await app.close();
    }
  });
});
