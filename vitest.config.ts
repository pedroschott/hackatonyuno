import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `.claude/worktrees` holds detached checkouts of this repo. Without this
    // they are collected as if they were suites of the working tree, and a
    // stale copy fails against current source for reasons no one changed.
    exclude: ["**/node_modules/**", "**/dist/**", ".next/**", ".claude/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
