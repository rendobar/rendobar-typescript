// Hono: the same two routes. Runs on Node here, and unchanged on Workers, Bun or Deno.
//
//   RENDOBAR_API_KEY=rb_... RENDOBAR_WEBHOOK_SECRET=... node --import tsx src/hono.ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createClient } from "@rendobar/sdk";
import { verifyWebhook } from "@rendobar/sdk/webhooks";

export function createApp(rb = createClient(), webhookSecret = process.env.RENDOBAR_WEBHOOK_SECRET) {
  // Fail at startup, not on the first delivery: an unset secret must never reach verifyWebhook.
  if (!webhookSecret) throw new Error("Set RENDOBAR_WEBHOOK_SECRET to the endpoint's signing secret.");
  const app = new Hono();

  app.post("/videos", async (c) => {
    const { url } = await c.req.json<{ url: string }>();
    const job = await rb.jobs.create({ type: "ffprobe", params: { command: url } });
    return c.json({ jobId: job.id }, 202);
  });

  app.post("/rendobar-webhook", async (c) => {
    const body = await c.req.text();
    if (!(await verifyWebhook(body, c.req.raw.headers, webhookSecret))) return c.body(null, 401);
    const event = JSON.parse(body) as { event: string; data: { jobId: string } };
    console.log(event.event, event.data.jobId);
    return c.body(null, 204);
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) serve({ fetch: createApp().fetch, port: 3000 });
