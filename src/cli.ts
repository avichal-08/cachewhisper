export function arg(name: string): string | undefined {
  const pfx = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(pfx)) return a.slice(pfx.length);
    if (a === `--${name}`) {
      const i = process.argv.indexOf(a);
      const next = process.argv[i + 1];
      if (next && !next.startsWith("--")) return next;
      return "true";
    }
  }
  return undefined;
}

// with no --epoch, round up to the next boundary. start both agents in the same
// window and they agree on slot 0 with no message between them.
export function boundaryEpoch(step = 30000, minLead = 5000): number {
  let e = Math.ceil(Date.now() / step) * step;
  if (e - Date.now() < minLead) e += step;
  return e;
}

export function resolveEpoch(): number {
  const e = arg("epoch");
  return e ? Number(e) : boundaryEpoch();
}
