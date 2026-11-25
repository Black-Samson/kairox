export const fmtUsd = (n: number, dp = 2) =>
  `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

export const fmtSigned = (n: number, dp = 2) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(dp)}`;

export const fmtPrice = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? "—" : n < 1 ? n.toFixed(5) : n.toFixed(4));

export const fmtPct = (n: number | undefined, dp = 2) => (n === undefined || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(dp)}%`);

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const pnlClass = (n: number) => (n > 0 ? "text-emerald" : n < 0 ? "text-crimson" : "text-white/70");
