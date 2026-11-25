/**
 * Stateless, deterministic market generators used when there is no network (local dev, judges
 * behind firewalls) or no HSKSwap addresses yet. Everything is a pure function of time, so it
 * works the same on serverless functions that keep no memory between requests.
 *
 * Anything produced here is labelled "synthetic" / "simulated" in the UI.
 */

// Small deterministic hash -> [0, 1)
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Smooth pseudo-random walk built from layered sines (seconds -> multiplier around 1). */
function wave(tSec: number): number {
  return (
    0.012 * Math.sin(tSec / 1800) +
    0.006 * Math.sin(tSec / 410 + 1.3) +
    0.003 * Math.sin(tSec / 97 + 0.4) +
    0.0012 * Math.sin(tSec / 23 + 2.1)
  );
}

export const SYNTHETIC_BASE_PRICE = 0.14; // only used when no live reference is reachable

export function syntheticRefPrice(timeMs: number, base = SYNTHETIC_BASE_PRICE): number {
  const t = timeMs / 1000;
  return base * (1 + wave(t));
}

/**
 * Simulated HSKSwap discount/premium vs. the reference, in %. Mostly small noise around zero, with
 * a "dislocation" window roughly every few minutes where the DEX lags the reference by up to ~0.9%.
 */
export function simulatedSpreadPct(timeMs: number): number {
  const t = timeMs / 1000;
  const noise = 0.08 * Math.sin(t / 7.3) + 0.05 * Math.sin(t / 3.1 + 1.7);
  const windowLen = 150; // seconds
  const w = Math.floor(t / windowLen);
  const phase = (t % windowLen) / windowLen;
  const r = hash01(w);
  // ~45% of windows contain a dislocation that builds then decays.
  const shock = r < 0.45 ? (0.35 + r * 1.2) * Math.sin(Math.PI * Math.min(1, phase * 1.6)) : 0;
  const sign = hash01(w + 999) < 0.75 ? 1 : -1; // mostly DEX discounts (DEX lags rallies)
  return noise + sign * shock;
}

export function syntheticCandles(endMs: number, count: number, intervalSec: number, base = SYNTHETIC_BASE_PRICE) {
  const out: { time: number; open: number; high: number; low: number; close: number }[] = [];
  const end = Math.floor(endMs / 1000 / intervalSec) * intervalSec;
  for (let i = count - 1; i >= 0; i--) {
    const start = end - i * intervalSec;
    const pts = [0, 0.25, 0.5, 0.75, 1].map((f) => syntheticRefPrice((start + f * intervalSec) * 1000, base));
    out.push({
      time: start,
      open: pts[0],
      close: pts[pts.length - 1],
      high: Math.max(...pts) * (1 + hash01(start) * 0.0015),
      low: Math.min(...pts) * (1 - hash01(start + 7) * 0.0015),
    });
  }
  return out;
}
