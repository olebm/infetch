"use client";

import { useState } from "react";

const MESSAGES: Record<string, string> = {
  otp_expired:    "Dieser Link ist abgelaufen — bitte fordere unten einen neuen an.",
  access_denied:  "Der Login-Link ist ungültig — bitte fordere unten einen neuen an.",
  auth_error:     "Anmeldung fehlgeschlagen — bitte versuche es erneut.",
};

function resolveInitialMessage(queryError?: string): string | null {
  if (queryError) return MESSAGES[queryError] ?? MESSAGES.auth_error;
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const code = params.get("error_code") ?? params.get("error") ?? "";
  return MESSAGES[code] ?? null;
}

export function AuthErrorBanner({ queryError }: { queryError?: string }) {
  const [message] = useState<string | null>(() => resolveInitialMessage(queryError));

  if (!message) return null;

  return (
    <div className="mt-5 rounded border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink">
      {message}
    </div>
  );
}
