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
import { DeleteImapAccountButton } from "@/components/einstellungen/delete-imap-account-button";

export interface MailboxSlot {
  key: "primary" | "secondary" | "tertiary";
  isConnected: boolean;
  email: string | null;
  providerDomain: string | null;
  /** Gespeicherte Server-Konfig zum Vorausfüllen beim „Ändern" (v. a. Custom-Domains). */
  servers?: {
    imapHost?: string;
    imapPort?: number;
    imapSecure?: boolean;
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure?: boolean;
  };
}

interface MailboxConnectCardProps {
  slots: MailboxSlot[];
  isPro: boolean;
}

// "Weiteres Postfach verbinden" (sekundäres Postfach) ist ein Pro-Feature.
// Aktiv: Pro-User (inkl. PRO_TEST_ORG_IDS-Override) sehen den Sekundär-Slot,
// Free sieht die ProBadge. Backend trägt beide Slots — der Tier-Gate in
// einstellungen/actions.ts erlaubt den zweiten INSERT und mail-scanner.ts
// scannt beide Postfächer pro Org.
const SHOW_SECONDARY_MAILBOX = true;

export function MailboxConnectCard({ slots, isPro }: MailboxConnectCardProps) {
  const [openSlot, setOpenSlot] = useState<"primary" | "secondary" | "tertiary" | null>(null);

  const primary = slots.find((s) => s.key === "primary")!;
  const secondary = slots.find((s) => s.key === "secondary");
  const hasSecondary = secondary?.isConnected;
  const tertiary = slots.find((s) => s.key === "tertiary");
  const hasTertiary = tertiary?.isConnected;

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
                Empfang aktiv · Primäres Postfach
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
                Empfang aktiv · Sekundäres Postfach
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setOpenSlot("secondary")}
                className="rounded border border-line px-3 py-1.5 text-xs text-muted hover:border-brand/50 hover:text-ink"
              >
                Ändern
              </button>
              <DeleteImapAccountButton slot="secondary" />
            </div>
          </div>
        ) : (
          /* Show "add secondary" only once primary is connected (vorerst ausgeblendet) */
          SHOW_SECONDARY_MAILBOX &&
          primary.isConnected &&
          (isPro ? (
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
                <div className="text-xs text-muted">
                  Sekundäres Konto für zusätzliche Postfächer.
                </div>
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
                <div className="text-xs text-muted">
                  Sekundäres Konto für zusätzliche Postfächer.
                </div>
              </div>
            </div>
          ))
        )}

        {/* ── Tertiary slot ────────────────────────────────────────────────── */}
        {hasTertiary && tertiary?.email ? (
          <div className="flex items-center gap-3 py-3">
            <VendorLogo
              domain={tertiary.providerDomain ?? null}
              name={tertiary.email}
              size={36}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{tertiary.email}</span>
                <StatusBadge status="configured" label="verbunden" />
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-ok">
                <Check size={11} aria-hidden />
                Empfang aktiv · Drittes Postfach
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setOpenSlot("tertiary")}
                className="rounded border border-line px-3 py-1.5 text-xs text-muted hover:border-brand/50 hover:text-ink"
              >
                Ändern
              </button>
              <DeleteImapAccountButton slot="tertiary" />
            </div>
          </div>
        ) : (
          /* Drittes Postfach erst anbieten, wenn das zweite verbunden ist (Pro). */
          SHOW_SECONDARY_MAILBOX &&
          secondary?.isConnected &&
          isPro && (
            <button
              type="button"
              onClick={() => setOpenSlot("tertiary")}
              className="flex w-full items-center gap-3 py-3 text-left hover:opacity-80"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-line bg-surface text-muted">
                <Plus size={14} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-muted">Weiteres Postfach verbinden</div>
                <div className="text-xs text-muted">Drittes Empfangs-Konto (Pro).</div>
              </div>
            </button>
          )
        )}
      </div>

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      <Modal
        open={openSlot !== null}
        onClose={() => setOpenSlot(null)}
        title={
          openSlot === "secondary"
            ? "Sekundäres Postfach verbinden"
            : openSlot === "tertiary"
              ? "Drittes Postfach verbinden"
              : "Postfach verbinden"
        }
        size="md"
      >
        {openSlot !== null && (
          <MailboxConnectContent
            mode="settings"
            purpose="imap-only"
            slot={openSlot}
            initialEmail={slots.find((s) => s.key === openSlot)?.email ?? undefined}
            initialServers={slots.find((s) => s.key === openSlot)?.servers}
            onSuccess={() => setOpenSlot(null)}
          />
        )}
      </Modal>
    </>
  );
}
