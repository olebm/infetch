import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { appConfig } from "@/lib/config/env";
import { ensureDataDirs } from "@/lib/filesystem/ensure-data-dirs";
import { schemaStatements } from "@/lib/db/schema";
import { seedDatabase } from "@/vendors/seed";

let database: Database.Database | null = null;

export function getDb() {
  if (database) {
    return database;
  }

  ensureDataDirs();
  fs.mkdirSync(path.dirname(appConfig.databaseUrl), { recursive: true, mode: 0o700 });

  database = new Database(appConfig.databaseUrl);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");

  for (const statement of schemaStatements) {
    try {
      database.exec(statement);
    } catch (error) {
      // ALTER TABLE ADD COLUMN is not idempotent in SQLite — ignore if column already exists
      const isAlterAddColumn = /^\s*ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\s+/i.test(statement);
      if (isAlterAddColumn && error instanceof Error && error.message.includes("duplicate column name")) {
        continue;
      }
      throw error;
    }
  }

  seedDatabase(database);

  return database;
}
