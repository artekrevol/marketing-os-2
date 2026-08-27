import { describe, expect, it, vi } from "vitest";

const BRAND_A = "brand-a";
const BRAND_B = "brand-b";

const playbookTable = {
  brandId: { name: "brand_id", table: { name: "playbook" } },
  version: { name: "version", table: { name: "playbook" } },
};
const playbookSectionsTable = {
  brandId: { name: "brand_id", table: { name: "playbook_sections" } },
  version: { name: "version", table: { name: "playbook_sections" } },
};

const playbooks = [
  { brandId: BRAND_A, version: 1, contentMarkdown: "## 1. Brand A\n\nA private rule." },
  { brandId: BRAND_A, version: 2, contentMarkdown: "## 1. Brand A\n\nA newer private rule." },
  { brandId: BRAND_B, version: 1, contentMarkdown: "## 1. Brand B\n\nB private rule." },
];
const sections = [
  {
    brandId: BRAND_A,
    version: 2,
    sectionNumber: 1,
    sectionTitle: "Brand A",
    sectionContent: "A newer private rule.",
    sectionTokenEstimate: 5,
    alwaysInclude: true,
  },
  {
    brandId: BRAND_B,
    version: 1,
    sectionNumber: 1,
    sectionTitle: "Brand B",
    sectionContent: "B private rule.",
    sectionTokenEstimate: 4,
    alwaysInclude: true,
  },
];

function conditionValues(condition: unknown): Array<string | number> {
  if (!condition || typeof condition !== "object") return [];
  const chunks = (condition as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return [];
  return chunks.flatMap((chunk) => {
    if (typeof chunk === "string" || typeof chunk === "number") return [chunk];
    return conditionValues(chunk);
  });
}

vi.mock("@workspace/db", () => ({
  playbookTable,
  playbookSectionsTable,
  db: {
    select: vi.fn(() => {
      const query: { table?: unknown; where?: unknown } = {};
      const builder = {
        from(table: unknown) {
          query.table = table;
          return builder;
        },
        where(condition: unknown) {
          query.where = condition;
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit() {
          return Promise.resolve(resolveRows());
        },
        then(onfulfilled: (value: unknown[]) => unknown, onrejected?: (reason: unknown) => unknown) {
          return Promise.resolve(resolveRows()).then(onfulfilled, onrejected);
        },
      };
      function resolveRows() {
          const values = conditionValues(query.where);
          const brandId = values.find((value) => value === BRAND_A || value === BRAND_B);
          const selectedVersion = values.find((value): value is number => typeof value === "number");
          const source = query.table === playbookTable ? playbooks : sections;
          return Promise.resolve(
            source
              .filter((row) => (!brandId || row.brandId === brandId) && (selectedVersion == null || row.version === selectedVersion))
              .sort((a, b) => b.version - a.version),
          );
      }
      return builder;
    }),
  },
}));

const {
  buildCachedSystem,
  getActivePlaybook,
  getBannedPhrases,
  getRoutedPlaybook,
} = await import("../src/playbook.js");

describe("brand-scoped playbooks", () => {
  it("selects the latest version independently for each brand", async () => {
    await expect(getActivePlaybook(BRAND_A)).resolves.toMatchObject({
      content: "## 1. Brand A\n\nA newer private rule.",
      version: 2,
    });
    await expect(getActivePlaybook(BRAND_B)).resolves.toMatchObject({
      content: "## 1. Brand B\n\nB private rule.",
      version: 1,
    });
    await expect(getActivePlaybook(BRAND_A, 99)).rejects.toThrow("not available for brand brand-a");
  });

  it("routes sections and derived rules only from the requested brand", async () => {
    const routed = await getRoutedPlaybook("draft", BRAND_B);
    expect(routed.content).toContain("B private rule.");
    expect(routed.content).not.toContain("Brand A");
    await expect(getBannedPhrases(BRAND_A)).resolves.toEqual([]);
  });

  it("puts brand and playbook version into the cached prompt identity", () => {
    const [cached] = buildCachedSystem("private rules", 7, "instructions", "draft", BRAND_A);
    expect(cached?.text).toContain(`BRAND_ID: ${BRAND_A}`);
    expect(cached?.text).toContain("PLAYBOOK_VERSION: 7");
  });
});