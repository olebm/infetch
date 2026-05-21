/**
 * Seeds the global vendor catalog (vendors + aliases) from src/vendors/registry.ts.
 *
 * The matcher + several tests require a seeded catalog, but `supabase db reset`
 * only runs migrations (there is no supabase/seed.sql). Run this after a reset:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     npx tsx scripts/seed-vendors.ts
 *
 * or `npm run seed`. Idempotent (ON CONFLICT upserts).
 */
import { seedDatabase } from "@/vendors/seed";

seedDatabase()
  .then(() => {
    console.log("Vendor catalog seeded.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Vendor seed failed:", err);
    process.exit(1);
  });
