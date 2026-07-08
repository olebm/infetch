import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Allowlist: files that still import the bare `sql` from `@/lib/db/client`
// at the time the no-restricted-imports rule landed (PR #19, W4). Each entry
// is a file that needs to be migrated to either:
//
//   - `getCurrentAuth().scopedSql` / `createScopedSql(orgId)`  — org-scoped
//   - `unsafeGlobalSql` from `@/lib/db/unsafe-global`         — intentional cross-org
//
// As files are migrated, REMOVE them from this list. When the list is empty,
// the migration is done and `src/lib/db/client.ts` can be marked as internal.
//
// New code MUST NOT be added here — write it against scoped-query /
// unsafe-global from the start.
const SQL_CLIENT_ALLOWLIST = [
  // Test files: kept on the allowlist long-term. Tests legitimately seed
  // and inspect multiple orgs at once; migrating them to unsafeGlobalSql
  // would be busywork that obscures the test intent.
  "tests/**/*.test.ts",
];

const restrictedSqlImport = {
  paths: [
    {
      name: "@/lib/db/client",
      importNames: ["sql"],
      message:
        "Don't import `sql` from `@/lib/db/client` directly. Use " +
        "`getCurrentAuth().scopedSql` (or `createScopedSql(orgId)` from " +
        "`@/lib/db/scoped-query`) for org-scoped queries, or " +
        "`unsafeGlobalSql` from `@/lib/db/unsafe-global` for intentional " +
        "cross-org access (admin / system / bootstrap paths).",
    },
  ],
};

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      ".claude/**", // ephemere Agent-Worktrees (git-ignored) — enthält Build-Artefakte, kein App-Code
      "node_modules/**",
      "data/**",
      "coverage/**",
      ".github/**", // CI-only scripts (Node runtime, no app tsconfig context)
      "public/pdf.worker.min.mjs", // vendored, minified PDF.js worker
    ],
  },
  {
    rules: {
      // Allow underscore-prefixed identifiers as intentionally-unused
      // (Server Action signatures, deprecated legacy params, etc.).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // Force callers to go through getCurrentAuth().scopedSql or the
      // explicit unsafeGlobalSql escape hatch. See SQL_CLIENT_ALLOWLIST
      // above for the migration plan.
      "no-restricted-imports": ["error", restrictedSqlImport],
    },
  },
  // Migration allowlist: legacy files still importing the bare sql client.
  // Turn the rule off for them so they keep compiling until migrated.
  {
    files: SQL_CLIENT_ALLOWLIST,
    rules: { "no-restricted-imports": "off" },
  },
  // The wrapper files THEMSELVES must import sql — exempt them.
  {
    files: ["src/lib/db/scoped-query.ts", "src/lib/db/unsafe-global.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  // Accessibility rules — enforced at lint time so violations surface before CI.
  // Note: eslint-plugin-jsx-a11y is already loaded by eslint-config-next;
  // we only add rules here, no plugin re-declaration.
  {
    rules: {
      // Upgrade from warn (eslint-config-next default) to error — all known
      // violations are fixed; Image components are covered via the img alias.
      "jsx-a11y/alt-text": ["error", { elements: ["img"], img: ["Image"] }],
      // Additional rules not included in eslint-config-next:
      "jsx-a11y/img-redundant-alt": "error",
      "jsx-a11y/no-redundant-roles": "warn",
      "jsx-a11y/anchor-has-content": "warn",
      "jsx-a11y/anchor-is-valid": "warn",
    },
  },
];

export default eslintConfig;
