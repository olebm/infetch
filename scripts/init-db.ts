import { sql } from "../src/lib/db/client";

const rows = await sql<{ count: string }[]>`SELECT COUNT(*) AS count FROM vendors`;
const vendorCount = Number(rows[0].count);

console.log(`Database initialized with ${vendorCount} vendors.`);
await sql.end();
