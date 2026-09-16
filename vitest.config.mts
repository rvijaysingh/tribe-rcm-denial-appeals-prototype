import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest ran on defaults until component logic needed testing. Components
 * import through the "@/" alias that tsconfig and Next understand, so the test
 * runner has to resolve it the same way or those modules cannot be imported.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
