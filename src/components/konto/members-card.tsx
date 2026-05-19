"use client";

import { useActionState, useState } from "react";
import { UserPlus, Trash2, ChevronDown, Clock, X, Users } from "lucide-react";
import { useUpgrade } from "@/components/providers/upgrade-provider";
import {
  inviteMemberAction,
  removeMemberAction,
  changeMemberRoleAction,
  revokeInvitationAction,
  type MemberActionState,
} from "@/app/(app)/konto/actions";

const idle: MemberActionState = { status: "idle", message: "" };

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrgMember = {
  userId: string;
  name: string | null;
  email: string;
  role: string;
};

export type PendingInvite = {
  userId: string;
  email: string;
  role: string;
  invitedAt: string;
};

type Props = {
  members: OrgMember[];
  pendingInvitations: PendingInvite[];
  currentUserId: string;
  currentUserRole: string;
  orgName: string;
  maxUsers: number;
  isPro: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string | null, email: string) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  }
  return email.slice(0, 2).toUpperCase();
}

function roleLabel(role: string) {
  if (role === "owner") return "Inhaber";
  if (role === "admin") return "Bearbeiter";
  return "Nur lesen";
}

// ── Invite Form ───────────────────────────────────────────────────────────────

function InviteForm({ onClose }: { onClose: () => void }) {
  const [state, formAction, isPending] = useActionState(inviteMemberAction, idle);

  return (
    <form action={formAction} className="border-t border-line px-5 py-4 space-y-3 bg-surface/50">
      <div className="text-xs font-medium text-ink">Einladung senden</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input
          type="email"
          name="email"
          required
          placeholder="name@firma.de"
          className="sm:col-span-2 h-9 rounded border border-line bg-white px-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <select
          name="role"
          defaultValue="member"
          className="h-9 rounded border border-line bg-white px-3 text-sm focus:border-brand focus:outline-none"
        >
          <option value="member">Nur lesen</option>
          <option value="admin">Bearbeiter</option>
        </select>
      </div>
      {state.message && (
        <div
          className={`rounded border px-3 py-2 text-xs ${
            state.status === "error"
              ? "border-danger/30 bg-danger-soft text-danger"
              : "border-ok/30 bg-ok-soft text-ok"
          }`}
        >
          {state.message}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand px-4 py-2 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {isPending ? "Sende…" : "Einladung senden"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-line px-4 py-2 text-xs text-muted hover:text-ink"
        >
          Abbrechen
        </button>
      </div>
    </form>
  );
}

// ── Member Row ────────────────────────────────────────────────────────────────

function MemberRow({
  member,
  isMe,
  callerRole,
}: {
  member: OrgMember;
  isMe: boolean;
  callerRole: string;
}) {
  const [removeState, removeAction, removeIsPending] = useActionState(removeMemberAction, idle);
  const [roleState, roleAction, roleIsPending] = useActionState(changeMemberRoleAction, idle);
  const [showRoleMenu, setShowRoleMenu] = useState(false);

  const canRemove = !isMe && callerRole === "owner" && member.role !== "owner";
  const canChangeRole = callerRole === "owner" && !isMe;

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      {/* Avatar */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-medium text-white">
        {initials(member.name, member.email)}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">
          {member.name || member.email}
          {isMe && <span className="ml-2 text-xs text-muted">(du)</span>}
        </div>
        <div className="truncate text-xs text-muted">{member.email}</div>
        {(removeState.status === "error") && (
          <div className="mt-1 text-xs text-danger">{removeState.message}</div>
        )}
        {(roleState.status === "error") && (
          <div className="mt-1 text-xs text-danger">{roleState.message}</div>
        )}
      </div>

      {/* Role badge / changer */}
      {canChangeRole ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowRoleMenu(!showRoleMenu)}
            className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-muted hover:border-brand/50 hover:text-ink"
          >
            {roleLabel(member.role)}
            <ChevronDown size={10} aria-hidden />
          </button>
          {showRoleMenu && (
            <div className="absolute right-0 top-full z-10 mt-1 w-32 rounded border border-line bg-white shadow-soft">
              {(["owner", "admin", "member"] as const).map((r) => (
                <form key={r} action={roleAction}>
                  <input type="hidden" name="userId" value={member.userId} />
                  <input type="hidden" name="role" value={r} />
                  <button
                    type="submit"
                    disabled={roleIsPending || r === member.role}
                    onClick={() => setShowRoleMenu(false)}
                    className={`w-full px-3 py-2 text-left text-xs hover:bg-surface disabled:opacity-40 ${r === member.role ? "font-medium text-brand" : "text-ink"}`}
                  >
                    {roleLabel(r)}
                  </button>
                </form>
              ))}
            </div>
          )}
        </div>
      ) : (
        <span className="text-xs text-muted">{roleLabel(member.role)}</span>
      )}

      {/* Remove */}
      {canRemove && (
        <form action={removeAction}>
          <input type="hidden" name="userId" value={member.userId} />
          <button
            type="submit"
            disabled={removeIsPending}
            title="Mitglied entfernen"
            className="ml-1 flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-40"
          >
            <Trash2 size={13} aria-hidden />
          </button>
        </form>
      )}
    </li>
  );
}

// ── Pending Invite Row ────────────────────────────────────────────────────────

function PendingInviteRow({ invite, canRevoke }: { invite: PendingInvite; canRevoke: boolean }) {
  const [state, revokeAction, revokeIsPending] = useActionState(revokeInvitationAction, idle);

  return (
    <li className="flex items-center gap-3 px-5 py-3 opacity-70">
      {/* Avatar — dashed circle to indicate pending */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-muted text-[11px] font-medium text-muted">
        <Clock size={13} aria-hidden />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-muted font-mono">{invite.email}</div>
        <div className="text-xs text-muted">
          Einladung ausstehend · {roleLabel(invite.role)}
        </div>
        {state.status === "error" && (
          <div className="mt-1 text-xs text-danger">{state.message}</div>
        )}
      </div>

      {/* Revoke */}
      {canRevoke && (
        <form action={revokeAction}>
          <input type="hidden" name="userId" value={invite.userId} />
          <button
            type="submit"
            disabled={revokeIsPending}
            title="Einladung zurückziehen"
            className="ml-1 flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-40"
          >
            <X size={13} aria-hidden />
          </button>
        </form>
      )}
    </li>
  );
}

// ── Main Card ─────────────────────────────────────────────────────────────────

export function MembersCard({ members, pendingInvitations, currentUserId, currentUserRole, orgName, maxUsers, isPro }: Props) {
  const [showInviteForm, setShowInviteForm] = useState(false);
  const { openModal, proEnabled } = useUpgrade();

  const canInvite = currentUserRole === "owner" || currentUserRole === "admin";
  const atLimit = members.length >= maxUsers;

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 p-5">
        <div>
          <div className="text-sm font-medium text-ink">
            Mitglieder{orgName ? ` · ${orgName}` : ""}{" "}
            <span className="text-xs font-normal text-muted">({members.length}/{maxUsers})</span>
          </div>
          <div className="text-xs text-muted">
            Wer sieht und bearbeitet Rechnungen in diesem Arbeitsbereich.
          </div>
        </div>

        {canInvite && !atLimit && (
          <button
            type="button"
            onClick={() => setShowInviteForm(!showInviteForm)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-line bg-surface px-3 py-1.5 text-xs text-muted hover:border-brand/50 hover:text-ink"
          >
            <UserPlus size={12} aria-hidden />
            Einladen
          </button>
        )}
        {canInvite && atLimit && isPro && (
          <span className="text-xs text-muted">Limit erreicht ({maxUsers}/{maxUsers})</span>
        )}
      </div>

      {/* Invite form */}
      {showInviteForm && <InviteForm onClose={() => setShowInviteForm(false)} />}

      {/* Members list */}
      <ul className="divide-y divide-line border-t border-line">
        {members.map((m) => (
          <MemberRow
            key={m.userId}
            member={m}
            isMe={m.userId === currentUserId}
            callerRole={currentUserRole}
          />
        ))}
        {members.length === 0 && (
          <li className="px-5 py-3 text-sm text-muted">Keine Mitglieder gefunden.</li>
        )}
        {pendingInvitations.map((inv) => (
          <PendingInviteRow
            key={inv.userId}
            invite={inv}
            canRevoke={currentUserRole === "owner" || currentUserRole === "admin"}
          />
        ))}
      </ul>

      {/* Upgrade CTA — Free only */}
      {!isPro && proEnabled && (
        <div className="flex items-center gap-4 border-t border-line bg-brand/[0.03] px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-brand/20 bg-brand/10 text-brand">
            <Users size={15} aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-ink">Gemeinsam arbeiten</div>
            <div className="text-xs text-muted">Mit Pro bis zu 3 Nutzer einladen.</div>
          </div>
          <button
            type="button"
            onClick={() => openModal("Weitere Mitglieder einladen")}
            className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 transition-colors"
          >
            Upgrade
          </button>
        </div>
      )}
    </>
  );
}
