"use client";

import { createContext, useContext, useState } from "react";

type SupportContextType = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const SupportContext = createContext<SupportContextType | null>(null);

export function SupportProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <SupportContext.Provider
      value={{ isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) }}
    >
      {children}
    </SupportContext.Provider>
  );
}

export function useSupportModal() {
  const ctx = useContext(SupportContext);
  if (!ctx) throw new Error("useSupportModal must be used inside SupportProvider");
  return ctx;
}
