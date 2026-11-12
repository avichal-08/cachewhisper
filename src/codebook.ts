// shared config and prefix generation. alice and bob both import this so they
// build identical prompt prefixes. it's the only thing they share besides a
// clock and the api key.

export type Provider = "gemini" | "openrouter";

export interface Config {
  provider: Provider;
  model: string;
  slotMs: number;
  secret: string;
  preamble: number[];
  repeat: number;
}

const MODEL: Record<Provider, string> = {
  gemini: "gemini-2.5-flash",
  openrouter: "google/gemini-2.5-flash",
};

export function makeConfig(over: Partial<Config> = {}): Config {
  const provider = (over.provider ?? (process.env.CW_PROVIDER as Provider) ?? "gemini") as Provider;
  return {
    provider,
    model: over.model ?? MODEL[provider],
    slotMs: over.slotMs ?? Number(process.env.CW_SLOT_MS ?? 12000),
    secret: over.secret ?? process.env.CW_SECRET ?? "hi",
    preamble: over.preamble ?? [1, 0, 1, 0, 1, 0, 1, 0],
    repeat: over.repeat ?? Number(process.env.CW_REPEAT ?? 1),
  };
}

// fixed ~3k-token filler, generated deterministically so both sides match.
// pushes each slot's prefix past gemini's 1024-token cache floor.
function buildBlob(): string {
  const line =
    "The quick brown fox audits the shared cache while twelve wizards jam the vexing lexicon. ";
  let s = "";
  for (let i = 0; i < 360; i++) s += `${String(i).padStart(4, "0")} ${line}`;
  return s;
}
const BLOB = buildBlob();

// nonce (epoch + slot) goes first so each slot is its own cache entry keyed from
// byte 0. that stops the shared filler from causing cross-slot hits, and the
// epoch salts the run so old cache isn't read as a live bit.
export function prefix(epoch: number, k: number): string {
  return `cachewhisper//epoch=${epoch}//slot=${k}//begin\n${BLOB}\ncachewhisper//epoch=${epoch}//slot=${k}//end`;
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
