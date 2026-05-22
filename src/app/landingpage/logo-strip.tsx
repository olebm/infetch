"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

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

// INFETCH-132: Logos lokal gebündelt (public/images/logos/*.svg, Simple Icons CC0)
// statt Brandfetch-CDN — keine externen Drittanbieter-Requests auf der öffentlichen
// Landingpage. Versioniert + immutable gecacht (next.config.mjs).
// Pool jederzeit erweiterbar: scripts/fetch-landing-logos.mjs.
const POOL: ReadonlyArray<{ slug: string; alt: string }> = [
  { slug: "google",       alt: "Google"       },
  { slug: "figma",        alt: "Figma"        },
  { slug: "dropbox",      alt: "Dropbox"      },
  { slug: "github",       alt: "GitHub"       },
  { slug: "zoom",         alt: "Zoom"         },
  { slug: "notion",       alt: "Notion"       },
  { slug: "stripe",       alt: "Stripe"       },
  { slug: "slack",        alt: "Slack"        },
  { slug: "adobe",        alt: "Adobe"        },
  { slug: "atlassian",    alt: "Atlassian"    },
  { slug: "asana",        alt: "Asana"        },
  { slug: "miro",         alt: "Miro"         },
  { slug: "canva",        alt: "Canva"        },
  { slug: "mailchimp",    alt: "Mailchimp"    },
  { slug: "zapier",       alt: "Zapier"       },
  { slug: "vercel",       alt: "Vercel"       },
  { slug: "cloudflare",   alt: "Cloudflare"   },
  { slug: "gitlab",       alt: "GitLab"       },
  { slug: "shopify",      alt: "Shopify"      },
  { slug: "hetzner",      alt: "Hetzner"      },
  { slug: "linear",       alt: "Linear"       },
  { slug: "airtable",     alt: "Airtable"     },
  { slug: "sentry",       alt: "Sentry"       },
  { slug: "twilio",       alt: "Twilio"       },
  { slug: "intercom",     alt: "Intercom"     },
  { slug: "digitalocean", alt: "DigitalOcean" },
  { slug: "hubspot",      alt: "HubSpot"      },
  { slug: "trello",       alt: "Trello"       },
  { slug: "calendly",     alt: "Calendly"     },
];

const DISPLAY = 7;

export function LogoStrip() {
  // SSR / ohne JS: die ersten DISPLAY (vertraute Marken) — stabil, kein
  // Hydration-Mismatch. Beim Mount wird client-seitig zufällig gemischt, sodass
  // jeder Seitenaufruf eine andere Auswahl aus dem Pool zeigt.
  const [slots, setSlots] = useState<ReadonlyArray<{ slug: string; alt: string }>>(
    () => POOL.slice(0, DISPLAY),
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bewusste Shuffle-Auswahl pro Reload
    setSlots([...POOL].sort(() => Math.random() - 0.5).slice(0, DISPLAY));
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-5 md:gap-x-10">
      {slots.map(({ slug, alt }) => (
        <Tip key={slug} label={alt}>
          <div
            className="rounded-full inline-flex shrink-0 items-center justify-center overflow-hidden bg-white"
            style={{ width: 48, height: 48 }}
          >
            <Image
              src={`/images/logos/${slug}.svg`}
              alt=""
              width={32}
              height={32}
              unoptimized
              style={{ objectFit: "contain" }}
            />
          </div>
        </Tip>
      ))}
    </div>
  );
}
