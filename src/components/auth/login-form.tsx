"use client";

import { useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { provisionAfterOtp } from "@/app/login/actions";

interface LoginFormProps {
  next: string;
}

const CODE_LENGTH = 6;

export function LoginForm({ next }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [status, setStatus] = useState<
    "idle" | "loading" | "sent" | "verifying" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const code = digits.join("");

  function focusInput(index: number) {
    const el = inputsRef.current[index];
    if (el) {
      el.focus();
      el.select();
    }
  }

  function setDigitAt(index: number, value: string) {
    setDigits((prev) => {
      const nextDigits = [...prev];
      nextDigits[index] = value;
      return nextDigits;
    });
  }

  function handleDigitChange(index: number, raw: string) {
    const onlyDigits = raw.replace(/\D/g, "");
    if (!onlyDigits) {
      setDigitAt(index, "");
      return;
    }
    // Mehrere Ziffern (z. B. eingefügt) auf die Felder ab `index` verteilen
    if (onlyDigits.length > 1) {
      setDigits((prev) => {
        const nextDigits = [...prev];
        for (let i = 0; i < onlyDigits.length && index + i < CODE_LENGTH; i++) {
          nextDigits[index + i] = onlyDigits[i];
        }
        return nextDigits;
      });
      const nextIndex = Math.min(index + onlyDigits.length, CODE_LENGTH - 1);
      focusInput(nextIndex);
      return;
    }
    setDigitAt(index, onlyDigits);
    if (index < CODE_LENGTH - 1) focusInput(index + 1);
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[index]) {
        setDigitAt(index, "");
      } else if (index > 0) {
        setDigitAt(index - 1, "");
        focusInput(index - 1);
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      focusInput(index - 1);
    } else if (e.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      e.preventDefault();
      focusInput(index + 1);
    }
  }

  function handlePaste(index: number, e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, CODE_LENGTH - index);
    if (!pasted) return;
    setDigits((prev) => {
      const nextDigits = [...prev];
      for (let i = 0; i < pasted.length; i++) {
        nextDigits[index + i] = pasted[i];
      }
      return nextDigits;
    });
    focusInput(Math.min(index + pasted.length, CODE_LENGTH - 1));
  }

  function resetCode() {
    setDigits(Array(CODE_LENGTH).fill(""));
  }

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
      resetCode();
      setStatus("sent");
      setTimeout(() => focusInput(0), 50);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length < CODE_LENGTH) return;

    setStatus("verifying");
    setErrorMsg("");

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code,
      type: "email",
    });

    if (error) {
      setStatus("sent");
      setErrorMsg(error.message || "Code ungültig oder abgelaufen.");
      resetCode();
      setTimeout(() => focusInput(0), 50);
      return;
    }

    // Postgres-Profil sicherstellen (OTP-Code läuft nicht über /auth/callback)
    const result = await provisionAfterOtp();
    if (!result.ok) {
      setStatus("error");
      setErrorMsg("Anmeldung fehlgeschlagen. Bitte erneut versuchen.");
      return;
    }

    window.location.assign(next && next !== "/" ? next : "/");
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
            <label className="mb-1 block text-xs font-medium text-muted">
              Login-Code
            </label>
            <div className="flex gap-2" role="group" aria-label="6-stelliger Login-Code">
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputsRef.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  pattern="[0-9]*"
                  maxLength={1}
                  aria-label={`Ziffer ${i + 1}`}
                  value={digit}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={(e) => handlePaste(i, e)}
                  onFocus={(e) => e.target.select()}
                  disabled={status === "verifying"}
                  className="h-12 w-full min-w-0 rounded border border-line bg-white text-center text-lg font-medium text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
                />
              ))}
            </div>
          </div>

          {errorMsg && <p className="text-xs text-danger">{errorMsg}</p>}

          <button
            type="submit"
            disabled={status === "verifying" || code.length < CODE_LENGTH}
            className="h-10 w-full rounded bg-brand text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            {status === "verifying" ? "Wird geprüft…" : "Anmelden"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            resetCode();
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
