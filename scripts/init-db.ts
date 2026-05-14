import { getDb } from "../src/lib/db/client";

const db = getDb();
const vendorCount = db.prepare("SELECT COUNT(*) AS count FROM vendors").get() as { count: number };

console.log(`Database initialized with ${vendorCount.count} vendors.`);
