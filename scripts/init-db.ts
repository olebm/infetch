import { sql } from "../src/lib/db/client";

async function main() {
  const rows = await sql<{ count: string }[]>`SELECT COUNT(*) AS count FROM vendors`;
  const vendorCount = Number(rows[0].count);
  console.log(`Database initialized with ${vendorCount} vendors.`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
