"use client";

import { createContext, useContext, useState } from "react";

type UpgradeContextValue = {
  /** true wenn STRIPE_SECRET_KEY + STRIPE_PRICE_ID_PRO gesetzt sind */
  stripeConfigured: boolean;
  /**
   * Globaler Pro-Schalter (Free-only Launch). false → sämtliche Pro-UI
   * (Badges, Upgrade-Modal, Plan-CTAs) wird ausgeblendet, openModal ist No-op.
   */
  proEnabled: boolean;
  open: boolean;
  feature: string | null;
  openModal: (feature?: string) => void;
  closeModal: () => void;
};

const UpgradeContext = createContext<UpgradeContextValue>({
  stripeConfigured: false,
  proEnabled: false,
  open: false,
  feature: null,
  openModal: () => {},
  closeModal: () => {},
});

export function useUpgrade() {
  return useContext(UpgradeContext);
}

export function UpgradeProvider({
  stripeConfigured,
  children,
}: {
  stripeConfigured: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [feature, setFeature] = useState<string | null>(null);

  // NEXT_PUBLIC_ wird zur Build-Zeit inlined → im Browser verfügbar.
  const proEnabled = process.env.NEXT_PUBLIC_PRO_ENABLED === "true";

  return (
    <UpgradeContext.Provider
      value={{
        stripeConfigured,
        proEnabled,
        open,
        feature,
        openModal: (f) => {
          if (!proEnabled) return; // Free-only: kein Upgrade-Pfad
          setFeature(f ?? null);
          setOpen(true);
        },
        closeModal: () => {
          setOpen(false);
          setFeature(null);
        },
      }}
    >
      {children}
    </UpgradeContext.Provider>
  );
}
