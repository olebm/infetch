import { describe, expect, it } from "vitest";
import {
  computeMissingDueDate,
  isMissingDue,
  MISSING_GRACE_DAYS,
} from "@/invoices/missing-expectation";

// Lokaler Helfer: 1-basierter Monat → Date (Mitternacht lokal).
const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);

// Kalender-Anker für die Tests: Juni 2026 beginnt an einem Montag.
//   Sa/So: 6./7., 13./14., 20./21., 27./28.

describe("missing-expectation", () => {
  it("uses a 3-day grace period", () => {
    expect(MISSING_GRACE_DAYS).toBe(3);
  });

  describe("computeMissingDueDate", () => {
    it("adds the grace period and shifts a weekend result to the next weekday", () => {
      // Erwarteter Tag 10 + 3 Karenz = 13. Juni; der 13.06.2026 ist Samstag
      // → verschoben auf Montag, den 15.
      expect(computeMissingDueDate("2026-06", 10)).toEqual(D(2026, 6, 15));
    });

    it("never returns a Saturday or Sunday", () => {
      for (let day = 1; day <= 28; day++) {
        const due = computeMissingDueDate("2026-06", day);
        expect(due).not.toBeNull();
        const dow = due!.getDay();
        expect(dow === 0 || dow === 6).toBe(false);
      }
    });

    it("clamps the expected day to the length of the month", () => {
      // Februar 2026 hat 28 Tage; erwarteter Tag 31 darf nicht überlaufen.
      const due = computeMissingDueDate("2026-02", 31);
      expect(due).not.toBeNull();
      expect(Number.isNaN(due!.getTime())).toBe(false);
    });

    it("returns null without a reliable expected day", () => {
      expect(computeMissingDueDate("2026-06", null)).toBeNull();
      expect(computeMissingDueDate("2026-06", Number.NaN)).toBeNull();
    });

    it("returns null for a malformed year-month", () => {
      expect(computeMissingDueDate("nope", 10)).toBeNull();
      expect(computeMissingDueDate("2026-13", 10)).toBeNull();
    });
  });

  describe("isMissingDue", () => {
    it("always flags fully past months", () => {
      expect(isMissingDue("2026-05", 10, D(2026, 6, 1))).toBe(true);
      expect(isMissingDue("2026-05", null, D(2026, 6, 1))).toBe(true);
    });

    it("never flags future months", () => {
      expect(isMissingDue("2026-07", 1, D(2026, 6, 30))).toBe(false);
    });

    it("does not flag the current month before the due date", () => {
      // due = 15.06. (siehe oben) → am 3., 14. und 15. noch nicht fällig.
      expect(isMissingDue("2026-06", 10, D(2026, 6, 3))).toBe(false);
      expect(isMissingDue("2026-06", 10, D(2026, 6, 14))).toBe(false);
      expect(isMissingDue("2026-06", 10, D(2026, 6, 15))).toBe(false);
    });

    it("flags the current month once the due date has passed", () => {
      expect(isMissingDue("2026-06", 10, D(2026, 6, 16))).toBe(true);
      expect(isMissingDue("2026-06", 10, D(2026, 6, 28))).toBe(true);
    });

    it("tolerates a few days of delay around the expected day", () => {
      // Erwartet am 1.; ohne Karenz wäre der 1. sofort „fehlt". Mit Karenz
      // ist der erwartete Tag selbst und der Folgetag noch nicht fällig.
      expect(isMissingDue("2026-06", 1, D(2026, 6, 1))).toBe(false);
      expect(isMissingDue("2026-06", 1, D(2026, 6, 2))).toBe(false);
    });

    it("waits until the month is over when no expected day is known", () => {
      expect(isMissingDue("2026-06", null, D(2026, 6, 15))).toBe(false);
      expect(isMissingDue("2026-06", null, D(2026, 6, 30))).toBe(false);
      // Erst im Folgemonat (dann ein abgeschlossener Monat) wird die Lücke gezeigt.
      expect(isMissingDue("2026-06", null, D(2026, 7, 1))).toBe(true);
    });
  });
});
