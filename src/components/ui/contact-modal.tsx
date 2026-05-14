"use client";

import { useState } from "react";
import { Modal } from "./modal";

interface ContactModalProps {
  open: boolean;
  onClose: () => void;
}

export function ContactModal({ open, onClose }: ContactModalProps) {
  const [name,    setName]    = useState("");
  const [email,   setEmail]   = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  function reset() {
    setName(""); setEmail(""); setMessage("");
    setDone(false); setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Etwas ist schiefgelaufen.");
      } else {
        setDone(true);
      }
    } catch {
      setError("Verbindung fehlgeschlagen. Bitte versuche es erneut.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Schreib uns">
      {done ? (
        <div className="py-6 text-center">
          <div className="text-3xl mb-3">✓</div>
          <p className="text-sm text-ink font-medium">Nachricht erhalten!</p>
          <p className="mt-1 text-xs text-muted">Wir melden uns schnellstmöglich bei dir.</p>
          <button
            type="button"
            onClick={handleClose}
            className="mt-6 inline-flex h-9 px-4 items-center rounded bg-ink text-white text-sm hover:opacity-90"
          >
            Schließen
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dein Name"
              className="h-9 rounded border border-line bg-white px-3 text-sm text-ink placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">E-Mail <span className="text-warn">*</span></label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="du@beispiel.de"
              className="h-9 rounded border border-line bg-white px-3 text-sm text-ink placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Nachricht <span className="text-warn">*</span></label>
            <textarea
              required
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Wie können wir helfen?"
              className="rounded border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-ink resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-warn">{error}</p>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted">hallo@infetch.de</span>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-9 px-4 items-center rounded bg-ink text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Wird gesendet…" : "Senden"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
