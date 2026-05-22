"use client";

import { useEffect, useState } from "react";
import { formatDemoNow, type DemoTimeFormat } from "./demo-time";

/**
 * Live-Datums-/Zeitangaben für den Marketing-Demo-Mockup ("Heute"-Dashboard).
 *
 * Client-seitig, weil die Landingpage statisch vorgerendert wird — ein
 * server-seitiges `new Date()` würde beim Build einfrieren und wieder schnell
 * veralten. `fallback` (in page.tsx server-seitig vorberechnet) ist der initiale
 * State: identisch bei SSR und erstem Client-Render → keine Hydration-Mismatch-
 * Warnung, und ohne JS bleibt das Feld nicht leer. Nach dem Mount wird auf die
 * echte aktuelle Zeit aktualisiert; das Datum/Uhrzeit-Format tickt minütlich.
 */
export function LiveNow({
  format,
  fallback,
}: {
  format: DemoTimeFormat;
  fallback: string;
}) {
  const [text, setText] = useState(fallback);

  useEffect(() => {
    const update = () => setText(formatDemoNow(new Date(), format));
    update();
    if (format !== "datetime") return; // nur die Uhr muss ticken
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [format]);

  return <>{text}</>;
}
