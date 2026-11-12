// the page picks the start time from the wall clock and passes it in. reject a
// start bob could no longer catch (slot 0 is probed half a slot in) and one
// absurdly far out.
import { boundaryEpoch } from "./cli";

export function pickEpoch(raw: string | null, slotMs: number): number {
  if (!raw) return boundaryEpoch(60000, 10000);
  const epoch = Number(raw);
  const now = Date.now();
  if (!Number.isFinite(epoch)) throw new Error("bad epoch");
  if (epoch < now - slotMs / 2 + 1000) {
    throw new Error(`start time ${new Date(epoch).toLocaleTimeString()} already passed, press start again`);
  }
  if (epoch > now + 10 * 60000) throw new Error("start time is more than 10 minutes out");
  return epoch;
}
