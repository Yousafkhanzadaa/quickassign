import { GatewayError } from "@qa/core";
import { gateway } from "@/lib/server";
import { sessionUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Streams pairing progress (QR codes / pairing code / result) from the gateway to the browser. */
export async function GET(request: Request) {
  const userId = await sessionUserId();
  if (!userId) return new Response("unauthorized", { status: 401 });
  try {
    const upstream = await gateway().linkEvents(userId);
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const status = err instanceof GatewayError && err.status === 404 ? 404 : 502;
    return new Response(status === 404 ? "no pairing in progress" : "gateway unavailable", { status });
  }
}
