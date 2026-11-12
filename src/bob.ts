// receiver
import { makeConfig, type Provider } from "./codebook";
import { makeBackend } from "./provider";
import { runReceiver } from "./protocol";
import { arg, resolveEpoch } from "./cli";

async function main() {
  const provider = (arg("provider") as Provider) ?? undefined;
  const secret = arg("secret");
  const cfg = makeConfig({ ...(provider ? { provider } : {}), ...(secret ? { secret } : {}) });
  const epoch = resolveEpoch();
  const backend = makeBackend(cfg);

  console.log(`[bob] provider=${cfg.provider} model=${cfg.model}`);
  console.log(`[bob] slotMs=${cfg.slotMs} repeat=${cfg.repeat}`);
  console.log(`[bob] epoch=${epoch} (starts in ${((epoch - Date.now()) / 1000).toFixed(1)}s)`);

  const result = await runReceiver(cfg, epoch, backend, (e) => {
    const mark = e.hit ? "HIT  1" : "miss 0";
    const truth = e.truthBit !== undefined ? ` (truth ${e.truthBit})` : "";
    console.log(
      `[bob]   slot ${String(e.slot).padStart(3)} / ${e.totalSlots}  ${mark}  ttft=${String(e.ttftMs ?? "?").padStart(5)}ms  cached=${e.cachedTokens ?? 0}${truth}  ${e.note ?? ""}`,
    );
  });

  console.log("\n==== decode ====");
  console.log(`signal   : ${result.signalUsed}`);
  console.log(`ttft     : hit ${result.meanHitTtft}ms vs miss ${result.meanMissTtft}ms`);
  console.log(`accuracy : ${(result.bitAccuracy * 100).toFixed(1)}%`);
  console.log(`decoded  : ${JSON.stringify(result.decodedText)}`);
  console.log(`secret   : ${JSON.stringify(cfg.secret)}`);
  console.log(result.decodedText === cfg.secret ? "recovered exactly" : "partial/failed");
}
main().catch((e) => { console.error(e); process.exit(1); });
