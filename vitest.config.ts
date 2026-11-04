import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.tsx"],
    server: { deps: { external: [/[\\/]demo-hospital[\\/]/] } },
  },
});
