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
  goes first, then fixed filler: ~7k tokens on cloud models to clear their
  cache floor, ~150 on the local model so a cold prompt stays fast. Nonce-first means each slot is its own cache entry, so the shared filler can't
  cause a cross-slot hit, and the epoch salts the run so old cache isn't read as
  a live bit.
- `src/provider.ts` has `warm()` and `probe()` for a local llama-server
  (recommended), Gemini and OpenRouter. A probe reports the cached-token count and
  the time-to-first-token.
- `src/protocol.ts` runs the time-slots: alice warms in the first half, bob
  probes in the second half. A 2-slot `[1, 0]` marker lets bob confirm the signal
  is live; decoding uses the cached-token count, which is deterministic.

## Run it

Use the local model. It is free, has no quota, and its cache is deterministic, so
every take works. Needs [Bun](https://bun.sh).

1. Get `llama-server` (the CPU build from the
   [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases)) and a
   small model such as
   [Qwen2.5-0.5B-Instruct Q4_K_M](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF),
   about 490 MB.
2. Start it with one slot, so the shared cache is a single known place:

```bash
llama-server -m qwen2.5-0.5b-instruct-q4_k_m.gguf -c 4096 -np 1 --host 127.0.0.1 --port 8081
```

3. Start the app:

```bash
bun install
cp .env.example .env    # set CW_PROVIDER=local
bun run dev             # http://localhost:3000
```

Open `/alice` and `/bob` in two windows and press Start on each within a few
seconds. A hit comes back in about 0.1s and a miss takes about 4s on a CPU, so the
difference shows on screen.

Two-process CLI instead of the pages (start both in the same ~30s window, or pass
a matching `--epoch`):

```bash
bun run bob
bun run alice
```

Flags: `--provider local|gemini|openrouter`, `--secret "A"`, `--epoch <ms>`.
Env: `CW_PROVIDER`, `CW_SECRET`, `CW_SLOT_MS`, `CW_REPEAT`, `CW_MODEL`,
`LOCAL_LLM_URL`.

## Cloud backends

Gemini and OpenRouter work too (`CW_PROVIDER=gemini`, key in `.env`), but they are
a poor fit for repeated takes. A free Gemini key allows about 20 calls a day on
the models that cache, which is one character, and implicit caching is best
effort, so a hit is not guaranteed. Use local unless you want to show it on a
hosted model.

## Mitigations

- Partition the cache per tenant/agent identity, not just per workspace.
- Pad or jitter time-to-first-token so prefill time stops leaking cache state.
- Don't expose `cached_tokens` / `cache_discount` across a tenant boundary.
- Turn caching off on multi-tenant shared keys where collusion is a concern.
