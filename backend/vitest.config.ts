import { defineConfig } from "vitest/config";

// ARCHITECTURE.md §13 called for Vitest unit tests "for the things that are
// actually easy to get subtly wrong" but nothing had actually installed it
// yet before this — added here specifically for the batch-tag-and-undo
// primitive (actions/batches.ts), which is exactly that kind of logic
// (precise row-set deletion, not-found handling) and has no REST/MCP route
// to exercise it through the existing Playwright e2e harness (see
// actions/batches.test.ts's own header for why unit-level is the right
// altitude for this one). Single worker, no parallel test files: each test
// file that touches the DB sets its own isolated `DB_DIR_NAME` (see that
// file's setup) and Node caches `db/client.ts` as a singleton per process,
// so running test files in parallel processes is safe, but there's no
// upside to it yet at this suite's current size.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
