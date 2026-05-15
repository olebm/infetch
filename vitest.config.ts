import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Vitest loads .env and .env.test by default, but NOT .env.local.
  // We explicitly load .env.local so DATABASE_URL is available for integration tests.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    test: {
      environment: "node",
      include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
      // E2E-Tests laufen mit `npx playwright test`, nicht mit Vitest
      exclude: ["tests/e2e/**"],
      setupFiles: ["tests/setup.ts"],
      env,
    },
    resolve: {
      alias: {
        "@": new URL("./src", import.meta.url).pathname,
      },
    },
  };
});
