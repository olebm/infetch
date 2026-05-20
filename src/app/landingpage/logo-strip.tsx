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

// Sieben handverlesene Logos in stabiler Reihenfolge. Die ursprüngliche
// Random-Shuffle-Logik lief client-seitig und kostete einen Hydration-Step
// für ein rein dekoratives Element — entfernt zugunsten des Static-Renders.
const DISPLAY: ReadonlyArray<{ domain: string; alt: string }> = [
  { domain: "google.com",    alt: "Google"    },
  { domain: "microsoft.com", alt: "Microsoft" },
  { domain: "adobe.com",     alt: "Adobe"     },
  { domain: "github.com",    alt: "GitHub"    },
  { domain: "slack.com",     alt: "Slack"     },
  { domain: "notion.so",     alt: "Notion"    },
  { domain: "stripe.com",    alt: "Stripe"    },
];

export function LogoStrip() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-5 md:gap-x-10">
      {DISPLAY.map(({ domain, alt }) => (
        <Tip key={domain} label={alt}>
          <VendorLogo domain={domain} name={alt} size={48} />
        </Tip>
      ))}
    </div>
  );
}
