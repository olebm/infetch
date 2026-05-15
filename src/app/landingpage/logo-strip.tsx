"use client";

import { useState, useEffect } from "react";
import { VendorLogo } from "@/components/ui/vendor-logo";

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="relative group/tip inline-flex">
      {children}
      <span className="hidden md:block pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                       rounded-md px-2.5 py-1 bg-ink text-white text-[11px] leading-snug
                       whitespace-nowrap opacity-0 group-hover/tip:opacity-100
                       transition-opacity duration-150 z-50 shadow-pop">
        {label}
        <span className="absolute top-full left-1/2 -translate-x-1/2
                         border-[4px] border-transparent border-t-ink" />
      </span>
    </span>
  );
}

const POOL = [
  { domain: "adobe.com",      alt: "Adobe"      },
  { domain: "canva.com",      alt: "Canva"       },
  { domain: "cloudflare.com", alt: "Cloudflare"  },
  { domain: "dropbox.com",    alt: "Dropbox"     },
  { domain: "figma.com",      alt: "Figma"       },
  { domain: "github.com",     alt: "GitHub"      },
  { domain: "google.com",     alt: "Google"      },
  { domain: "hubspot.com",    alt: "HubSpot"     },
  { domain: "microsoft.com",  alt: "Microsoft"   },
  { domain: "notion.so",      alt: "Notion"      },
  { domain: "monday.com",     alt: "monday.com"  },
  { domain: "shopify.com",    alt: "Shopify"     },
  { domain: "slack.com",      alt: "Slack"       },
  { domain: "spotify.com",    alt: "Spotify"     },
  { domain: "stripe.com",     alt: "Stripe"      },
];

const DISPLAY_COUNT = 7;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function LogoStrip() {
  const [logos, setLogos] = useState(POOL.slice(0, DISPLAY_COUNT));
  useEffect(() => { setLogos(shuffle([...POOL]).slice(0, DISPLAY_COUNT)); }, []);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-5 md:gap-x-10">
      {logos.map(({ domain, alt }) => (
        <Tip key={domain} label={alt}>
          <VendorLogo domain={domain} name={alt} size={48} />
        </Tip>
      ))}
    </div>
  );
}
