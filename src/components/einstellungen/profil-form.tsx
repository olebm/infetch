"use client";

import { useActionState } from "react";
import { updateProfileAction, type ProfileState } from "@/app/(app)/einstellungen/actions";

const idle: ProfileState = { status: "idle", message: "" };

export function ProfilForm({
  initialName,
  initialEmail,
  initialCompanyName,
  initialVatId,
}: {
  initialName: string;
  initialEmail: string;
  initialCompanyName: string;
  initialVatId: string;
}) {
  const [state, formAction, isPending] = useActionState(updateProfileAction, idle);

  return (
    <form action={formAction}>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          {/* A11Y (INFETCH-104): htmlFor verknüpft Label mit Input */}
          <label htmlFor="profile-name" className="mb-1.5 block text-xs font-medium text-muted">Name</label>
          <input
            id="profile-name"
            type="text"
            name="name"
            defaultValue={initialName}
            required
            maxLength={120}
            placeholder="Dein Name"
            className="h-9 w-full rounded border border-line bg-white px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
          />
        </div>
        <div>
          <label htmlFor="profile-email" className="mb-1.5 block text-xs font-medium text-muted">E-Mail</label>
          <input
            id="profile-email"
            type="email"
            defaultValue={initialEmail}
            readOnly
            title="E-Mail-Änderung per Support anfragen"
            className="h-9 w-full rounded border border-line bg-surface px-3 font-mono text-sm text-muted outline-none cursor-not-allowed"
          />
        </div>
        <div>
          <label htmlFor="profile-companyName" className="mb-1.5 block text-xs font-medium text-muted">Firmenname</label>
          <input
            id="profile-companyName"
            type="text"
            name="companyName"
            defaultValue={initialCompanyName}
            maxLength={200}
            placeholder="Dein Unternehmen (optional)"
            className="h-9 w-full rounded border border-line bg-white px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
          />
        </div>
        <div>
          <label htmlFor="profile-vatId" className="mb-1.5 block text-xs font-medium text-muted">USt-ID</label>
          <input
            id="profile-vatId"
            type="text"
            name="vatId"
            defaultValue={initialVatId}
            maxLength={50}
            placeholder="DE123456789 (optional)"
            className="h-9 w-full rounded border border-line bg-white px-3 font-mono text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-9 items-center gap-2 rounded bg-ink px-4 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Speichere…" : "Speichern"}
        </button>
        {/* A11Y (INFETCH-105): aria-live meldet Status-Änderungen an Screen-Reader */}
        <span
          aria-live="polite"
          aria-atomic="true"
          className={`text-sm ${
            state.status === "success"
              ? "text-ok"
              : state.status === "error"
                ? "text-danger"
                : "sr-only"
          }`}
        >
          {state.message}
        </span>
      </div>
    </form>
  );
}
