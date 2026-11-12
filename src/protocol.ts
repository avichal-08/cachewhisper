// slot engine. sender warms in the first half of a slot, receiver probes in the
// second half. only sync is the shared epoch and slot clock. emits per-slot
// events so the cli and the dashboard can follow along.

import {
  type Config,
  prefix,
  frameBits,
  bitsToText,
  slotStart,
} from "./codebook";
import { type Backend } from "./provider";

export type Role = "alice" | "bob";

export interface SlotEvent {
  role: Role;
  slot: number;
  totalSlots: number;
  bit?: number;
  truthBit?: number;
  action?: "warm" | "idle" | "probe";
  ttftMs?: number;
  cachedTokens?: number;
  hit?: boolean;
  note?: string;
}

export interface DecodeResult {
  decodedText: string;
  decodedBits: number[];
  truthBits: number[];
  bitAccuracy: number;
  signalUsed: "cachedTokens" | "ttft";
  meanHitTtft: number;
  meanMissTtft: number;
}

const now = () => Date.now();
const sleepUntil = (ts: number) =>
  new Promise<void>((r) => setTimeout(r, Math.max(0, ts - now())));

function expand(bits: number[], repeat: number): number[] {
  if (repeat <= 1) return [...bits];
  const out: number[] = [];
  for (const b of bits) for (let i = 0; i < repeat; i++) out.push(b);
  return out;
}

// no point running out the clock once the key is out of quota
export class QuotaError extends Error {
  constructor() { super("api quota exhausted, run stopped"); }
}

// api errors come back as a json blob; keep it to something that fits a row
function shortError(err: any): string {
  const msg = String(err?.message ?? err);
  const code = msg.match(/"code":\s*(\d+)/)?.[1] ?? (err?.status ? String(err.status) : "");
  if (code === "429" || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return "429 quota exhausted";
  return (code ? `${code} ` : "") + msg.slice(0, 80);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

// sender: warm on 1-bits, stay silent on 0-bits
export async function runSender(
  cfg: Config,
  epoch: number,
  backend: Backend,
  onEvent: (e: SlotEvent) => void,
): Promise<void> {
  const bits = frameBits(cfg);
  for (let k = 0; k < bits.length; k++) {
    await sleepUntil(slotStart(epoch, k, cfg));
    const bit = bits[k];
    const base: SlotEvent = { role: "alice", slot: k, totalSlots: bits.length, bit, truthBit: bit };
    if (bit === 1) {
      try {
        const { cachedTokens } = await backend.warm(prefix(epoch, k, cfg.blobLines));
        onEvent({ ...base, action: "warm", cachedTokens, note: "warmed cache" });
      } catch (err: any) {
        const note = `warm error: ${shortError(err)}`;
        onEvent({ ...base, action: "warm", note });
        if (note.includes("429")) throw new QuotaError();
      }
    } else {
      onEvent({ ...base, action: "idle", note: "stayed silent" });
    }
  }
}

// receiver: probe each slot, calibrate on the preamble, decode, score
export async function runReceiver(
  cfg: Config,
  epoch: number,
  backend: Backend,
  onEvent: (e: SlotEvent) => void,
): Promise<DecodeResult> {
  const truth = frameBits(cfg);
  const total = truth.length;
  const probed: { ttftMs: number; cachedTokens: number }[] = [];

  for (let k = 0; k < total; k++) {
    await sleepUntil(slotStart(epoch, k, cfg) + cfg.slotMs / 2);
    let r = { ttftMs: 0, cachedTokens: 0 };
    let note: string | undefined;
    try {
      r = await backend.probe(prefix(epoch, k, cfg.blobLines));
    } catch (err: any) {
      note = `probe error: ${shortError(err)}`;
    }
    probed.push(r);
    const provisionalHit = r.cachedTokens > 0;
    onEvent({
      role: "bob",
      slot: k,
      totalSlots: total,
      action: "probe",
      ttftMs: Math.round(r.ttftMs),
      cachedTokens: r.cachedTokens,
      hit: provisionalHit,
      bit: provisionalHit ? 1 : 0,
      truthBit: truth[k],
      note,
    });
    if (note?.includes("429")) throw new QuotaError();
  }

  // calibrate ttft threshold from the known preamble
  const preExpanded = expand(cfg.preamble, cfg.repeat);
  const preLen = preExpanded.length;
  const hitTtft: number[] = [];
  const missTtft: number[] = [];
  for (let i = 0; i < preLen; i++) {
    (preExpanded[i] === 1 ? hitTtft : missTtft).push(probed[i].ttftMs);
  }
  const meanHit = mean(hitTtft);
  const meanMiss = mean(missTtft);
  const threshold = (meanHit + meanMiss) / 2;

  // use cached-tokens if it separates the preamble cleanly, else fall back to ttft
  let cachedSeparates = true;
  for (let i = 0; i < preLen; i++) {
    const bit = probed[i].cachedTokens > 0 ? 1 : 0;
    if (bit !== preExpanded[i]) { cachedSeparates = false; break; }
  }
  const signalUsed: "cachedTokens" | "ttft" = cachedSeparates ? "cachedTokens" : "ttft";

  const rawBits = probed.map((p) =>
    signalUsed === "cachedTokens"
      ? (p.cachedTokens > 0 ? 1 : 0)
      : (meanHit < meanMiss ? (p.ttftMs < threshold ? 1 : 0) : (p.ttftMs < threshold ? 0 : 1)),
  );

  // drop preamble, majority-vote each repeated payload bit
  const payloadRaw = rawBits.slice(preLen);
  const payloadBits: number[] = [];
  for (let i = 0; i < payloadRaw.length; i += cfg.repeat) {
    const group = payloadRaw.slice(i, i + cfg.repeat);
    const ones = group.reduce((a: number, b: number) => a + b, 0);
    payloadBits.push(ones * 2 >= group.length ? 1 : 0);
  }

  const truthPayload: number[] = [];
  {
    const tp = truth.slice(preLen);
    for (let i = 0; i < tp.length; i += cfg.repeat) truthPayload.push(tp[i]);
  }
  let correct = 0;
  for (let i = 0; i < truthPayload.length; i++) if (payloadBits[i] === truthPayload[i]) correct++;

  return {
    decodedText: bitsToText(payloadBits),
    decodedBits: payloadBits,
    truthBits: truthPayload,
    bitAccuracy: truthPayload.length ? correct / truthPayload.length : 0,
    signalUsed,
    meanHitTtft: Math.round(meanHit),
    meanMissTtft: Math.round(meanMiss),
  };
}

// epoch a few seconds out so both sides line up on slot 0
export function defaultEpoch(leadMs = 4000): number {
  return Date.now() + leadMs;
}
