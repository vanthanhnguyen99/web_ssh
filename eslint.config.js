import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";
export default ts.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["apps/server/src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "fastify",
            "socket.io",
            "ssh2",
            "drizzle-orm*",
            "ssh2/*",
            "**/infrastructure/**",
            "**/transport/**",
            "**/application/**",
          ],
        },
      ],
    },
  },
  {
    files: ["apps/server/src/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "fastify",
            "socket.io",
            "ssh2",
            "drizzle-orm*",
            "ssh2/*",
            "**/infrastructure/**",
            "**/transport/**",
          ],
        },
      ],
    },
  },
  {
    files: ["apps/server/src/transport/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: ["ssh2", "drizzle-orm*", "ssh2/*", "**/infrastructure/**"],
        },
      ],
    },
  },
);
