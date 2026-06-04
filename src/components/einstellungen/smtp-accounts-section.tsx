"use client";

/**
 * SmtpAccountsSection — Buchhaltung-Tab: Absende-Konten (SMTP) zum Senden.
 *
 * Bis zu zwei Konten (primary/secondary). Konfiguration über ein Modal mit der
 * MailboxConnectContent-Komponente (purpose="smtp-only", Provider-Erkennung).
 * Getrennt von den IMAP-Postfächern (Empfang) im Postfächer-Tab.
 */

import { useState } from "react";
import { Check, Plus, Send } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { MailboxConnectContent } from "@/components/credentials/mailbox-connect-content";
import { StatusBadge } from "@/components/status/status-badge";
import { VendorLogo } from "@/components/ui/vendor-logo";
import { DeleteSmtpAccountButton } from "@/components/einstellungen/delete-smtp-account-button";

export interface SmtpAccountSlot {
  slot: "primary" | "secondary";
  fromAddress: string | null;
  configured: boolean;
  providerDomain: string | null;
  servers?: { smtpHost?: string; smtpPort?: number; smtpSecure?: boolean };
}

export function SmtpAccountsSection({ slots }: { slots: SmtpAccountSlot[] }) {
  const [openSlot, setOpenSlot] = useState<"primary" | "secondary" | null>(null);

  const primary = slots.find((s) => s.slot === "primary");
  const secondary = slots.find((s) => s.slot === "secondary");
  const editing = openSlot ? slots.find((s) => s.slot === openSlot) : undefined;

  function configuredRow(acc: SmtpAccountSlot) {
    return (
      <div className="flex items-center gap-3 py-3">
        <VendorLogo
          domain={acc.providerDomain}
          name={acc.fromAddress ?? ""}
          size={36}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{acc.fromAddress}</span>
            <StatusBadge status="configured" label="aktiv" />
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-ok">
            <Check size={11} aria-hidden />
            Versand aktiv
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpenSlot(acc.slot)}
          className="shrink-0 rounded border border-line px-3 py-1.5 text-xs text-muted hover:border-brand/50 hover:text-ink"
        >
          Ändern
        </button>
        {/* Nur das optionale 2. Konto ist löschbar; Konto 1 ist Pflicht. */}
        {acc.slot === "secondary" && <DeleteSmtpAccountButton />}
      </div>
    );
  }

  return (
    <>
      <div className="divide-y divide-line">
        {/* Primary — existiert nach Onboarding immer */}
        {primary?.configured && primary.fromAddress ? (
          configuredRow(primary)
        ) : (
          <div className="flex items-center gap-3 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-line bg-surface text-muted">
              <Send size={14} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink">Absende-Konto 1</div>
              <div className="text-xs text-muted">Noch nicht konfiguriert.</div>
            </div>
            <button
              type="button"
              onClick={() => setOpenSlot("primary")}
              className="shrink-0 rounded bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand/90"
            >
              Konfigurieren
            </button>
          </div>
        )}

        {/* Secondary — konfiguriert anzeigen, sonst Hinzufügen-Button */}
        {secondary?.configured && secondary.fromAddress ? (
          configuredRow(secondary)
        ) : (
          <button
            type="button"
            onClick={() => setOpenSlot("secondary")}
            className="flex w-full items-center gap-3 py-3 text-left hover:opacity-80"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-line bg-surface text-muted">
              <Plus size={14} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-muted">Weiteres Absende-Konto hinzufügen</div>
              <div className="text-xs text-muted">
                Eigene Absenderadresse für einen zweiten Empfänger.
              </div>
            </div>
          </button>
        )}
      </div>

      <Modal
        open={openSlot !== null}
        onClose={() => setOpenSlot(null)}
        title="Absende-Konto konfigurieren"
        size="md"
      >
        {openSlot !== null && (
          <MailboxConnectContent
            mode="settings"
            purpose="smtp-only"
            slot={openSlot}
            initialEmail={editing?.fromAddress ?? undefined}
            initialServers={editing?.servers}
            onSuccess={() => setOpenSlot(null)}
          />
        )}
      </Modal>
    </>
  );
}
