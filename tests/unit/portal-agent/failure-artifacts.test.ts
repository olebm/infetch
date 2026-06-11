import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FAILURE_RETENTION_DAYS,
  isExpiredArtifact,
  pruneFailureArtifacts,
} from "@/portals/agent/failure-artifacts";

// INFETCH-266 / AC3: Debug-Artefakte sind kurzlebig — Retention real, nicht
// nur dokumentiert.

const DAY = 24 * 60 * 60 * 1000;

describe("isExpiredArtifact", () => {
  it("ist abgelaufen, wenn aelter als die Aufbewahrungsfrist", () => {
    const now = 1_000 * DAY;
    expect(isExpiredArtifact(now - (FAILURE_RETENTION_DAYS + 1) * DAY, now)).toBe(true);
    expect(isExpiredArtifact(now - (FAILURE_RETENTION_DAYS - 1) * DAY, now)).toBe(false);
  });
});

describe("pruneFailureArtifacts", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "portal-fail-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("loescht nur Artefakte ueber der Aufbewahrungsfrist", async () => {
    const oldFile = path.join(dir, "old.png");
    const freshFile = path.join(dir, "fresh.png");
    await fs.writeFile(oldFile, "x");
    await fs.writeFile(freshFile, "y");

    const now = Date.now();
    const oldTime = new Date(now - (FAILURE_RETENTION_DAYS + 5) * DAY);
    await fs.utimes(oldFile, oldTime, oldTime);

    const removed = await pruneFailureArtifacts(dir, now);

    expect(removed).toBe(1);
    await expect(fs.access(oldFile)).rejects.toThrow();
    await expect(fs.access(freshFile)).resolves.toBeUndefined();
  });

  it("ist robust gegen ein fehlendes Verzeichnis", async () => {
    const removed = await pruneFailureArtifacts(path.join(dir, "does-not-exist"), Date.now());
    expect(removed).toBe(0);
  });
});
