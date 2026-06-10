import { describe, expect, it } from "vitest";
import { shouldFetchRow } from "@/portals/agent/recipe-player";

// INFETCH-52: Ein Portal-Lauf holt nur Rechnungen seit dem letzten erfolgreichen
// Lauf (since). shouldFetchRow ist die reine Entscheidungslogik dahinter.

describe("shouldFetchRow (since-Filter)", () => {
  it("ohne Filter: lädt jede datierte Zeile", () => {
    expect(shouldFetchRow("2026-06-01", {})).toBe(true);
  });

  it("ohne rowDate: lädt konservativ (lieber laden + dedupen als verpassen)", () => {
    expect(shouldFetchRow(null, { since: "2026-06-01" })).toBe(true);
    expect(shouldFetchRow(null, { targetYearMonth: "2026-06" })).toBe(true);
  });

  it("since: ältere Zeile wird übersprungen, gleiche/neuere geladen", () => {
    expect(shouldFetchRow("2026-05-31", { since: "2026-06-01" })).toBe(false);
    expect(shouldFetchRow("2026-06-01", { since: "2026-06-01" })).toBe(true);
    expect(shouldFetchRow("2026-06-15", { since: "2026-06-01" })).toBe(true);
  });

  it("targetYearMonth: nur der Zielmonat", () => {
    expect(shouldFetchRow("2026-06-15", { targetYearMonth: "2026-06" })).toBe(true);
    expect(shouldFetchRow("2026-05-15", { targetYearMonth: "2026-06" })).toBe(false);
  });

  it("kombiniert: beide Bedingungen müssen passen", () => {
    expect(shouldFetchRow("2026-06-15", { targetYearMonth: "2026-06", since: "2026-06-10" })).toBe(
      true,
    );
    // im Zielmonat, aber vor since → übersprungen
    expect(shouldFetchRow("2026-06-05", { targetYearMonth: "2026-06", since: "2026-06-10" })).toBe(
      false,
    );
  });
});
