// Express: submit a job from a route, and receive Rendobar's webhook.
//
//   RENDOBAR_API_KEY=rb_... RENDOBAR_WEBHOOK_SECRET=... node --import tsx src/express.ts
import express from "express";
import { createClient } from "@rendobar/sdk";
import { verifyWebhook } from "@rendobar/sdk/webhooks";

export function createApp(rb = createClient(), webhookSecret = process.env.RENDOBAR_WEBHOOK_SECRET ?? "") {
  const app = express();

  // Starts a job and answers at once. The result arrives on the webhook below.
  app.post("/videos", express.json(), async (req, res) => {
    const job = await rb.jobs.create({ type: "ffprobe", params: { command: String(req.body.url) } });
    res.status(202).json({ jobId: job.id });
  });

  // The signature covers the exact bytes Rendobar sent, so read the raw body.
  app.post("/rendobar-webhook", express.text({ type: "*/*" }), async (req, res) => {
    const body = typeof req.body === "string" ? req.body : "";
    if (!(await verifyWebhook(body, req.headers, webhookSecret))) {
      res.status(401).end();
      return;
    }
    const event = JSON.parse(body) as { event: string; data: { id: string } };
    console.log(event.event, event.data.id);
    res.status(204).end();
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) createApp().listen(3000);
