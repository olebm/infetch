import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
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
    },
  },
];

export default eslintConfig;
