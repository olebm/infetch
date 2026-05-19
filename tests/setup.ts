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
