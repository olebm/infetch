// Polyfill WebSocket for Node.js < 22 so that @supabase/realtime-js
// can initialise without throwing when used in integration tests.
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") {
  // @ts-expect-error ws is not a perfect spec match but works for Supabase Realtime init
  globalThis.WebSocket = WebSocket;
}
