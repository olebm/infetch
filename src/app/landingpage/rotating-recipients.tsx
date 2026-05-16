"use client";

import { useState, useEffect } from "react";
import { VendorLogo } from "@/components/ui/vendor-logo";

const POOL = [
  { domain: "datev.de",              label: "DATEV Belegtransfer" },
  { domain: "xero.com",              label: "Xero"                },
  { domain: "sevdesk.de",            label: "sevdesk"             },
  { domain: "quickbooks.com",        label: "QuickBooks"          },
  { domain: "lexoffice.de",          label: "lexoffice"           },
  { domain: "sage.com",              label: "Sage"                },
  { domain: "candis.io",             label: "Candis"              },
  { domain: "fastbill.com",          label: "FastBill"            },
  { domain: "billomat.com",          label: "Billomat"            },
  { domain: "weclapp.com",           label: "weclapp"             },
  { domain: "easybill.de",           label: "easybill"            },
  { domain: "getmoss.com",           label: "Moss"                },
  { domain: "pleo.io",               label: "Pleo"                },
  { domain: "sumup.com",             label: "SumUp"               },
  { domain: "buchhaltungsbutler.de", label: "Buchhaltungsbutler"  },
];

const DISPLAY = 7;

function LogoTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="relative group/tip">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 rounded-md px-2.5 py-1 bg-ink text-white text-[11px] leading-snug whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 shadow-pop">
        {label}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-[4px] border-transparent border-t-ink" />
      </span>
    </span>
  );
}

export function RotatingRecipients() {
  const [slots, setSlots] = useState(POOL.slice(0, DISPLAY));
  const [fadingIdx, setFadingIdx] = useState<number | null>(null);

  useEffect(() => {
    // shuffle initial selection client-side to avoid hydration mismatch
    const shuffled = [...POOL].sort(() => Math.random() - 0.5);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlots(shuffled.slice(0, DISPLAY));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * DISPLAY);
      setFadingIdx(idx);

      setTimeout(() => {
        setSlots((prev) => {
          const taken = new Set(prev.map((l) => l.domain));
          const available = POOL.filter((l) => !taken.has(l.domain));
          if (!available.length) return prev;
          const next = available[Math.floor(Math.random() * available.length)];
          return prev.map((l, i) => (i === idx ? next : l));
        });
        setFadingIdx(null);
      }, 280);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <ul className="mt-5 flex flex-wrap gap-3">
      {slots.map((item, i) => (
        // index key is intentional: keeps DOM node stable so opacity transition works
        <li
          key={i}
          className={`h-12 w-12 logo-tile rounded-full flex items-center justify-center cursor-default overflow-hidden transition-opacity duration-[280ms] ${
            fadingIdx === i ? "opacity-0" : "opacity-100"
          }`}
        >
          <LogoTip label={item.label}>
            <VendorLogo domain={item.domain} name={item.label} size={40} />
          </LogoTip>
        </li>
      ))}
      {/* fixed: generic email always visible */}
      <li className="h-12 w-12 logo-tile rounded-full flex items-center justify-center cursor-default overflow-hidden">
        <LogoTip label="Beliebige E-Mail">
          <span className="text-xl text-muted font-medium">@</span>
        </LogoTip>
      </li>
    </ul>
  );
}
