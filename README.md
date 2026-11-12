# cachewhisper

A covert channel between two processes through a shared LLM's prompt cache.

The old trick is two isolated processes sharing bits over the CPU cache: a cache
hit is a 1, a miss is a 0, read by timing. cachewhisper does the same thing with
an LLM. Two processes, `alice` and `bob`, share one API key and a clock and have
no other channel between them. They move a secret through the provider's prompt
cache.

- `alice` (sender) warms a unique prompt prefix to send a 1, stays silent for a 0.
- `bob` (receiver) re-sends each prefix and checks whether it was a cache hit
  (nonzero cached-token count, faster time-to-first-token) or a miss.

The cache is scoped per API key, so sharing a key means sharing the medium. The
same idea applies to multi-agent setups: two agents that are sandboxed from each
other can still pass information if they share one LLM backend with caching on.

## How it works

- `src/codebook.ts` builds the per-slot prefixes. The nonce (epoch + slot index)
  goes first, then ~3k tokens of fixed filler to clear Gemini 2.5 Flash's
  1024-token cache floor. Nonce-first means each slot is its own cache entry, so
  the shared filler can't cause a cross-slot hit, and the epoch salts the run so
  old cache isn't read as a live bit.
- `src/provider.ts` has `warm()` and `probe()` for Gemini (default) and
  OpenRouter.
- `src/protocol.ts` runs the time-slots: alice warms in the first half, bob
  probes in the second half. A known preamble (`10101010`) calibrates bob's
  timing threshold. Bob uses the cached-token count when it separates the
  preamble cleanly, otherwise it falls back to timing.

## Run it

Needs [Bun](https://bun.sh) and a free
[Google AI Studio key](https://aistudio.google.com/apikey).

```bash
bun install
cp .env.example .env    # add GEMINI_API_KEY
```

Dashboard:

```bash
bun run dev             # http://localhost:3000
```

Two-process CLI (start both within the same ~30s window so the slot clocks line
up, or pass a matching `--epoch`):

```bash
bun run bob
bun run alice
```

Flags: `--provider gemini|openrouter`, `--secret "hi"`, `--epoch <ms>`.
Env: `CW_PROVIDER`, `CW_SECRET`, `CW_SLOT_MS`, `CW_REPEAT`.

## Limitations

- Implicit caching is best-effort, so accuracy is measured rather than assumed;
  the cached-token field is the primary signal and timing is the backup.
- Free-tier rate limits cap this at one bit per slot, so a short secret over ~24
  slots takes a few minutes. It is a demo, not a fast link.
- Cache TTL is short, so bob has to probe in the same slot alice warmed.

## Mitigations

- Partition the cache per tenant/agent identity, not just per workspace.
- Pad or jitter time-to-first-token so prefill time stops leaking cache state.
- Don't expose `cached_tokens` / `cache_discount` across a tenant boundary.
- Turn caching off on multi-tenant shared keys where collusion is a concern.
