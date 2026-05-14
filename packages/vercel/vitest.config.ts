import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@dualmark/vercel",
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: false,
  },
});
