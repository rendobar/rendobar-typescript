// Next.js App Router: app/api/rendobar-webhook/route.ts.
import { verifyWebhook } from "@rendobar/sdk/webhooks";

export async function POST(request: Request): Promise<Response> {
  const body = await request.text(); // the raw bytes the signature covers
  if (!(await verifyWebhook(body, request.headers, process.env.RENDOBAR_WEBHOOK_SECRET ?? ""))) {
    return new Response(null, { status: 401 });
  }
  const event = JSON.parse(body) as { event: string; data: { id: string } };
  console.log(event.event, event.data.id);
  return new Response(null, { status: 204 });
}
