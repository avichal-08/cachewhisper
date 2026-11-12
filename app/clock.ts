"use client";
// both pages run the same clock math, like they share the codebook. runs only
// start on whole minutes, at least 15s out, so two tabs looking at the same
// wall clock show the same "next start" and lock the same epoch.
import { useEffect, useState } from "react";

// slot length for both pages. 12s fits the local model (a cold prompt takes
// about 4s). raise it to 20+ for a cloud key on the free tier.
export const SLOT_SEC = 12;

export const LEAD_MS = 15000;
export const STEP_MS = 60000;

export function nextStart(now: number): number {
  return Math.ceil((now + LEAD_MS) / STEP_MS) * STEP_MS;
}

export function useNow(tickMs = 250): number {
  // starts at 0 so the server render and first client render match
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return now;
}

export function hhmmss(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function secsUntil(ts: number, now: number): number {
  return Math.max(0, Math.ceil((ts - now) / 1000));
}
