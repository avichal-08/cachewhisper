// sender
import { makeConfig, type Provider } from "./codebook";
import { makeBackend } from "./provider";
import { runSender } from "./protocol";
import { arg, resolveEpoch } from "./cli";

async function main() {
  const provider = (arg("provider") as Provider) ?? undefined;
  const secret = arg("secret");
  const cfg = makeConfig({ ...(provider ? { provider } : {}), ...(secret ? { secret } : {}) });
  const epoch = resolveEpoch();
  const backend = makeBackend(cfg);

  console.log(`[alice] provider=${cfg.provider} model=${cfg.model}`);
  console.log(`[alice] secret=${JSON.stringify(cfg.secret)} slotMs=${cfg.slotMs} repeat=${cfg.repeat}`);
  console.log(`[alice] epoch=${epoch} (starts in ${((epoch - Date.now()) / 1000).toFixed(1)}s)`);

  await runSender(cfg, epoch, backend, (e) => {
    const tag = e.action === "warm" ? "WARM 1" : "idle 0";
    console.log(`[alice] slot ${String(e.slot).padStart(3)} / ${e.totalSlots}  ${tag}  ${e.note ?? ""}`);
  });
  console.log("[alice] done.");
}
main().catch((e) => { console.error(e); process.exit(1); });
