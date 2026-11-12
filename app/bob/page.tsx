"use client";
// receiver only. talks to /api/bob and nothing else.
import { useEffect, useRef, useState } from "react";
import { nextStart, SLOT_SEC } from "../clock";

type Slot = { slot: number; hit?: boolean; cachedTokens?: number; note?: string };
type Result = { decodedText: string };

const PREAMBLE_LEN = 2;

function decode(rows: Slot[]): string {
  const bits = [...rows].sort((a, b) => a.slot - b.slot).map((s) => (s.hit ? 1 : 0)).slice(PREAMBLE_LEN);
  let out = "";
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let c = 0;
    for (let b = 0; b < 8; b++) c = (c << 1) | bits[i + b];
    out += c >= 32 && c < 127 ? String.fromCharCode(c) : "·";
  }
  return out;
}

export default function BobPage() {
  const [chars, setChars] = useState(1);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<Slot[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState("");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

  function start() {
    esRef.current?.close();
    const target = nextStart(Date.now());
    setRows([]); setResult(null); setErr(""); setRunning(true);
    // bob only knows how many characters to listen for, never the secret
    const q = new URLSearchParams({ chars: String(chars), slotMs: String(SLOT_SEC * 1000), epoch: String(target) });
    const es = new EventSource(`/api/bob?${q}`);
    esRef.current = es;
    es.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "slot") setRows((xs) => [...xs.filter((x) => x.slot !== m.slot), m]);
      else if (m.type === "result") setResult(m.result);
      else if (m.type === "error") setErr(m.message);
      else if (m.type === "done") { setRunning(false); es.close(); }
    };
    es.onerror = () => { setErr((e) => e || "stream closed"); setRunning(false); es.close(); };
  }

  const totalSlots = PREAMBLE_LEN + chars * 8;
  const decoded = result?.decodedText ?? decode(rows);

  return (
    <div className="wrap narrow">
      <h1>bob</h1>
      <p className="sub">receiver · checks the shared LLM cache: hit = <b>1</b>, miss = <b>0</b></p>

      <div className="bar">
        <div className="field">
          <label>Chars</label>
          <input type="number" min={1} max={6} value={chars}
            onChange={(e) => setChars(Math.max(1, Number(e.target.value)))} disabled={running} style={{ width: 56 }} />
        </div>
        <button onClick={start} disabled={running}>{running ? "running" : "Start"}</button>
      </div>

      {err && <p className="bad">{err}</p>}

      <div className="bitstrip">
        {Array.from({ length: totalSlots }).map((_, i) => {
          const s = rows.find((p) => p.slot === i);
          const pre = i < PREAMBLE_LEN ? "pre" : "";
          if (!s) return <div className={`bit pending ${pre}`} key={i} />;
          return <div className={`bit ${s.hit ? "on" : "off"} ${pre}`} key={i}>{s.hit ? "1" : "0"}</div>;
        })}
      </div>

      <div className="col">
        <div className="rows">
          {rows.length === 0 && <div className="empty">waiting</div>}
          {rows.map((s) => (
            <div className="row" key={s.slot}>
              <span className="slotno">{s.slot}</span>
              <span className={`chip ${s.hit ? "one" : "zero"}`}>{s.hit ? "HIT 1" : "miss 0"}</span>
              <span className={s.note ? "meta bad" : "meta"}>{s.note ?? `cached ${s.cachedTokens}`}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="decoded">
        <div className="label">bob decoded</div>
        <div className="text">{decoded || " "}</div>
      </div>
    </div>
  );
}
