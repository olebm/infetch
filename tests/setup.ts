// Polyfill WebSocket for Node.js < 22 so that @supabase/realtime-js
// can initialise without throwing when used in integration tests.
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") {
  // @ts-expect-error ws is not a perfect spec match but works for Supabase Realtime init
  globalThis.WebSocket = WebSocket;
}

// Hard guard: tests INSERT/DELETE rows, so they must never reach a hosted
// Supabase instance. The .env.test.local override is gitignored and absent on
// fresh checkouts/CI — without this, tests would silently hit prod.
if (/supabase\.co/i.test(process.env.DATABASE_URL ?? "")) {
  throw new Error(
    "Refusing to run tests: DATABASE_URL targets a hosted Supabase instance " +
      "(*.supabase.co). Tests must use the local DB — ensure .env.test.local exists.",
  );
}

// Hard guard: the sentry-webhook route appends to data/sentry-errors.jsonl in
// cwd. Tests that POST to it must never pollute the real file (incident
// 2026-06-11: nine phantom "Unbekannter Fehler" entries written by test runs).
import { tmpdir } from "node:os";
import { join } from "node:path";
if (!process.env.SENTRY_ERRORS_FILE) {
  process.env.SENTRY_ERRORS_FILE = join(
    tmpdir(),
    `infetch-test-${process.pid}`,
    "sentry-errors.jsonl",
  );
}
