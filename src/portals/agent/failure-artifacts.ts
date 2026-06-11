/**
 * Retention der Portal-Failure-Debug-Artefakte (INFETCH-266 / AC3).
 *
 * Failure-Screenshots liegen unter `<logStoragePath>/portal-failures` und sind
 * gitignored (`data/logs/**`). Sie sind ein kurzlebiges Debug-Hilfsmittel, kein
 * Dauerarchiv — deshalb werden beim Schreiben eines neuen Screenshots aeltere
 * Artefakte ueber der Aufbewahrungsfrist best-effort geloescht.
 * Siehe docs/portal-failure-artifacts.md.
 */

import fs from "node:fs/promises";
import path from "node:path";

export const FAILURE_RETENTION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Reine Entscheidung: ist ein Artefakt aelter als die Aufbewahrungsfrist? */
export function isExpiredArtifact(
  mtimeMs: number,
  nowMs: number,
  retentionDays = FAILURE_RETENTION_DAYS,
): boolean {
  return nowMs - mtimeMs > retentionDays * DAY_MS;
}

/**
 * Loescht Failure-Artefakte aelter als die Aufbewahrungsfrist. Best-effort:
 * Fehler werden geschluckt (Debug-Aufraeumen darf einen Abruf nie stoeren).
 * Gibt die Anzahl geloeschter Dateien zurueck.
 */
export async function pruneFailureArtifacts(
  dir: string,
  nowMs: number,
  retentionDays = FAILURE_RETENTION_DAYS,
): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      if (isExpiredArtifact(stat.mtimeMs, nowMs, retentionDays)) {
        await fs.unlink(full);
        removed++;
      }
    } catch {
      // einzelne Datei nicht prunebar -> ueberspringen
    }
  }
  return removed;
}
