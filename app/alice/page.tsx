"use client";
// sender only. talks to /api/alice and nothing else.
import { useEffect, useRef, useState } from "react";
import { nextStart, SLOT_SEC } from "../clock";

type Slot = { slot: number; action?: string; note?: string };

export default function AlicePage() {
  const [secret, setSecret] = useState("A");
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<Slot[]>([]);
  const [err, setErr] = useState("");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

  function start() {
    esRef.current?.close();
    const target = nextStart(Date.now());
    setRows([]); setErr(""); setRunning(true);
    const q = new URLSearchParams({ secret, slotMs: String(SLOT_SEC * 1000), epoch: String(target) });
    const es = new EventSource(`/api/alice?${q}`);
    esRef.current = es;
    es.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "slot") setRows((xs) => [...xs, m]);
      else if (m.type === "error") setErr(m.message);
      else if (m.type === "done") { setRunning(false); es.close(); }
    };
    es.onerror = () => { setErr((e) => e || "stream closed"); setRunning(false); es.close(); };
  }

  return (
    <div className="wrap narrow">
      <h1>alice</h1>
      <p className="sub">sender · warms the shared LLM cache to send <b>1</b>, stays silent to send <b>0</b></p>

      <div className="bar">
        <div className="field">
          <label>Secret</label>
          <input value={secret} onChange={(e) => setSecret(e.target.value)} disabled={running} size={6} maxLength={6} />
        </div>
        <button onClick={start} disabled={running}>{running ? "running" : "Start"}</button>
      </div>

      {err && <p className="bad">{err}</p>}

      <div className="col">
        <div className="rows">
          {rows.length === 0 && <div className="empty">waiting</div>}
          {rows.map((s) => (
            <div className="row" key={s.slot}>
              <span className="slotno">{s.slot}</span>
              <span className={`chip ${s.action === "warm" ? "one" : "zero"}`}>
                {s.action === "warm" ? "WARM 1" : "idle 0"}
              </span>
              {s.note?.includes("error") && <span className="meta bad">{s.note}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
