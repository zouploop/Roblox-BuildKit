import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The bridge tests bind real ports; running files in parallel would race for them
    // and for the shared-bridge owner/client handoff.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
