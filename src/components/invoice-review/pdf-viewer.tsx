"use client";

import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface PdfViewerProps {
  src: string;
  className?: string;
}

type State = "loading" | "rendered" | "error";

export function PdfViewer({ src, className = "" }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    const container = containerRef.current;
    container.innerHTML = "";
    setState("loading");

    (async () => {
      try {
        const pdf = await pdfjsLib.getDocument({ url: src, withCredentials: true }).promise;
        if (cancelled) return;

        // Render all pages sequentially into stacked canvases
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) break;

          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.6 });

          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;

          canvas.width = viewport.width;
          canvas.height = viewport.height;
          // Scale canvas CSS to fill the container width
          canvas.style.cssText = "width:100%;display:block;background:#fff;";

          if (pageNum > 1) {
            const sep = document.createElement("div");
            sep.style.cssText = "height:6px;background:#e8e6e0;";
            container.appendChild(sep);
          }

          container.appendChild(canvas);

          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) break;
        }

        if (!cancelled) setState("rendered");
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <div className={`relative ${className}`}>
      {state === "loading" && (
        <div className="stripe flex h-64 items-center justify-center text-sm text-muted">
          Lade PDF…
        </div>
      )}
      {state === "error" && (
        <div className="flex h-48 items-center justify-center text-sm text-muted">
          PDF konnte nicht geladen werden.
        </div>
      )}
      <div ref={containerRef} className={state === "loading" ? "hidden" : ""} />
    </div>
  );
}
