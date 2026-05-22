// Geteilte Datums-Formatierung für den Landing-Demo-Mockup. Bewusst KEIN
// "use client" — dadurch sowohl server-seitig (Build-Fallback in page.tsx) als
// auch client-seitig (Live-Tick in live-demo.tsx) nutzbar, ohne Duplikat.

export const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

export type DemoTimeFormat = "datetime" | "month" | "monthName" | "year";

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDemoNow(d: Date, format: DemoTimeFormat): string {
  switch (format) {
    case "datetime":
      return `${d.getDate()}. ${MONTHS_DE[d.getMonth()]} ${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    case "month":
      return `${MONTHS_DE[d.getMonth()]} ${d.getFullYear()}`;
    case "monthName":
      return MONTHS_DE[d.getMonth()]!;
    case "year":
      return String(d.getFullYear());
  }
}
