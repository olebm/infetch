"use client";

import { createContext, useContext, useState } from "react";

type UpgradeContextValue = {
  /** true wenn STRIPE_SECRET_KEY + STRIPE_PRICE_ID_PRO gesetzt sind */
  stripeConfigured: boolean;
  open: boolean;
  feature: string | null;
  openModal: (feature?: string) => void;
  closeModal: () => void;
};

const UpgradeContext = createContext<UpgradeContextValue>({
  stripeConfigured: false,
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

  return (
    <UpgradeContext.Provider
      value={{
        stripeConfigured,
        open,
        feature,
        openModal: (f) => { setFeature(f ?? null); setOpen(true); },
        closeModal: () => { setOpen(false); setFeature(null); },
      }}
    >
      {children}
    </UpgradeContext.Provider>
  );
}
