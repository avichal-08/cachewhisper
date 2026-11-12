"use client";
import { useEffect, useRef, useState } from "react";

type Slot = {
  role: "alice" | "bob";
  slot: number;
  totalSlots: number;
  bit?: number;
  truthBit?: number;
  action?: string;
  ttftMs?: number;
  cachedTokens?: number;
  hit?: boolean;
  note?: string;
};
type Result = {
  decodedText: string;
  bitAccuracy: number;
  signalUsed: string;
  meanHitTtft: number;
  meanMissTtft: number;
};

const PREAMBLE_LEN = 8; // repeat=1 in the dashboard

function liveDecode(bobSlots: Slot[]): string {
  const bits = bobSlots
    .filter((s) => s.action === "probe")
    .sort((a, b) => a.slot - b.slot)
    .map((s) => (s.hit ? 1 : 0))
    .slice(PREAMBLE_LEN);
  let out = "";
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let c = 0;
    for (let b = 0; b < 8; b++) c = (c << 1) | bits[i + b];
    out += c >= 32 && c < 127 ? String.fromCharCode(c) : "·";
  }
  return out;
}

export default function Page() {
  const [provider, setProvider] = useState("gemini");
  const [secret, setSecret] = useState("hi");
  const [slotSec, setSlotSec] = useState(8);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [alice, setAlice] = useState<Slot[]>([]);
  const [bob, setBob] = useState<Slot[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string>("");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

  function start() {
    esRef.current?.close();
    setAlice([]); setBob([]); setResult(null); setErr(""); setStatus("connecting"); setRunning(true);
    const q = new URLSearchParams({ provider, secret, slotMs: String(slotSec * 1000) });
    const es = new EventSource(`/api/run?${q}`);
    esRef.current = es;
    es.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "start") {
        setStatus(`live · ${m.provider} · ${m.model} · secret "${m.secret}" · slot ${m.slotMs / 1000}s`);
      } else if (m.type === "slot") {
        if (m.role === "alice") setAlice((xs) => [...xs, m]);
        else setBob((xs) => [...xs, m]);
      } else if (m.type === "result") {
        setResult(m.result);
      } else if (m.type === "error") {
        setErr(m.message);
      } else if (m.type === "done") {
        setRunning(false); es.close();
      }
    };
    es.onerror = () => { setErr((e) => e || "stream closed"); setRunning(false); es.close(); };
  }

  const bobProbes = bob.filter((s) => s.action === "probe");
  const scored = bobProbes.filter((s) => s.truthBit !== undefined);
  const correct = scored.filter((s) => (s.hit ? 1 : 0) === s.truthBit).length;
  const liveAcc = scored.length ? ((correct / scored.length) * 100).toFixed(0) : "-";
  const decodedLive = result?.decodedText ?? liveDecode(bob);

  return (
    <div className="wrap">
      <h1>cachewhisper</h1>
      <p className="sub">
        Two processes, <b>alice</b> and <b>bob</b>, share one API key and a clock and nothing else.
        They move a secret through a cloud LLM's <b>prompt cache</b>. Alice <b>warms</b> a unique prefix
        to send a <b>1</b> and stays silent for a <b>0</b>. Bob re-sends each prefix and checks whether it
        was a cache <b>hit</b> (nonzero cached-tokens / faster first token) or a <b>miss</b>.
      </p>

      <div className="bar">
        <div className="field">
          <label>Backend</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} disabled={running}>
            <option value="gemini">Gemini (free key)</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </div>
        <div className="field">
          <label>Secret</label>
          <input value={secret} onChange={(e) => setSecret(e.target.value)} disabled={running} size={8} maxLength={6} />
        </div>
        <div className="field">
          <label>Slot seconds</label>
          <input type="number" min={4} max={30} value={slotSec}
            onChange={(e) => setSlotSec(Number(e.target.value))} disabled={running} style={{ width: 70 }} />
        </div>
        <button onClick={start} disabled={running}>{running ? "running" : "Start"}</button>
      </div>

      <div className="status">
        <span>{status}</span>
        {result && <span><b>signal </b>{result.signalUsed}</span>}
        {(result || scored.length > 0) && (
          <span><b>accuracy </b>{result ? (result.bitAccuracy * 100).toFixed(0) : liveAcc}%</span>
        )}
        {result && <span><b>ttft </b>hit {result.meanHitTtft}ms vs miss {result.meanMissTtft}ms</span>}
        {err && <span className="bad">error: {err}</span>}
      </div>

      <div className="cols">
        <div className="col alice">
          <h2>alice · sender</h2>
          <div className="rows">
            {alice.map((s) => (
              <div className="row" key={`a${s.slot}`}>
                <span className="slotno">{s.slot}</span>
                <span className={`chip ${s.action === "warm" ? "one" : "zero"}`}>{s.action === "warm" ? "WARM 1" : "idle 0"}</span>
                <span className="meta">{s.note}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="col bob">
          <h2>bob · receiver</h2>
          <div className="rows">
            {bobProbes.map((s) => (
              <div className="row" key={`b${s.slot}`}>
                <span className="slotno">{s.slot}</span>
                <span className={`chip ${s.hit ? "one" : "zero"}`}>{s.hit ? "HIT 1" : "miss 0"}</span>
                <span className="meta">ttft {s.ttftMs}ms · cached {s.cachedTokens}{s.truthBit !== undefined ? ` · truth ${s.truthBit}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="decoded">
        <div className="label">message bob is reconstructing</div>
        <div className="text">{decodedLive || " "}</div>
        {result && (
          <div style={{ marginTop: 10, fontSize: 13 }}>
            {result.decodedText === secret
              ? <span className="ok">recovered exactly</span>
              : <span className="bad">decoded "{result.decodedText}" vs secret "{secret}"</span>}
          </div>
        )}
      </div>

      <p className="foot">
        Implicit caching is best-effort, so bob uses the cached-token count first and falls back to
        first-token timing. Each slot uses a fresh unique prefix (nonce first), so the shared filler
        can't produce a false hit and a previous run's cache can't be read as a live bit. Free-tier
        rate limits keep this to one bit per slot.
      </p>
    </div>
  );
}
