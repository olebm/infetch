"use client";

/**
 * MailboxConnectCard — Einstellungen Postfach-Sektion.
 *
 * Zeigt alle verbundenen Postfächer als Liste (mit Provider-Logo + Status).
 * Primäres und sekundäres Slot, jeweils mit Ändern/Verbinden-Modal.
 */

import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { ProBadge } from "@/components/ui/pro-badge";
import { Modal } from "@/components/ui/modal";
import { MailboxConnectContent } from "@/components/credentials/mailbox-connect-content";
import { VendorLogo } from "@/components/ui/vendor-logo";
import { StatusBadge } from "@/components/status/status-badge";

export interface MailboxSlot {
  key: "primary" | "secondary";
  isConnected: boolean;
  email: string | null;
  providerDomain: string | null;
}

interface MailboxConnectCardProps {
  slots: MailboxSlot[];
  isPro: boolean;
}

export function MailboxConnectCard({ slots, isPro }: MailboxConnectCardProps) {
  const [openSlot, setOpenSlot] = useState<"primary" | "secondary" | null>(null);

  const primary   = slots.find((s) => s.key === "primary")!;
  const secondary = slots.find((s) => s.key === "secondary");
  const hasSecondary = secondary?.isConnected;

  return (
    <>
      <div className="divide-y divide-line">

        {/* ── Primary slot ─────────────────────────────────────────────────── */}
        {primary.isConnected && primary.email ? (
          <div className="flex items-center gap-3 py-3">
            <VendorLogo
              domain={primary.providerDomain ?? null}
              name={primary.email}
              size={36}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{primary.email}</span>
                <StatusBadge status="configured" label="verbunden" />
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-ok">
                <Check size={11} aria-hidden />
                IMAP + SMTP konfiguriert · Primäres Postfach
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpenSlot("primary")}
              className="shrink-0 rounded border border-line px-3 py-1.5 text-xs text-muted hover:border-brand/50 hover:text-ink"
            >
              Ändern
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-line bg-surface text-muted">
              <Plus size={14} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink">Primäres Postfach</div>
              <div className="text-xs text-muted">Noch nicht verbunden.</div>
            </div>
            <button
              type="button"
              onClick={() => setOpenSlot("primary")}
              className="shrink-0 rounded bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand/90"
            >
              Verbinden
            </button>
          </div>
        )}

        {/* ── Secondary slot ───────────────────────────────────────────────── */}
        {hasSecondary && secondary?.email ? (
          <div className="flex items-center gap-3 py-3">
            <VendorLogo
              domain={secondary.providerDomain ?? null}
              name={secondary.email}
              size={36}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{secondary.email}</span>
                <StatusBadge status="configured" label="verbunden" />
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-ok">
                <Check size={11} aria-hidden />
                IMAP + SMTP konfiguriert · Sekundäres Postfach
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpenSlot("secondary")}
              className="shrink-0 rounded border border-line px-3 py-1.5 text-xs text-muted hover:border-brand/50 hover:text-ink"
            >
              Ändern
            </button>
          </div>
        ) : (
          /* Show "add secondary" only once primary is connected */
          primary.isConnected && (
            isPro ? (
              <button
                type="button"
                onClick={() => setOpenSlot("secondary")}
                className="flex w-full items-center gap-3 py-3 text-left hover:opacity-80"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-line bg-surface text-muted">
                  <Plus size={14} aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-muted">Weiteres Postfach verbinden</div>
                  <div className="text-xs text-muted">Sekundäres Konto für zusätzliche Postfächer.</div>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-3 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-line bg-surface text-muted">
                  <Plus size={14} aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted">Weiteres Postfach verbinden</span>
                    <ProBadge feature="Sekundäres Postfach" />
                  </div>
                  <div className="text-xs text-muted">Sekundäres Konto für zusätzliche Postfächer.</div>
                </div>
              </div>
            )
          )
        )}
      </div>

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      <Modal
        open={openSlot !== null}
        onClose={() => setOpenSlot(null)}
        title={openSlot === "secondary" ? "Sekundäres Postfach verbinden" : "Postfach verbinden"}
        size="md"
      >
        {openSlot !== null && (
          <MailboxConnectContent
            mode="settings"
            slot={openSlot}
            initialEmail={slots.find((s) => s.key === openSlot)?.email ?? undefined}
            onSuccess={() => setOpenSlot(null)}
          />
        )}
      </Modal>
    </>
  );
}
