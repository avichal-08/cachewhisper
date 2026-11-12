// shared config and prefix generation. alice and bob both import this so they
// build identical prompt prefixes. it's the only thing they share besides a
// clock and the api key.

export type Provider = "gemini" | "openrouter" | "local";

export interface Config {
  provider: Provider;
  model: string;
  slotMs: number;
  secret: string;
  preamble: number[];
  repeat: number;
  blobLines: number;
}

const MODEL: Record<Provider, string> = {
  // 2.5-flash: implicit cache hits are deterministic (full 7160 tokens). 3.5-flash-lite
  // only hit about half the time in testing, which is useless for a channel.
  gemini: "gemini-2.5-flash",
  openrouter: "google/gemini-2.5-flash",
  local: "qwen2.5-0.5b-instruct",
};

export function makeConfig(over: Partial<Config> = {}): Config {
  const provider = (over.provider ?? (process.env.CW_PROVIDER as Provider) ?? "gemini") as Provider;
  return {
    provider,
    model: over.model ?? process.env.CW_MODEL ?? MODEL[provider],
    // 20s keeps a run under the free tier's 5 requests/minute. with billing on, go lower.
    slotMs: over.slotMs ?? Number(process.env.CW_SLOT_MS ?? 20000),
    secret: over.secret ?? process.env.CW_SECRET ?? "A",
    preamble: over.preamble ?? [1, 0],
    repeat: over.repeat ?? Number(process.env.CW_REPEAT ?? 1),
    // a cold prompt on a cpu runs about 40 tokens/s, so the local prompt stays short
    blobLines: over.blobLines ?? (provider === "local" ? 5 : 360),
  };
}

// fixed ~3k-token filler, generated deterministically so both sides match.
// pushes each slot's prefix past gemini's 1024-token cache floor.
function buildBlob(lines: number): string {
  const line =
    "The quick brown fox audits the shared cache while twelve wizards jam the vexing lexicon. ";
  let s = "";
  for (let i = 0; i < lines; i++) s += `${String(i).padStart(4, "0")} ${line}`;
  return s;
}
const blobs = new Map<number, string>();
function blob(lines: number): string {
  let b = blobs.get(lines);
  if (b === undefined) { b = buildBlob(lines); blobs.set(lines, b); }
  return b;
}

// nonce (epoch + slot) goes first so each slot is its own cache entry keyed from
// byte 0. that stops the shared filler from causing cross-slot hits, and the
// epoch salts the run so old cache isn't read as a live bit.
export function prefix(epoch: number, k: number, lines = 360): string {
  return `cachewhisper//epoch=${epoch}//slot=${k}//begin\n${blob(lines)}\ncachewhisper//epoch=${epoch}//slot=${k}//end`;
}

// ascii, msb first
export function textToBits(text: string): number[] {
  const bits: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0) & 0xff;
    for (let b = 7; b >= 0; b--) bits.push((code >> b) & 1);
  }
  return bits;
}

export function bitsToText(bits: number[]): string {
  let out = "";
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let code = 0;
    for (let b = 0; b < 8; b++) code = (code << 1) | (bits[i + b] & 1);
    out += String.fromCharCode(code);
  }
  return out;
}

// preamble + payload, each bit repeated `repeat` times
export function frameBits(cfg: Config): number[] {
  const raw = [...cfg.preamble, ...textToBits(cfg.secret)];
  if (cfg.repeat <= 1) return raw;
  const out: number[] = [];
  for (const bit of raw) for (let r = 0; r < cfg.repeat; r++) out.push(bit);
  return out;
}

export function payloadBitCount(cfg: Config): number {
  return textToBits(cfg.secret).length;
}

export function slotStart(epoch: number, k: number, cfg: Config): number {
  return epoch + k * cfg.slotMs;
}

// rough api-call budget for one run: bob probes every slot, alice warms the
// 1-bits. both hit the same key, so the free-tier 20/day cap applies to the sum.
export function estimateDailyCalls(cfg: Config): number {
  const frame = frameBits(cfg);
  const warms = frame.reduce((a, b) => a + b, 0);
  return frame.length + warms;
}
