import { defineConfig } from "vitest/config";
import SpecReporter from "./test/spec-reporter.ts";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.tsx"],
    server: { deps: { external: [/[\\/]demo-hospital[\\/]/] } },
    includeTaskLocation: true,
    reporters: ["default", new SpecReporter({ outputFile: "report/junit.xml" })],
  },
});
