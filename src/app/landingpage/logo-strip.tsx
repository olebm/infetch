import Image from "next/image";

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
// statt Brandfetch-CDN — keine externen Drittanbieter-Requests auf der
// öffentlichen Landingpage mehr. Logos sind versioniert und im Browser-Cache
// (Cache-Control: immutable via next.config.mjs).
const DISPLAY: ReadonlyArray<{ slug: string; alt: string }> = [
  { slug: "google",   alt: "Google"   },
  { slug: "figma",    alt: "Figma"    },
  { slug: "dropbox",  alt: "Dropbox"  },
  { slug: "github",   alt: "GitHub"   },
  { slug: "zoom",     alt: "Zoom"     },
  { slug: "notion",   alt: "Notion"   },
  { slug: "stripe",   alt: "Stripe"   },
];

export function LogoStrip() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-5 md:gap-x-10">
      {DISPLAY.map(({ slug, alt }) => (
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
