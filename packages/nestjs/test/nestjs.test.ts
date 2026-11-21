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

@Module({
  imports: [RendobarModule.forRootAsync({ useFactory: () => ({ apiKey: "rb_conformance", baseUrl: MOCK, webhookSecret: SECRET }) })],
  controllers: [AppController],
  providers: [JobsService],
})
class AppModule {}

let app: INestApplication;
let base = "";

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ rawBody: true });
  await app.listen(0);
  base = await app.getUrl();
});
afterAll(async () => {
  await app.close();
});

function signed(body: string, secret = SECRET) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return { "content-type": "application/json", "x-rendobar-signature": sig, "x-rendobar-timestamp": ts };
}

describe("RendobarModule in a NestJS app", () => {
  it("injects a configured client into a service", async () => {
    const res = await fetch(`${base.replace("[::1]", "127.0.0.1")}/job`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "job_x" });
  });

  it("lets a correctly signed webhook through and hands over the event", async () => {
    const body = JSON.stringify({ version: "1", event: "job.completed", data: { jobId: "job_1" } });
    const res = await fetch(`${base.replace("[::1]", "127.0.0.1")}/webhooks/rendobar`, { method: "POST", headers: signed(body), body });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: "job.completed" });
  });

  it("refuses a webhook signed with another secret", async () => {
    const body = JSON.stringify({ event: "job.completed" });
    const res = await fetch(`${base.replace("[::1]", "127.0.0.1")}/webhooks/rendobar`, { method: "POST", headers: signed(body, "whsec_wrong"), body });
    expect(res.status).toBe(403);
  });

  it("refuses a webhook whose body was changed after signing", async () => {
    const body = JSON.stringify({ event: "job.completed" });
    const res = await fetch(`${base.replace("[::1]", "127.0.0.1")}/webhooks/rendobar`, { method: "POST", headers: signed(body), body: body.replace("completed", "failed") });
    expect(res.status).toBe(403);
  });
});
