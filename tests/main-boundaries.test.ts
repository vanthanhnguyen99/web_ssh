import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

describe("independent review: architecture boundaries", () => {
  const eslint = new ESLint();

  it.each([
    ["domain/nested/review.ts", "../../infrastructure/database.js"],
    ["domain/review.ts", "ssh2"],
    ["application/nested/review.ts", "../../transport/http.js"],
    ["transport/nested/review.ts", "../../infrastructure/schema.js"],
    ["transport/review.ts", "drizzle-orm/node-postgres"],
  ])("rejects %s importing %s", async (file, dependency) => {
    const [result] = await eslint.lintText(
      `import * as imported from '${dependency}'; void imported;`,
      { filePath: `apps/server/src/${file}` },
    );
    expect(
      result?.messages.some(
        (message) => message.ruleId === "no-restricted-imports",
      ),
    ).toBe(true);
  });

  it("allows domain code to consume shared contracts", async () => {
    const [result] = await eslint.lintText(
      "import type { SessionDto } from '@workspace/shared'; export type Snapshot = SessionDto;",
      { filePath: "apps/server/src/domain/review.ts" },
    );
    expect(result?.messages).toEqual([]);
  });
});
