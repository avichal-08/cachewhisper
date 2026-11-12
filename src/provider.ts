// backend: warm() writes a prefix into the provider's implicit cache, probe()
// checks whether a prefix is already cached. a probe reports time-to-first-token
// and the provider's cached-token count. gemini is the default, openrouter the
// alternate.

import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import type { Config } from "./codebook";

export interface ProbeResult {
  ttftMs: number;
  cachedTokens: number;
}

export interface Backend {
  name: string;
  warm(prefix: string): Promise<{ cachedTokens: number }>;
  probe(prefix: string): Promise<ProbeResult>;
}

// stable id so openrouter's sticky routing keeps both agents on the same
// upstream (and cache). gemini ignores it.
const SESSION_ID = "cachewhisper-shared-session";

function requireKey(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in the environment (.env).`);
  return v;
}

function geminiBackend(cfg: Config): Backend {
  const ai = new GoogleGenAI({ apiKey: requireKey("GEMINI_API_KEY") });
  // 2.5 models accept thinkingBudget 0. 3.x models reject 0 with a 400, and 1 is
  // the smallest they take.
  const thinkingBudget = cfg.model.startsWith("gemini-2.5") ? 0 : 1;
  const genConfig = { maxOutputTokens: 1, thinkingConfig: { thinkingBudget } };

  return {
    name: "gemini",
    async warm(prefix) {
      const res = await ai.models.generateContent({
        model: cfg.model,
        contents: prefix,
        config: genConfig,
      });
      return { cachedTokens: res.usageMetadata?.cachedContentTokenCount ?? 0 };
    },
    async probe(prefix) {
      // non-streaming on purpose: on 3.x models the stream chunks never carry
      // cachedContentTokenCount, only the plain response does.
      // ttftMs becomes full round-trip time instead of true first-token
      // latency, which is fine since cachedTokens is the signal we trust.
      const t0 = performance.now();
      const res = await ai.models.generateContent({
        model: cfg.model,
        contents: prefix,
        config: genConfig,
      });
      const ttftMs = performance.now() - t0;
      const cachedTokens = res.usageMetadata?.cachedContentTokenCount ?? 0;
      return { ttftMs, cachedTokens };
    },
  };
}

function openrouterBackend(cfg: Config): Backend {
  const client = new OpenAI({
    apiKey: requireKey("OPENROUTER_API_KEY"),
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://localhost/cachewhisper",
      "X-Title": "cachewhisper",
    },
  });

  const base: any = {
    model: cfg.model,
    max_tokens: 1,
    session_id: SESSION_ID,
  };

  return {
    name: "openrouter",
    async warm(prefix) {
      const res: any = await client.chat.completions.create({
        ...base,
        messages: [{ role: "user", content: prefix }],
        stream: false,
      });
      return { cachedTokens: res.usage?.prompt_tokens_details?.cached_tokens ?? 0 };
    },
    async probe(prefix) {
      const t0 = performance.now();
      const stream: any = await client.chat.completions.create({
        ...base,
        messages: [{ role: "user", content: prefix }],
        stream: true,
        stream_options: { include_usage: true },
      });
      let ttftMs = -1;
      let cachedTokens = 0;
      for await (const ev of stream) {
        if (ttftMs < 0) ttftMs = performance.now() - t0;
        const u = ev.usage;
        if (u) cachedTokens = u.prompt_tokens_details?.cached_tokens ?? cachedTokens;
      }
      if (ttftMs < 0) ttftMs = performance.now() - t0;
      return { ttftMs, cachedTokens };
    },
  };
}

// llama-server on this machine. alice and bob both talk to the same server, so
// its slot cache is the shared medium. one slot (-np 1) keeps the choice of
// slot deterministic.
function localBackend(): Backend {
  const base = process.env.LOCAL_LLM_URL ?? "http://127.0.0.1:8081";

  async function run(prefix: string): Promise<ProbeResult> {
    const t0 = performance.now();
    const res = await fetch(`${base}/completion`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: prefix, n_predict: 1, cache_prompt: true, temperature: 0 }),
      signal: AbortSignal.timeout(90000),
      // next patches fetch with its own response cache. alice's warm and bob's
      // probe are byte-identical requests, so without this bob gets alice's
      // answer back without ever reaching llama-server.
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 80)}`);
    const j: any = await res.json();
    const ttftMs = performance.now() - t0;
    const reused = j.timings?.cache_n ?? 0;
    const total = j.tokens_evaluated ?? 0;
    // neighbouring slots share their first ~20 tokens (the nonce opening), so a
    // miss still reports a few reused tokens. only count mostly-cached prompts.
    const cachedTokens = total > 0 && reused / total >= 0.5 ? reused : 0;
    return { ttftMs, cachedTokens };
  }

  return {
    name: "local",
    async warm(prefix) {
      const { cachedTokens } = await run(prefix);
      return { cachedTokens };
    },
    probe: run,
  };
}

export function makeBackend(cfg: Config): Backend {
  if (cfg.provider === "local") return localBackend();
  return cfg.provider === "openrouter" ? openrouterBackend(cfg) : geminiBackend(cfg);
}
