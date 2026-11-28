"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  useConnectWallet,
  useLoginWithEmail,
  useLoginWithOAuth,
  useLoginWithPasskey,
  useSignupWithPasskey,
} from "@privy-io/react-auth";
import { useConnect } from "wagmi";
import { KxMark } from "@/components/brand/KairoxLogo";
import { privyEnabled } from "@/providers/Web3Provider";
import { useAgentStore } from "@/store/agentStore";
import { CloseIcon, GoogleIcon, KeyPlusIcon, MailIcon, PasskeyIcon, WalletIcon, XIcon } from "./icons";

/* ------------------------------------------------------------------ */
/* Presentational view shared by the Privy and wallet-only variants    */
/* ------------------------------------------------------------------ */

interface Handlers {
  google?: () => Promise<void>;
  x?: () => Promise<void>;
  wallet: () => Promise<void> | void;
  passkeyLogin?: () => Promise<void>;
  passkeyCreate?: () => Promise<void>;
  emailSend?: (email: string) => Promise<void>;
  emailVerify?: (code: string) => Promise<void>;
  disabledHint?: string;
  walletOptions?: ReactNode;
}

const btn =
  "w-full flex items-center justify-center gap-3 rounded-xl border border-white/5 bg-raised py-2.5 sm:py-3 text-sm font-medium text-white transition hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-40";

function AuthButtonsView(h: Handlers) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (key: string, fn?: () => Promise<void> | void) => async () => {
    if (!fn) return;
    setError(null);
    setPending(key);
    try {
      await fn();
    } catch (e) {
      setError((e as Error)?.message ?? "Something went wrong");
    } finally {
      setPending(null);
    }
  };

  const label = (key: string, text: string) => (pending === key ? "Working…" : text);
  const hint = h.disabledHint;

  return (
    <div className="space-y-3">
      <button className={btn} onClick={run("google", h.google)} disabled={!h.google || !!pending} title={!h.google ? hint : undefined}>
        <GoogleIcon /> {label("google", "Continue with Google")}
      </button>
      <button className={btn} onClick={run("x", h.x)} disabled={!h.x || !!pending} title={!h.x ? hint : undefined}>
        <XIcon /> {label("x", "Continue with X")}
      </button>
      <button className={btn} onClick={run("wallet", h.wallet)} disabled={!!pending}>
        <WalletIcon /> {label("wallet", "Continue with wallet")}
      </button>
      {h.walletOptions}
      <div className="grid grid-cols-2 gap-3">
        <button className={btn} onClick={run("pk", h.passkeyLogin)} disabled={!h.passkeyLogin || !!pending} title={!h.passkeyLogin ? hint : undefined}>
          <PasskeyIcon /> {label("pk", "Use passkey")}
        </button>
        <button className={btn} onClick={run("pkc", h.passkeyCreate)} disabled={!h.passkeyCreate || !!pending} title={!h.passkeyCreate ? hint : undefined}>
          <KeyPlusIcon /> {label("pkc", "Create passkey")}
        </button>
      </div>

      <div className="flex items-center gap-3 py-1 text-xs text-white/40">
        <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
      </div>

      {step === "email" ? (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!h.emailSend || !email.includes("@")) return;
            await run("email", async () => {
              await h.emailSend!(email);
              setStep("otp");
            })();
          }}
        >
          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-obsidian/60 px-4 py-3 text-white/50 focus-within:border-cyan/60">
            <MailIcon />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              disabled={!h.emailSend}
              className="w-full bg-transparent text-sm text-white placeholder:text-white/40 outline-none disabled:cursor-not-allowed"
            />
          </label>
          <button
            type="submit"
            disabled={!h.emailSend || !!pending}
            title={!h.emailSend ? hint : undefined}
            className="w-full rounded-xl bg-cyan py-3 text-sm font-semibold text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {label("email", "Continue with email")}
          </button>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (code.length !== 6) return;
            await run("otp", () => h.emailVerify!(code))();
          }}
        >
          <p className="text-center text-xs text-white/60">
            Enter the 6-digit code sent to <span className="text-white">{email}</span>
          </p>
          <input
            inputMode="numeric"
            autoFocus
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="••••••"
            className="num w-full rounded-xl border border-white/10 bg-obsidian/60 px-4 py-3 text-center text-xl tracking-[0.6em] text-white outline-none focus:border-cyan/60"
          />
          <button
            type="submit"
            disabled={code.length !== 6 || !!pending}
            className="w-full rounded-xl bg-cyan py-3 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
          >
            {label("otp", "Verify & continue")}
          </button>
          <button type="button" onClick={() => { setStep("email"); setCode(""); }} className="w-full text-xs text-white/50 hover:text-white">
            ← Use a different email
          </button>
        </form>
      )}

      {error && <p className="rounded-lg bg-crimson/10 px-3 py-2 text-xs text-crimson">{error}</p>}
      {hint && <p className="text-center text-[11px] leading-relaxed text-white/35">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Privy v3 headless hooks                                             */
/* ------------------------------------------------------------------ */

function PrivyAuthButtons() {
  const { initOAuth } = useLoginWithOAuth();
  const { connectWallet } = useConnectWallet();
  const { loginWithPasskey } = useLoginWithPasskey();
  const { signupWithPasskey } = useSignupWithPasskey();
  const { sendCode, loginWithCode } = useLoginWithEmail();

  return (
    <AuthButtonsView
      google={() => initOAuth({ provider: "google" })}
      x={() => initOAuth({ provider: "twitter" })}
      wallet={() => connectWallet()}
      passkeyLogin={() => loginWithPasskey()}
      passkeyCreate={() => signupWithPasskey()}
      emailSend={(email) => sendCode({ email })}
      emailVerify={(code) => loginWithCode({ code })}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Wallet-only fallback (NEXT_PUBLIC_PRIVY_APP_ID not set)             */
/* ------------------------------------------------------------------ */

function FallbackAuthButtons() {
  const { connectors, connectAsync } = useConnect();
  const [showList, setShowList] = useState(false);
  const list = connectors.filter((c, i, arr) => arr.findIndex((x) => x.name === c.name) === i);

  return (
    <AuthButtonsView
      wallet={async () => {
        if (list.length === 1) await connectAsync({ connector: list[0] });
        else setShowList((v) => !v);
      }}
      walletOptions={
        showList ? (
          <div className="space-y-2 rounded-xl border border-white/10 bg-obsidian/50 p-2">
            {list.map((c) => (
              <button
                key={c.uid}
                onClick={() => connectAsync({ connector: c }).catch(() => {})}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-white/80 hover:bg-raised"
              >
                {c.name === "Injected" ? "Browser wallet (OKX Wallet / MetaMask)" : c.name}
              </button>
            ))}
          </div>
        ) : null
      }
      disabledHint="Google, X, passkey and email sign-in turn on when NEXT_PUBLIC_PRIVY_APP_ID is set. Wallets and the Judge Sandbox work now."
    />
  );
}

/* ------------------------------------------------------------------ */
/* Modal shell                                                         */
/* ------------------------------------------------------------------ */

export function KairoxAuthModal() {
  const open = useAgentStore((s) => s.authOpen);
  const setOpen = useAgentStore((s) => s.setAuthOpen);
  const session = useAgentStore((s) => s.session);
  const startSandbox = useAgentStore((s) => s.startSandbox);

  // Close automatically once any sign-in completes.
  useEffect(() => {
    if (open && session.kind !== "none") setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#06080D]/80 p-3 backdrop-blur-md sm:p-4" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kx-auth-title"
        onClick={(e) => e.stopPropagation()}
        className="relative my-auto w-full max-w-[420px] rounded-2xl border border-white/10 bg-surface p-5 shadow-[0_30px_80px_-20px_rgba(0,240,255,0.18)] sm:p-7"
      >
        <button onClick={() => setOpen(false)} className="absolute right-3 top-3 z-10 rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white" aria-label="Close">
          <CloseIcon />
        </button>

        <div className="mb-5 flex flex-col items-center text-center sm:mb-6">
          <div className="mb-3 flex items-center gap-2">
            <KxMark size={36} />
            <span className="text-2xl font-bold tracking-tight text-white">
              Kair<span className="text-cyan">ox</span>
            </span>
          </div>
          <h2 id="kx-auth-title" className="text-xl font-semibold text-white">
            Continue to Kairox
          </h2>
          <p className="mt-1 text-sm text-white/50">Sign in or launch an agent wallet in one step.</p>
        </div>

        {privyEnabled ? <PrivyAuthButtons /> : <FallbackAuthButtons />}

        <button onClick={startSandbox} className="mt-5 w-full text-center text-sm text-cyan/80 transition hover:text-cyan">
          Preview in Judge Sandbox Mode →
        </button>
      </div>
    </div>
  );
}

export default KairoxAuthModal;
