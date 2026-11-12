# cachewhisper

A covert channel between two processes through a shared LLM's prompt cache.

The old trick is two isolated processes sharing bits over the CPU cache: a cache
hit is a 1, a miss is a 0, read by timing. cachewhisper does the same thing with
an LLM. Two processes, `alice` and `bob`, share one API key and a clock and have
no other channel between them. They move a secret through the provider's prompt
cache.

The cache is scoped per API key, so sharing a key means sharing the medium. The
same idea applies to multi-agent setups: two agents that are sandboxed from each
other can still pass information if they share one LLM backend with caching on.

## How a string crosses the channel

It is binary end to end:

1. Each character becomes its 8-bit ASCII code, MSB first. `A` -> `01000001`.
2. Each bit gets one time-slot. To send a 1, `alice` warms that slot's unique
   prompt prefix, so it lands in the cache. To send a 0 she does nothing.
3. `bob` re-sends each slot's prefix and reads the bit back: a cache hit
   (nonzero cached-token count) is a 1, a miss is a 0.
4. `bob` regroups the hit/miss sequence into bytes and maps each byte back to its
   ASCII character, rebuilding the string.

The physical meaning of a 1 is "this prompt was already in the model's cache."

## How it works in code

- `src/codebook.ts` builds the per-slot prefixes. The nonce (epoch + slot index)
  goes first, then ~7k tokens of fixed filler to clear the cache floor.
  Nonce-first means each slot is its own cache entry, so the shared filler can't
  cause a cross-slot hit, and the epoch salts the run so old cache isn't read as
  a live bit.
- `src/provider.ts` has `warm()` and `probe()` for Gemini (default) and
  OpenRouter. A probe reports the cached-token count and the time-to-first-token.
- `src/protocol.ts` runs the time-slots: alice warms in the first half, bob
  probes in the second half. A 2-slot `[1, 0]` marker lets bob confirm the signal
  is live; decoding uses the cached-token count, which is deterministic.

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

Flags: `--provider gemini|openrouter`, `--secret "A"`, `--epoch <ms>`.
Env: `CW_PROVIDER`, `CW_SECRET`, `CW_SLOT_MS`, `CW_REPEAT`.

## Free-tier reality

Measured on a free Google AI Studio key: the models that actually do implicit
caching (the 2.5 family) are capped at **5 requests/minute and 20 requests/day,
per model**. Models with bigger free quotas (Gemma, some 2.0/3.x tiers) don't do
implicit caching, so they give no hit/miss signal.

So the default is sized to fit: one ASCII character plus the 2-slot marker is
10 slots, which costs under 20 calls across both agents (bob probes every slot,
alice warms the 1-bits). That is the most you can send per day on a free key.
Both CLIs print the estimated call count at startup and warn if a longer secret
would exceed the cap. For longer messages, add billing to the key (removes the
cap) or use the OpenRouter backend.

Timing is noisy on these models (a hit is sometimes slower than a miss), which is
why the cached-token count is the primary signal and timing is only a backup.

## Mitigations

- Partition the cache per tenant/agent identity, not just per workspace.
- Pad or jitter time-to-first-token so prefill time stops leaking cache state.
- Don't expose `cached_tokens` / `cache_discount` across a tenant boundary.
- Turn caching off on multi-tenant shared keys where collusion is a concern.
