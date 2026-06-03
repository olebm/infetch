import { addDays, getDaysInMonth, isWeekend, startOfDay } from "date-fns";

/**
 * Karenz in Tagen nach dem erwarteten Eingangstag, bevor ein laufender Monat
 * als „fehlt" gilt. Deckt die normale Streuung des Rechnungslaufs ab — der
 * Eingangstag schwankt von Monat zu Monat um ein paar Tage (User-Vorgabe:
 * „2–3 Tage Verzug" sollen toleriert werden, nicht sofort als Lücke gelten).
 */
export const MISSING_GRACE_DAYS = 3;

/** "yyyy-MM" → { year, month0 } (month0 = 0-basiert für JS-`Date`). */
function parseYearMonth(yearMonth: string): { year: number; month0: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) return null;
  const year = Number(match[1]);
  const month0 = Number(match[2]) - 1;
  if (month0 < 0 || month0 > 11) return null;
  return { year, month0 };
}

function toYearMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Fälligkeitsdatum für einen (Vendor-)Monat: erwarteter Eingangstag (Median aus
 * der Historie) + Karenz. Fällt das Ergebnis auf ein Wochenende, schiebt es auf
 * den nächsten Werktag (Rechnungen kommen am WE oft erst Montag). Ohne
 * verlässlichen Eingangstag (zu wenig Historie) → `null`.
 */
export function computeMissingDueDate(
  yearMonth: string,
  expectedDay: number | null,
  graceDays: number = MISSING_GRACE_DAYS,
): Date | null {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed || expectedDay == null || !Number.isFinite(expectedDay)) return null;

  const daysInMonth = getDaysInMonth(new Date(parsed.year, parsed.month0, 1));
  const day = Math.min(Math.max(Math.round(expectedDay), 1), daysInMonth);

  let due = startOfDay(new Date(parsed.year, parsed.month0, day));
  due = addDays(due, graceDays);
  // Wochenend-Verzug: Sa/So → nächster Werktag (Montag).
  while (isWeekend(due)) due = addDays(due, 1);
  return due;
}

/**
 * Soll ein fehlender (Vendor-)Monat schon als „fehlt" angezeigt werden?
 *
 *  - Vergangene Monate: immer (längst überfällig).
 *  - Zukünftige Monate: nie.
 *  - Laufender Monat: erst NACH der Fälligkeit (erwarteter Eingangstag +
 *    Karenz, Wochenende auf Werktag verschoben) — sonst wirkt es verfrüht,
 *    obwohl der Anbieter die Rechnung womöglich noch gar nicht gestellt hat.
 *  - Ohne verlässlichen Eingangstag (zu wenig Historie): erst wenn der Monat
 *    vorüber ist (konservativ, nie verfrüht).
 */
export function isMissingDue(
  yearMonth: string,
  expectedDay: number | null,
  today: Date = new Date(),
  graceDays: number = MISSING_GRACE_DAYS,
): boolean {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) return true; // defensiv: lieber zeigen als verschlucken

  const todayYm = toYearMonth(today);
  if (yearMonth < todayYm) return true; // abgeschlossener Monat
  if (yearMonth > todayYm) return false; // zukünftiger Monat

  // Laufender Monat: nur, wenn die Fälligkeit überschritten ist.
  const due = computeMissingDueDate(yearMonth, expectedDay, graceDays);
  if (!due) return false; // keine verlässliche Erwartung → noch nicht zeigen
  return startOfDay(today).getTime() > due.getTime();
}
