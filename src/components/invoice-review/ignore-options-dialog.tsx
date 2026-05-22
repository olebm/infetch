"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  blockInvoiceSenderAction,
  markSenderDomainPrivateAction,
} from "@/app/(app)/audit/actions";

type IgnoreScope = "once" | "sender" | "domain";

interface IgnoreOptionsDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirmOnce: () => void;
  senderAddress: string | null;
  vendorDomain: string | null;
  vendorName: string | null;
}

function RadioOption({
  value,
  selected,
  onChange,
  children,
}: {
  value: IgnoreScope;
  selected: IgnoreScope;
  onChange: (v: IgnoreScope) => void;
  children: React.ReactNode;
}) {
  const isSelected = value === selected;
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
        isSelected
          ? "border-brand/60 bg-brand/5 text-ink"
          : "border-line text-muted hover:border-line/80 hover:text-ink"
      }`}
    >
      <input
        type="radio"
        name="ignore-scope"
        value={value}
        checked={isSelected}
        onChange={() => onChange(value)}
        className="mt-0.5 shrink-0 accent-brand"
      />
      <span className="text-sm leading-snug">{children}</span>
    </label>
  );
}

export function IgnoreOptionsDialog({
  open,
  onClose,
  onConfirmOnce,
  senderAddress,
  vendorDomain,
  vendorName,
}: IgnoreOptionsDialogProps) {
  const [selected, setSelected] = useState<IgnoreScope>("once");
  const [isPending, startTransition] = useTransition();

  const domain =
    vendorDomain ||
    (senderAddress ? senderAddress.split("@").at(-1) ?? null : null);

  const senderLabel = vendorName || senderAddress || domain || "diesem Absender";

  function handleConfirm() {
    if (selected === "once") {
      onConfirmOnce();
      onClose();
      return;
    }
    startTransition(async () => {
      if (selected === "sender" && senderAddress) {
        await blockInvoiceSenderAction(senderAddress);
      } else if (selected === "domain" && domain) {
        await markSenderDomainPrivateAction(domain);
      }
      onConfirmOnce();
      onClose();
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rechnung ignorieren"
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded border border-line px-4 py-2 text-xs text-muted transition hover:text-ink disabled:opacity-50"
          >
            Abbrechen
          </button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? "…" : "Ignorieren"}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <RadioOption value="once" selected={selected} onChange={setSelected}>
          Nur diese Rechnung einmalig ausschließen
        </RadioOption>

        {senderAddress && (
          <RadioOption value="sender" selected={selected} onChange={setSelected}>
            Alle künftigen von{" "}
            <span className="font-medium text-ink">{senderLabel}</span>
          </RadioOption>
        )}

        {domain && (
          <RadioOption value="domain" selected={selected} onChange={setSelected}>
            Domain{" "}
            <span className="font-mono font-medium text-ink">{domain}</span>{" "}
            immer ignorieren
          </RadioOption>
        )}
      </div>
    </Modal>
  );
}
