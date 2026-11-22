// Next.js App Router: app/api/rendobar-webhook/route.ts.
import { verifyWebhook } from "@rendobar/sdk/webhooks";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RENDOBAR_WEBHOOK_SECRET;
  if (!secret) throw new Error("Set RENDOBAR_WEBHOOK_SECRET to the endpoint's signing secret.");
  const body = await request.text(); // the raw bytes the signature covers
  if (!(await verifyWebhook(body, request.headers, secret))) {
    return new Response(null, { status: 401 });
  }
  const event = JSON.parse(body) as { event: string; data: { jobId: string } };
  console.log(event.event, event.data.jobId);
  return new Response(null, { status: 204 });
}
