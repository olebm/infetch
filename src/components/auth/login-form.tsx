"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface LoginFormProps {
  next: string;
}

export function LoginForm({ next }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "sent" | "verifying" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    setStatus("loading");
    setErrorMsg("");

    const supabase = createSupabaseBrowserClient();
    const redirectTo =
      `${window.location.origin}/auth/callback` +
      (next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "");

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: true,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("sent");
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const trimmedCode = code.trim();
    if (trimmedCode.length < 6) return;

    setStatus("verifying");
    setErrorMsg("");

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: trimmedCode,
      type: "email",
    });

    if (error) {
      setStatus("sent");
      setErrorMsg(error.message || "Code ungültig oder abgelaufen.");
    } else {
      window.location.assign(next && next !== "/" ? next : "/");
    }
  }

  if (status === "sent" || status === "verifying") {
    return (
      <div className="mt-6 rounded border border-line bg-surface p-4 text-sm text-ink">
        <p className="font-medium">Code verschickt ✓</p>
        <p className="mt-1 text-muted">
          Wir haben einen Login-Code an{" "}
          <span className="font-medium text-ink">{email}</span> geschickt.
          Gib den 6-stelligen Code ein – oder klick einfach den Link in der
          E-Mail.
        </p>

        <form onSubmit={handleVerify} className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="login-code"
              className="mb-1 block text-xs font-medium text-muted"
            >
              Login-Code
            </label>
            <input
              id="login-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              placeholder="123456"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              disabled={status === "verifying"}
              className="h-10 w-full rounded border border-line bg-white px-3 text-sm tracking-[0.3em] text-ink placeholder:tracking-normal placeholder:text-muted/60 outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          {errorMsg && (
            <p className="text-xs text-danger">{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={status === "verifying" || code.trim().length < 6}
            className="h-10 w-full rounded bg-brand text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            {status === "verifying" ? "Wird geprüft…" : "Anmelden"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setCode("");
            setErrorMsg("");
          }}
          className="mt-3 text-xs text-muted underline underline-offset-4 decoration-line"
        >
          Andere E-Mail verwenden
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-3">
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

      {status === "error" && (
        <p className="text-xs text-danger">{errorMsg || "Etwas ist schiefgelaufen."}</p>
      )}

      <button
        type="submit"
        disabled={status === "loading" || !email.trim()}
        className="h-10 w-full rounded bg-brand text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {status === "loading" ? "Wird gesendet…" : "Login-Code senden"}
      </button>
    </form>
  );
}
