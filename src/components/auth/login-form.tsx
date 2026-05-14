"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface LoginFormProps {
  next: string;
}

export function LoginForm({ next }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
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

  if (status === "sent") {
    return (
      <div className="mt-6 rounded border border-line bg-surface p-4 text-sm text-ink">
        <p className="font-medium">Link verschickt ✓</p>
        <p className="mt-1 text-muted">
          Wir haben einen Magic-Link an{" "}
          <span className="font-medium text-ink">{email}</span> geschickt.
          Bitte prüf dein Postfach und klick auf den Link.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
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
        {status === "loading" ? "Wird gesendet…" : "Magic-Link senden"}
      </button>
    </form>
  );
}
