import { describe, expect, it } from "vitest";
import { createScopedSql, type ScopedSql } from "@/lib/db/scoped-query";
import { unsafeGlobalSql } from "@/lib/db/unsafe-global";

describe("scoped-query / unsafe-global wrappers", () => {
  it("createScopedSql returns a tagged-template-compatible client", () => {
    const scoped = createScopedSql("org-test-123");
    expect(typeof scoped).toBe("function");
  });

  it("createScopedSql is identity at runtime (intentional — type-only narrowing)", () => {
    // The wrapper is a marker today; the value is in the import discipline
    // (ESLint blocks bare `sql` from `@/lib/db/client`). Once SET LOCAL
    // app.current_org is wired up, this assertion will need updating.
    const scoped: ScopedSql = createScopedSql("org-test-123");
    expect(scoped).toBe(unsafeGlobalSql);
  });

  it("calling createScopedSql with different org ids returns equivalent clients", () => {
    // Today they're identical; this test exists so the future SET-LOCAL
    // version surfaces correctness regressions immediately.
    const a = createScopedSql("org-a");
    const b = createScopedSql("org-b");
    expect(a).toBe(b); // until SET LOCAL is added, then this should become not.toBe
  });

  it("unsafeGlobalSql is the canonical opt-out for cross-org access", () => {
    // The point of this assertion is to lock in the audit pattern:
    // `grep -rn "unsafeGlobalSql" src/` enumerates every place that
    // intentionally crosses orgs.
    expect(typeof unsafeGlobalSql).toBe("function");
  });
});
