"use client";

import { useState } from "react";
import { Ban, Link2, ShieldOff, UserPlus } from "lucide-react";
import {
  blockSenderAction,
  createVendorFromSenderAction,
  linkSenderToVendorAction,
  unblockSenderAction,
} from "@/app/(app)/senders/actions";
import type { DiscoveredSender } from "@/senders/discovered-senders";

type Vendor = {
  id: number;
  name: string;
  canonicalKey: string;
  category: string;
  portalEnabled: number;
};

type Mode = null | "block" | "link" | "create";

export function SenderRowActions({
  sender,
  vendors,
}: {
  sender: DiscoveredSender;
  vendors: Vendor[];
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);

  const close = () => {
    setMode(null);
    setFeedback(null);
  };

  const handle = async (formData: FormData, action: typeof blockSenderAction) => {
    setPending(true);
    try {
      const result = await action({ status: "idle", message: "" }, formData);
      if (result.status === "success") {
        setFeedback({ type: "success", message: result.message });
      } else if (result.status === "error") {
        setFeedback({ type: "error", message: result.message });
      }
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Aktion fehlgeschlagen.",
      });
    } finally {
      setPending(false);
    }
  };

  if (mode === null) {
    return (
      <div className="flex flex-wrap justify-end gap-1.5">
        {sender.blocked ? (
          <form
            action={async (formData) => {
              formData.set("senderId", String(sender.id));
              await handle(formData, unblockSenderAction);
            }}
          >
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded border border-line bg-paper px-2 py-1 text-xs font-medium hover:bg-surface disabled:opacity-60"
            >
              <ShieldOff className="h-3.5 w-3.5" aria-hidden /> Freigeben
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setMode("block")}
            className="inline-flex items-center gap-1.5 rounded border border-danger/30 bg-paper px-2 py-1 text-xs font-medium text-danger hover:bg-danger-soft"
          >
            <Ban className="h-3.5 w-3.5" aria-hidden /> Blocken
          </button>
        )}
        <button
          type="button"
          onClick={() => setMode("link")}
          className="inline-flex items-center gap-1.5 rounded border border-line bg-paper px-2 py-1 text-xs font-medium hover:bg-surface"
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden /> Vendor zuweisen
        </button>
        {!sender.matchedVendorId && (
          <button
            type="button"
            onClick={() => setMode("create")}
            className="inline-flex items-center gap-1.5 rounded border border-line bg-paper px-2 py-1 text-xs font-medium hover:bg-surface"
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden /> Neuer Vendor
          </button>
        )}
        {feedback && (
          <div
            className={`mt-2 w-full text-right text-xs ${
              feedback.type === "error" ? "text-danger" : "text-ok"
            }`}
          >
            {feedback.message}
          </div>
        )}
      </div>
    );
  }

  if (mode === "block") {
    return (
      <form
        className="flex items-center justify-end gap-2"
        action={async (formData) => {
          formData.set("senderId", String(sender.id));
          await handle(formData, blockSenderAction);
          if (!feedback || feedback.type === "success") close();
        }}
      >
        <input
          type="text"
          name="reason"
          placeholder="Grund (optional)"
          className="w-40 rounded border border-line bg-paper px-2 py-1 text-xs"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-danger px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
        >
          Blocken
        </button>
        <button
          type="button"
          onClick={close}
          className="rounded border border-line bg-paper px-2 py-1 text-xs font-medium hover:bg-surface"
        >
          Abbrechen
        </button>
      </form>
    );
  }

  if (mode === "link") {
    return (
      <form
        className="flex items-center justify-end gap-2"
        action={async (formData) => {
          formData.set("senderId", String(sender.id));
          await handle(formData, linkSenderToVendorAction);
          if (!feedback || feedback.type === "success") close();
        }}
      >
        <select
          name="vendorId"
          defaultValue={sender.matchedVendorId ? String(sender.matchedVendorId) : ""}
          className="rounded border border-line bg-paper px-2 py-1 text-xs"
        >
          <option value="">— keine Verknüpfung —</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-ink px-2 py-1 text-xs font-medium text-paper disabled:opacity-60"
        >
          Speichern
        </button>
        <button
          type="button"
          onClick={close}
          className="rounded border border-line bg-paper px-2 py-1 text-xs font-medium hover:bg-surface"
        >
          Abbrechen
        </button>
      </form>
    );
  }

  return (
    <form
      className="flex flex-wrap items-center justify-end gap-2"
      action={async (formData) => {
        formData.set("senderId", String(sender.id));
        await handle(formData, createVendorFromSenderAction);
        if (!feedback || feedback.type === "success") close();
      }}
    >
      <input
        type="text"
        name="vendorName"
        defaultValue={sender.displayName || sender.fromDomain}
        placeholder="Vendor-Name"
        className="w-44 rounded border border-line bg-paper px-2 py-1 text-xs"
        required
      />
      <select
        name="category"
        defaultValue="service"
        className="rounded border border-line bg-paper px-2 py-1 text-xs"
      >
        <option value="service">Service</option>
        <option value="hosting">Hosting</option>
        <option value="ai">AI</option>
        <option value="utility">Utility</option>
        <option value="other">Other</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-ink px-2 py-1 text-xs font-medium text-paper disabled:opacity-60"
      >
        Anlegen
      </button>
      <button
        type="button"
        onClick={close}
        className="rounded border border-line bg-paper px-2 py-1 text-xs font-medium hover:bg-surface"
      >
        Abbrechen
      </button>
    </form>
  );
}
