// GET /api/run - runs one session and streams slot events over SSE. alice and
// bob run as two independent tasks sharing only the slot clock and the backend;
// this route only observes them for the ui.
import { makeConfig, type Provider } from "@/src/codebook";
import { makeBackend } from "@/src/provider";
import { runSender, runReceiver, defaultEpoch } from "@/src/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const provider = (url.searchParams.get("provider") as Provider) || "gemini";
  const secret = url.searchParams.get("secret") || "hi";
  const slotMs = Number(url.searchParams.get("slotMs") || 20000);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const cfg = makeConfig({ provider, secret, slotMs });
        const backend = makeBackend(cfg);
        const epoch = defaultEpoch(4000);
        send({ type: "start", epoch, provider: cfg.provider, model: cfg.model, secret: cfg.secret, slotMs: cfg.slotMs });

        const senderP = runSender(cfg, epoch, backend, (e) => send({ type: "slot", ...e }));
        const receiverP = runReceiver(cfg, epoch, backend, (e) => send({ type: "slot", ...e }));
        const [, result] = await Promise.all([senderP, receiverP]);
        send({ type: "result", result, secret: cfg.secret });
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
