// Type declarations for scripts/apply-all-migrations.mjs.
// Kept as .d.mts so TypeScript's bundler resolution pairs it with the .mjs.

export interface ParsedArgs {
  databaseUrl: string | null;
  upTo: string | null;
  sets: string[];
  snapshotMode: "ci-fresh" | "prod-replay";
  migrationsDir: string | null;
  help?: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs;

export function extractVersion(filename: string): string;

export interface SelectMigrationFilesOptions {
  upTo?: string;
}

export function selectMigrationFiles(
  allFiles: string[],
  opts?: SelectMigrationFilesOptions,
): string[];

export interface ApplySummary {
  applied: string[];
  skipped: string[];
  total: number;
}

export interface ApplyAllMigrationsOptions {
  // Tagged-template SQL client from the `postgres` lib. Kept loose because we
  // don't want to depend on its types from a build-tool boundary.
  sql: {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
    unsafe(text: string): Promise<unknown>;
  };
  migrationsDir: string;
  upTo?: string | null;
  sets?: string[];
  logger?: Pick<Console, "log" | "error">;
}

export function applyAllMigrations(opts: ApplyAllMigrationsOptions): Promise<ApplySummary>;

export function main(argv?: string[]): Promise<void>;
