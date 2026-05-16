import { ImageResponse } from "next/og";

export const alt = "Infetch – Rechnungen, die sich selbst weiterleiten";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#fbfaf7",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 999,
              background: "#3d6948",
            }}
          />
          <div style={{ fontSize: 30, color: "#696965", letterSpacing: 1 }}>
            INFETCH
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 76,
              fontWeight: 700,
              color: "#1a1a1a",
              lineHeight: 1.05,
              letterSpacing: -2,
            }}
          >
            <div>Rechnungen, die sich</div>
            <div>selbst weiterleiten.</div>
          </div>
          <div style={{ fontSize: 32, color: "#696965", maxWidth: 900 }}>
            Dein Postfach scannt sich selbst. Jede Rechnung landet automatisch
            bei deiner Buchhaltung.
          </div>
        </div>

        <div style={{ display: "flex", gap: 40, fontSize: 26, color: "#696965" }}>
          <span>≈ 4 Min Einrichtung</span>
          <span>DSGVO · EU-Server</span>
          <span>KI · automatisch</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
