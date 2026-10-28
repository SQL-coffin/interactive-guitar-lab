import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "music-theory",
          include: ["packages/**/*.test.ts"],
          environment: "node",
          clearMocks: true,
        },
      },
      "apps/web/vitest.config.ts",
    ],
  },
});
