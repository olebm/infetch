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
      "public/pdf.worker.min.mjs", // vendored, minified PDF.js worker
    ],
  },
];

export default eslintConfig;
