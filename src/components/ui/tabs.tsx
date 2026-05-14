"use client";

import { useState } from "react";

export type TabItem = {
  key: string;
  label: React.ReactNode;
  content: React.ReactNode;
  badge?: number | string | null;
};

type TabsProps = {
  tabs: TabItem[];
  defaultKey?: string;
};

export function Tabs({ tabs, defaultKey }: TabsProps) {
  const [active, setActive] = useState(defaultKey ?? tabs[0]?.key);
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 border-b border-line" role="tablist">
        {tabs.map((tab) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(tab.key)}
              className={`inline-flex items-center gap-2 border-b-2 px-3 md:px-4 h-11 text-sm font-medium whitespace-nowrap transition-colors ${
                selected
                  ? "border-brand text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {tab.label}
              {tab.badge != null && tab.badge !== "" && (
                <span
                  className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium ${
                    selected ? "bg-brand/15 text-brand" : "bg-muted/20 text-muted"
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
