// GET /api/bob - runs only the receiver. never imports or calls anything
// alice-side; its page derives the same start minute from the wall clock, no
// message from alice involved.
import { makeConfig, type Provider } from "@/src/codebook";
import { makeBackend } from "@/src/provider";
import { runReceiver } from "@/src/protocol";
import { pickEpoch } from "@/src/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  // unset means CW_PROVIDER from .env, then gemini
  const provider = (url.searchParams.get("provider") as Provider | null) || undefined;
  // bob is told only the length. the placeholder sizes the slot frame; the
  // decoded text comes purely from cache hits.
  const chars = Math.min(6, Math.max(1, Number(url.searchParams.get("chars") || 1)));
  const secret = "\0".repeat(chars);
  const slotMs = Number(url.searchParams.get("slotMs") || 20000);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const cfg = makeConfig({ provider, secret, slotMs });
        const backend = makeBackend(cfg);
        // the page locked this from the wall clock; alice's page locks the same one
        const epoch = pickEpoch(url.searchParams.get("epoch"), slotMs);
        send({ type: "start", role: "bob", epoch, provider: cfg.provider, model: cfg.model, slotMs: cfg.slotMs });
        const result = await runReceiver(cfg, epoch, backend, (e) => send({ type: "slot", ...e, truthBit: undefined }));
        send({ type: "result", result: { decodedText: result.decodedText, signalUsed: result.signalUsed } });
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
