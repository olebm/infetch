"use client";

import { useEffect, useState } from "react";

const MESSAGES: Record<string, string> = {
  otp_expired: "Dieser Link ist abgelaufen — bitte fordere unten einen neuen an.",
  access_denied: "Der Login-Link ist ungültig — bitte fordere unten einen neuen an.",
  auth_error: "Anmeldung fehlgeschlagen — bitte versuche es erneut.",
};

export function AuthErrorBanner({ queryError }: { queryError?: string }) {
  const [message, setMessage] = useState<string | null>(
    queryError ? (MESSAGES[queryError] ?? MESSAGES.auth_error) : null,
  );

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const code = params.get("error_code") ?? params.get("error") ?? "";
    const msg = MESSAGES[code];
    // Hash ist nur clientseitig lesbar → setState nach Mount ist hier korrekt.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (msg) setMessage(msg);
  }, []);

  if (!message) return null;

  return (
    <div className="mt-5 rounded border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink">
      {message}
    </div>
  );
}
