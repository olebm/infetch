import { describe, expect, it } from "vitest";
import { createScopedSql, type ScopedSql } from "@/lib/db/scoped-query";
import { unsafeGlobalSql } from "@/lib/db/unsafe-global";

// INFETCH-175: createScopedSql ist jetzt KEIN Identity-Wrapper mehr —
// jede scoped`...`-Invocation öffnet eine Transaktion und setzt
// app.current_org via set_config(). Integration-Test in
// tests/integration/security/scoped-query-set-local.test.ts deckt das
// Runtime-Verhalten ab; hier prüfen wir nur die Eingabe-Validation und
// die Typen-Form.

describe("scoped-query / unsafe-global wrappers", () => {
  it("createScopedSql returns a callable tagged-template wrapper", () => {
    const scoped: ScopedSql = createScopedSql("org-test-123");
    expect(typeof scoped).toBe("function");
  });

  it("createScopedSql rejects empty / invalid orgId early", () => {
    expect(() => createScopedSql("")).toThrow(/non-empty/);
    expect(() => createScopedSql("contains spaces")).toThrow(/unexpected shape/);
    expect(() => createScopedSql("a".repeat(200))).toThrow(/unexpected shape/);
    expect(() => createScopedSql("evil'; DROP TABLE invoices; --")).toThrow(/unexpected shape/);
  });

  it("createScopedSql accepts UUID-shaped and slug-shaped orgIds", () => {
    expect(() => createScopedSql("185109b5-aaaa-bbbb-cccc-1234567890ab")).not.toThrow();
    expect(() => createScopedSql("org-slug-with-dashes")).not.toThrow();
    expect(() => createScopedSql("snake_case_org_id")).not.toThrow();
  });

  it("calls with different org ids return distinct Proxy instances", () => {
    const a = createScopedSql("org-a");
    const b = createScopedSql("org-b");
    expect(a).not.toBe(b);
  });

  it("scoped is NOT identical to unsafeGlobalSql anymore (SET LOCAL wired up)", () => {
    const scoped = createScopedSql("org-test-123");
    expect(scoped).not.toBe(unsafeGlobalSql);
  });

  it("unsafeGlobalSql is the canonical opt-out for cross-org access", () => {
    // The point of this assertion is to lock in the audit pattern:
    // `grep -rn "unsafeGlobalSql" src/` enumerates every place that
    // intentionally crosses orgs.
    expect(typeof unsafeGlobalSql).toBe("function");
  });
});
