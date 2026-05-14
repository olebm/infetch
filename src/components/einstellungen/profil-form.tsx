"use client";

import { useActionState, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { updateProfileAction, type ProfileState } from "@/app/(app)/einstellungen/actions";
import { uploadAvatarAction } from "@/app/(app)/konto/actions";

const idle: ProfileState = { status: "idle", message: "" };
const avatarIdle = { status: "idle" as const, message: "" };

// ── Avatar Upload ─────────────────────────────────────────────────────────────

function AvatarUpload({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
}) {
  const [state, formAction, isPending] = useActionState(uploadAvatarAction, avatarIdle);
  const [preview, setPreview] = useState<string | null>(avatarUrl);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

  return (
    <form ref={formRef} action={formAction} className="shrink-0">
      <input
        ref={inputRef}
        type="file"
        name="avatar"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setPreview(URL.createObjectURL(f));
          formRef.current?.requestSubmit();
        }}
      />
      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          title="Profilbild ändern"
          aria-label="Profilbild hochladen"
          className="group relative h-16 w-16 overflow-hidden rounded-full bg-ink text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-lg font-medium select-none">
              {initials}
            </span>
          )}
          {/* Hover / loading overlay */}
          <span
            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          >
            {isPending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Camera size={16} className="text-white" />
            )}
          </span>
        </button>
        {state.status === "error" && (
          <p className="text-[10px] text-danger max-w-[72px] text-center leading-tight">{state.message}</p>
        )}
      </div>
    </form>
  );
}

// ── Profile Form ──────────────────────────────────────────────────────────────

export function ProfilForm({
  initialName,
  initialEmail,
  initialCompanyName,
  initialVatId,
  initialAvatarUrl,
}: {
  initialName: string;
  initialEmail: string;
  initialCompanyName: string;
  initialVatId: string;
  initialAvatarUrl: string | null;
}) {
  const [state, formAction, isPending] = useActionState(updateProfileAction, idle);

  return (
    <div className="flex items-start gap-5">
      {/* Avatar */}
      <AvatarUpload name={initialName} avatarUrl={initialAvatarUrl} />

      {/* Text fields */}
      <form action={formAction} className="flex-1 min-w-0">
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
    </div>
  );
}
