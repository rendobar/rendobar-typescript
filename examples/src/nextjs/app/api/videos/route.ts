// Next.js App Router: app/api/videos/route.ts. Route handlers take a standard
// Request, so this needs nothing from Next itself.
import { createClient } from "@rendobar/sdk";

// Reads RENDOBAR_API_KEY. RENDOBAR_API_URL is only for pointing at a test server.
const rb = createClient({ baseUrl: process.env.RENDOBAR_API_URL });

export async function POST(request: Request): Promise<Response> {
  const { url } = (await request.json()) as { url: string };
  const job = await rb.jobs.create({ type: "ffprobe", params: { command: url } });
  return Response.json({ jobId: job.id }, { status: 202 });
}
