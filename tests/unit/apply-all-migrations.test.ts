import { describe, expect, it } from "vitest";
import {
  extractVersion,
  parseArgs,
  selectMigrationFiles,
} from "../../scripts/apply-all-migrations.mjs";

describe("apply-all-migrations — parseArgs", () => {
  it("parses a bare DATABASE_URL positional", () => {
    const out = parseArgs(["postgresql://u:p@h:5432/db"]);
    expect(out.databaseUrl).toBe("postgresql://u:p@h:5432/db");
    expect(out.upTo).toBeNull();
    expect(out.sets).toEqual([]);
    expect(out.snapshotMode).toBe("ci-fresh");
  });

  it("accepts --up-to as both '--up-to=NNNN' and '--up-to NNNN'", () => {
    expect(parseArgs(["--up-to=0018"]).upTo).toBe("0018");
    expect(parseArgs(["--up-to", "0018"]).upTo).toBe("0018");
  });

  it("accepts --set as both '--set=k=v' and '--set k=v', repeatable", () => {
    const out = parseArgs(["--set=app.designated_org=185109b5-…", "--set", "app.other=value"]);
    expect(out.sets).toEqual(["app.designated_org=185109b5-…", "app.other=value"]);
  });

  it("accepts --snapshot-mode in both forms", () => {
    expect(parseArgs(["--snapshot-mode=prod-replay"]).snapshotMode).toBe("prod-replay");
    expect(parseArgs(["--snapshot-mode", "prod-replay"]).snapshotMode).toBe("prod-replay");
  });

  it("rejects an invalid --snapshot-mode", () => {
    expect(() => parseArgs(["--snapshot-mode=garbage"])).toThrow(/Invalid --snapshot-mode/);
  });

  it("rejects a --set without =", () => {
    expect(() => parseArgs(["--set", "no-equals-here"])).toThrow(/key=value/);
  });

  it("rejects unknown arguments", () => {
    expect(() => parseArgs(["--made-up-flag"])).toThrow(/Unknown argument/);
  });

  it("accepts --skip in both forms, repeatable", () => {
    expect(parseArgs(["--skip=0002"]).skip).toEqual(["0002"]);
    expect(parseArgs(["--skip", "0002", "--skip=0010"]).skip).toEqual(["0002", "0010"]);
  });

  it("combines a URL with options", () => {
    const out = parseArgs([
      "postgresql://ci:ci@localhost:5432/ci",
      "--snapshot-mode=ci-fresh",
      "--set",
      "app.designated_org=550e8400-e29b-41d4-a716-446655440000",
      "--up-to=0022",
    ]);
    expect(out.databaseUrl).toBe("postgresql://ci:ci@localhost:5432/ci");
    expect(out.snapshotMode).toBe("ci-fresh");
    expect(out.sets).toHaveLength(1);
    expect(out.upTo).toBe("0022");
  });
});

describe("apply-all-migrations — extractVersion", () => {
  it("extracts the leading numeric prefix", () => {
    expect(extractVersion("0001_initial_schema.sql")).toBe("0001");
    expect(extractVersion("0019_multitenant_isolation.sql")).toBe("0019");
    expect(extractVersion("0022_prebackfill_org_attribution.sql")).toBe("0022");
  });

  it("throws on filenames without a numeric prefix", () => {
    expect(() => extractVersion("README.md")).toThrow(/Cannot extract version/);
    expect(() => extractVersion("init.sql")).toThrow(/Cannot extract version/);
  });
});

describe("apply-all-migrations — selectMigrationFiles", () => {
  const fileList = [
    "0001_initial_schema.sql",
    "0022_RUNBOOK.md", // non-sql, must be filtered
    "0010_rls.sql",
    "0003_stripe.sql",
    "0019_multitenant_isolation.sql",
    "0022_prebackfill_org_attribution.sql",
    "0021_remaining_boolean_columns.sql",
  ];

  it("filters .sql only and sorts lexically", () => {
    const out = selectMigrationFiles(fileList);
    expect(out).toEqual([
      "0001_initial_schema.sql",
      "0003_stripe.sql",
      "0010_rls.sql",
      "0019_multitenant_isolation.sql",
      "0021_remaining_boolean_columns.sql",
      "0022_prebackfill_org_attribution.sql",
    ]);
  });

  it("respects --up-to as an inclusive cap (string compare)", () => {
    const out = selectMigrationFiles(fileList, { upTo: "0018" });
    expect(out).toEqual(["0001_initial_schema.sql", "0003_stripe.sql", "0010_rls.sql"]);
  });

  it("includes the boundary version exactly", () => {
    const out = selectMigrationFiles(fileList, { upTo: "0019" });
    expect(out).toEqual([
      "0001_initial_schema.sql",
      "0003_stripe.sql",
      "0010_rls.sql",
      "0019_multitenant_isolation.sql",
    ]);
  });

  it("removes versions listed in skip[]", () => {
    const out = selectMigrationFiles(fileList, { skip: ["0001", "0019"] });
    expect(out).toEqual([
      "0003_stripe.sql",
      "0010_rls.sql",
      "0021_remaining_boolean_columns.sql",
      "0022_prebackfill_org_attribution.sql",
    ]);
  });

  it("skip and upTo combine — skip applies, then upTo caps", () => {
    const out = selectMigrationFiles(fileList, { skip: ["0010"], upTo: "0019" });
    expect(out).toEqual([
      "0001_initial_schema.sql",
      "0003_stripe.sql",
      "0019_multitenant_isolation.sql",
    ]);
  });
});
