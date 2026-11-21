/**
 * A real NestJS app (platform-express, rawBody on) with RendobarModule: a service
 * gets the client injected and calls the conformance mock, and a webhook
 * controller sits behind RendobarSignatureGuard. Only the network peer is a mock.
 */
import "reflect-metadata";
import { createHmac } from "node:crypto";
import { Controller, Get, HttpCode, Injectable, Module, Post, UseGuards, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InjectRendobar, RendobarEvent, RendobarModule, RendobarSignatureGuard, type RendobarClient } from "../src/index";

const MOCK = process.env.RENDOBAR_MOCK ?? "http://127.0.0.1:4100";
const SECRET = "whsec_" + "c".repeat(64);

@Injectable()
class JobsService {
  constructor(@InjectRendobar() readonly rb: RendobarClient) {}
}

@Controller()
class AppController {
  constructor(private readonly jobs: JobsService) {}

  @Get("job")
  async job() {
    return { id: (await this.jobs.rb.jobs.get("job_x")).id };
  }

  @Post("webhooks/rendobar")
  @HttpCode(200)
  @UseGuards(RendobarSignatureGuard)
  received(@RendobarEvent() event: { event: string }) {
    return { received: event.event };
  }
}

function appModule(module: ReturnType<typeof RendobarModule.forRoot>) {
  @Module({ imports: [module], controllers: [AppController], providers: [JobsService] })
  class AppModule {}
  return AppModule;
}

async function start(module: ReturnType<typeof RendobarModule.forRoot>, rawBody = true): Promise<{ app: INestApplication; base: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [appModule(module)] }).compile();
  const app = moduleRef.createNestApplication({ rawBody, logger: false });
  await app.listen(0, "127.0.0.1");
  return { app, base: await app.getUrl() };
}

function signed(body: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const sig = "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return { "content-type": "application/json", "x-rendobar-signature": sig, "x-rendobar-timestamp": String(ts) };
}

const EVENT = JSON.stringify({ version: "1", event: "job.completed", data: { jobId: "job_1" } });
const post = (base: string, headers: Record<string, string>, body = EVENT) => fetch(`${base}/webhooks/rendobar`, { method: "POST", headers, body });

describe("RendobarModule.forRootAsync", () => {
  let app: INestApplication;
  let base = "";
  beforeAll(async () => {
    ({ app, base } = await start(RendobarModule.forRootAsync({ useFactory: () => ({ apiKey: "rb_conformance", baseUrl: MOCK, webhookSecret: SECRET }) })));
  });
  afterAll(async () => {
    await app.close();
  });

  it("injects a configured client into a service", async () => {
    const res = await fetch(`${base}/job`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "job_x" });
  });

  it("lets a correctly signed webhook through and hands over the event", async () => {
    const res = await post(base, signed(EVENT));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: "job.completed" });
  });

  it("refuses a webhook signed with another secret", async () => {
    expect((await post(base, signed(EVENT, "whsec_wrong"))).status).toBe(401);
  });

  it("refuses a webhook whose body was changed after signing", async () => {
    expect((await post(base, signed(EVENT), EVENT.replace("completed", "failed"))).status).toBe(401);
  });

  it("refuses a webhook signed more than five minutes ago", async () => {
    expect((await post(base, signed(EVENT, SECRET, Math.floor(Date.now() / 1000) - 301))).status).toBe(401);
  });
});

describe("RendobarModule.forRoot", () => {
  it("injects a client and verifies webhooks", async () => {
    const { app, base } = await start(RendobarModule.forRoot({ apiKey: "rb_conformance", baseUrl: MOCK, webhookSecret: SECRET }));
    try {
      expect(await (await fetch(`${base}/job`)).json()).toEqual({ id: "job_x" });
      expect((await post(base, signed(EVENT))).status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("answers 500 when no webhookSecret is configured", async () => {
    const { app, base } = await start(RendobarModule.forRoot({ apiKey: "rb_conformance", baseUrl: MOCK }));
    try {
      expect((await post(base, signed(EVENT))).status).toBe(500);
    } finally {
      await app.close();
    }
  });

  it("answers 500 when the app was created without rawBody", async () => {
    const { app, base } = await start(RendobarModule.forRoot({ apiKey: "rb_conformance", baseUrl: MOCK, webhookSecret: SECRET }), false);
    try {
      expect((await post(base, signed(EVENT))).status).toBe(500);
    } finally {
      await app.close();
    }
  });
});
