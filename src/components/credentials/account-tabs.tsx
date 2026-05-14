"use client";

import { useState, type ReactNode } from "react";

type Tab = {
  key: string;
  label: string;
  badge?: string | null;
  content: ReactNode;
};

export function AccountTabs({ tabs, defaultTab }: { tabs: Tab[]; defaultTab?: string }) {
  const [active, setActive] = useState<string>(defaultTab ?? tabs[0]?.key ?? "");
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div className="space-y-3">
      <div role="tablist" className="inline-flex gap-1 rounded border border-line bg-surface p-1">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab.key)}
              className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm transition ${
                isActive ? "bg-white font-semibold text-ink shadow-soft" : "text-muted hover:text-ink"
              }`}
            >
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  className={`rounded px-1.5 text-xs ${
                    isActive ? "bg-brand/10 text-brand" : "bg-white text-muted"
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{activeTab?.content}</div>
    </div>
  );
}
