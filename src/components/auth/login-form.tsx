"use client";

import { useState } from "react";
import { requestEmailOtp, verifyEmailOtp } from "@/app/login/actions";

interface LoginFormProps {
  next: string;
}

export function LoginForm({ next }: LoginFormProps) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    setStatus("loading");
    setErrorMsg("");

    const result = await requestEmailOtp(trimmed);
    setStatus("idle");

    if (result.ok) {
      setStep("code");
    } else {
      setErrorMsg(result.error);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length !== 6) return;

    setStatus("loading");
    setErrorMsg("");

    // Bei Erfolg löst die Server-Action ein redirect() aus → kein Rückgabewert.
    const result = await verifyEmailOtp(email.trim().toLowerCase(), trimmed, next);
    setStatus("idle");

    if (result && !result.ok) {
      setErrorMsg(result.error);
    }
  }

  if (step === "code") {
    return (
      <form onSubmit={handleVerify} className="mt-6 space-y-3">
        <div className="rounded border border-line bg-surface p-4 text-sm text-ink">
          <p className="font-medium">Code verschickt ✓</p>
          <p className="mt-1 text-muted">
            Wir haben einen 6-stelligen Code an{" "}
            <span className="font-medium text-ink">{email}</span> geschickt.
            Gib ihn hier ein.
          </p>
        </div>

        <div>
          <label htmlFor="login-code" className="mb-1 block text-xs font-medium text-muted">
            Code
          </label>
          <input
            id="login-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={status === "loading"}
            className="h-10 w-full rounded border border-line bg-white px-3 text-center text-lg tracking-[0.4em] text-ink placeholder:tracking-normal placeholder:text-muted/60 outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        {errorMsg && <p className="text-xs text-danger">{errorMsg}</p>}

        <button
          type="submit"
          disabled={status === "loading" || code.length !== 6}
          className="h-10 w-full rounded bg-brand text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          {status === "loading" ? "Wird geprüft…" : "Anmelden"}
        </button>

        <button
          type="button"
          onClick={() => {
            setStep("email");
            setCode("");
            setErrorMsg("");
          }}
          className="text-xs text-muted underline underline-offset-4 decoration-line"
        >
          Andere E-Mail verwenden
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleRequest} className="mt-6 space-y-3">
      <div>
        <label htmlFor="login-email" className="mb-1 block text-xs font-medium text-muted">
          E-Mail
        </label>
        <input
          id="login-email"
          type="email"
          required
          autoComplete="email"
          placeholder="du@studio.de"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === "loading"}
          className="h-10 w-full rounded border border-line bg-white px-3 text-sm text-ink placeholder:text-muted/60 outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      {errorMsg && (
        <p className="text-xs text-danger">{errorMsg || "Etwas ist schiefgelaufen."}</p>
      )}

      <button
        type="submit"
        disabled={status === "loading" || !email.trim()}
        className="h-10 w-full rounded bg-brand text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {status === "loading" ? "Wird gesendet…" : "Code anfordern"}
      </button>
    </form>
  );
}
