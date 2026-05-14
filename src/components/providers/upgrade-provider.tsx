"use client";

import { createContext, useContext, useState } from "react";

type UpgradeContextValue = {
  stripeLink: string | null;
  open: boolean;
  feature: string | null;
  openModal: (feature?: string) => void;
  closeModal: () => void;
};

const UpgradeContext = createContext<UpgradeContextValue>({
  stripeLink: null,
  open: false,
  feature: null,
  openModal: () => {},
  closeModal: () => {},
});

export function useUpgrade() {
  return useContext(UpgradeContext);
}

export function UpgradeProvider({
  stripeLink,
  children,
}: {
  stripeLink: string | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [feature, setFeature] = useState<string | null>(null);

  return (
    <UpgradeContext.Provider
      value={{
        stripeLink,
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
