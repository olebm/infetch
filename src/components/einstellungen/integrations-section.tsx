"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Link2, X } from "lucide-react";
import {
  saveLexofficeApiKeyAction,
  saveSevdeskApiKeyAction,
  disconnectIntegrationAction,
  type IntegrationFormState,
} from "@/app/(app)/einstellungen/actions";

const idle: IntegrationFormState = { status: "idle", message: "" };

export type IntegrationStatus = {
  provider: "lexoffice" | "sevdesk" | "datev";
  enabled: boolean;
  label: string | null;
  externalAccountId: string | null;
  lastVerifiedAt: string | null;
};

export function IntegrationsSection({ integrations }: { integrations: IntegrationStatus[] }) {
  const lexoffice = integrations.find((i) => i.provider === "lexoffice");
  const sevdesk = integrations.find((i) => i.provider === "sevdesk");

  return (
    <div className="space-y-4">
      <LexofficeIntegrationCard status={lexoffice} />
      <SevdeskIntegrationCard status={sevdesk} />
      <ComingSoonCard
        provider="datev"
        title="DATEV Belegtransfer"
        description="DATEV Unternehmen online. Recherche-Phase. Kommt in Phase E."
      />
    </div>
  );
}

function LexofficeIntegrationCard({ status }: { status?: IntegrationStatus }) {
  const isConnected = status?.enabled === true;

  return (
    <div className="rounded border border-line bg-white p-4 shadow-soft">
      <div className="flex items-start gap-3">
        <div className="rounded bg-ok-soft p-2">
          <Link2 className="h-4 w-4 text-ok" aria-hidden />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">lexoffice</div>
              <div className="text-xs text-muted">
                {isConnected
                  ? `Verbunden: ${status?.label}`
                  : "Direkter Push an deine lexoffice-Belegerfassung statt SMTP-Forward."}
              </div>
            </div>
            {isConnected && (
              <span className="inline-flex items-center gap-1 rounded bg-ok-soft px-1.5 py-0.5 text-xs text-ok">
                <CheckCircle2 className="h-3 w-3" aria-hidden />
                aktiv
              </span>
            )}
          </div>

          {isConnected ? (
            <DisconnectForm provider="lexoffice" />
          ) : (
            <LexofficeApiKeyForm />
          )}
        </div>
      </div>
    </div>
  );
}

function SevdeskIntegrationCard({ status }: { status?: IntegrationStatus }) {
  const isConnected = status?.enabled === true;
  return (
    <div className="rounded border border-line bg-white p-4 shadow-soft">
      <div className="flex items-start gap-3">
        <div className="rounded bg-brand-soft p-2">
          <Link2 className="h-4 w-4 text-brand-deep" aria-hidden />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">sevDesk</div>
              <div className="text-xs text-muted">
                {isConnected
                  ? `Verbunden: ${status?.label}`
                  : "Direkter Push an deine sevDesk-Belegerfassung."}
              </div>
            </div>
            {isConnected && (
              <span className="inline-flex items-center gap-1 rounded bg-ok-soft px-1.5 py-0.5 text-xs text-ok">
                <CheckCircle2 className="h-3 w-3" aria-hidden />
                aktiv
              </span>
            )}
          </div>
          {isConnected ? <DisconnectForm provider="sevdesk" /> : <SevdeskApiKeyForm />}
        </div>
      </div>
    </div>
  );
}

function SevdeskApiKeyForm() {
  const [state, formAction, isPending] = useActionState(saveSevdeskApiKeyAction, idle);
  const [showHelp, setShowHelp] = useState(false);

  return (
    <form action={formAction} className="mt-3 space-y-2">
      <label className="block text-xs text-muted">
        API-Token{" "}
        <button
          type="button"
          onClick={() => setShowHelp(!showHelp)}
          className="text-brand underline-offset-2 hover:underline"
        >
          Wo finde ich den?
        </button>
      </label>
      {showHelp && (
        <div className="rounded border border-brand/30 bg-brand-soft px-3 py-2 text-xs text-brand-deep">
          Generiere den Token in sevDesk unter{" "}
          <strong>Mein Profil → API-Token</strong>. Im Gegensatz zu lexoffice in allen sevDesk-Plänen verfügbar.
        </div>
      )}
      <input
        type="password"
        name="apiKey"
        placeholder="API-Token"
        className="w-full rounded border border-line bg-white px-3 py-2 font-mono text-sm"
        autoComplete="off"
      />
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
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-brand px-3 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
      >
        {isPending ? "Prüfe…" : "Mit sevDesk verbinden"}
      </button>
    </form>
  );
}

function LexofficeApiKeyForm() {
  const [state, formAction, isPending] = useActionState(saveLexofficeApiKeyAction, idle);
  const [showHelp, setShowHelp] = useState(false);

  return (
    <form action={formAction} className="mt-3 space-y-2">
      <label className="block text-xs text-muted">
        API-Key{" "}
        <button
          type="button"
          onClick={() => setShowHelp(!showHelp)}
          className="text-brand underline-offset-2 hover:underline"
        >
          Wo finde ich den?
        </button>
      </label>
      {showHelp && (
        <div className="rounded border border-brand/30 bg-brand-soft px-3 py-2 text-xs text-brand-deep">
          Generiere den Key in lexoffice unter{" "}
          <a
            href="https://app.lexoffice.de/addons/public-api"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Add-ons → Public API
          </a>
          . <strong>Wichtig:</strong> Funktioniert nur mit lexoffice XL-Plan.
        </div>
      )}
      <input
        type="password"
        name="apiKey"
        placeholder="API-Key (z. B. 12345678-1234-...)"
        className="w-full rounded border border-line bg-white px-3 py-2 font-mono text-sm"
        autoComplete="off"
      />
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
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-brand px-3 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
      >
        {isPending ? "Prüfe…" : "Mit lexoffice verbinden"}
      </button>
    </form>
  );
}

function DisconnectForm({ provider }: { provider: "lexoffice" | "sevdesk" | "datev" }) {
  const [state, formAction, isPending] = useActionState(disconnectIntegrationAction, idle);
  void state;
  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="provider" value={provider} />
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-1 text-xs text-muted hover:text-danger disabled:opacity-50"
      >
        <X className="h-3 w-3" aria-hidden />
        Trennen
      </button>
    </form>
  );
}

function ComingSoonCard({
  provider,
  title,
  description,
}: {
  provider: string;
  title: string;
  description: string;
}) {
  void provider;
  return (
    <div className="rounded border border-dashed border-line bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-muted">{title}</div>
          <div className="mt-0.5 text-xs text-muted">{description}</div>
        </div>
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700">geplant</span>
      </div>
    </div>
  );
}
