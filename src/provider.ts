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
  const genConfig = { maxOutputTokens: 1, thinkingConfig: { thinkingBudget: 0 } };

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
      const t0 = performance.now();
      const stream = await ai.models.generateContentStream({
        model: cfg.model,
        contents: prefix,
        config: genConfig,
      });
      let ttftMs = -1;
      let cachedTokens = 0;
      for await (const chunk of stream) {
        if (ttftMs < 0) ttftMs = performance.now() - t0;
        const c = chunk.usageMetadata?.cachedContentTokenCount;
        if (typeof c === "number") cachedTokens = c;
      }
      if (ttftMs < 0) ttftMs = performance.now() - t0;
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

export function makeBackend(cfg: Config): Backend {
  return cfg.provider === "openrouter" ? openrouterBackend(cfg) : geminiBackend(cfg);
}
