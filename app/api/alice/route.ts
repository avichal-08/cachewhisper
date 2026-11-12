// GET /api/alice - runs only the sender. never imports or calls anything
// bob-side; the only thing it shares with bob is the api key and the wall
// clock (both pages derive the same start minute from it, no handshake).
import { makeConfig, type Provider } from "@/src/codebook";
import { makeBackend } from "@/src/provider";
import { runSender } from "@/src/protocol";
import { pickEpoch } from "@/src/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  // unset means CW_PROVIDER from .env, then gemini
  const provider = (url.searchParams.get("provider") as Provider | null) || undefined;
  const secret = url.searchParams.get("secret") || "A";
  const slotMs = Number(url.searchParams.get("slotMs") || 20000);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const cfg = makeConfig({ provider, secret, slotMs });
        const backend = makeBackend(cfg);
        // the page locked this from the wall clock; bob's page locks the same one
        const epoch = pickEpoch(url.searchParams.get("epoch"), slotMs);
        send({ type: "start", role: "alice", epoch, provider: cfg.provider, model: cfg.model, secret: cfg.secret, slotMs: cfg.slotMs });
        await runSender(cfg, epoch, backend, (e) => send({ type: "slot", ...e }));
      } catch (err: any) {
        send({ type: "error", message: err?.message ?? String(err) });
      } finally {
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
