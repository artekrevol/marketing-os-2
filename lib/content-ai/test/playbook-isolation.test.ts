/**
 * Real-Postgres tenancy tests for playbooks.
 *
 * These tests intentionally use the same createPlaybookVersion transaction
 * used by the upload route. They are skipped when a database is not
 * configured, matching the other live database tests in this repository.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const HAS_DATABASE_URL = Boolean(process.env.DATABASE_URL);
const liveDescribe = HAS_DATABASE_URL ? describe : describe.skip;

const dbModule = HAS_DATABASE_URL ? await import("@workspace/db") : undefined;
const playbookModule = HAS_DATABASE_URL ? await import("../src/playbook.js") : undefined;

const db = dbModule?.db;
const { brandsTable, playbookTable, playbookSectionsTable } = dbModule ?? {};
const {
  createPlaybookVersion,
  buildCachedSystem,
  getActivePlaybook,
  getPlaybookSections,
  getRoutedPlaybook,
} = playbookModule ?? {};

const slugPrefix = `playbook-isolation-${randomUUID()}`;
let brandAId: string | undefined;
let brandBId: string | undefined;
let schemaReady = false;

const BRAND_A_V1 = `## 1. A v1 core

Brand A version one private instruction.

## 2. A v1 drafting

Brand A version one drafting instruction.`;
const BRAND_A_V2 = `## 3. A v2 proof

Brand A version two proof instruction.

## 1. A v2 core

Brand A version two private instruction.

## 2. A v2 drafting

Brand A version two drafting instruction.`;
const BRAND_B_V1 = `## 3. B v1 proof

Brand B version one proof instruction.

## 1. B v1 core

Brand B version one private instruction.

## 2. B v1 drafting

Brand B version one drafting instruction.`;

const BRAND_A_CONCURRENT = (index: number) => `## 1. A concurrent ${index}

Brand A concurrent instruction ${index}.`;
const BRAND_B_CONCURRENT = (index: number) => `## 1. B concurrent ${index}

Brand B concurrent instruction ${index}.`;

liveDescribe("brand-scoped playbooks (real database)", () => {
  beforeAll(async () => {
    if (!db || !brandsTable || !playbookTable || !playbookSectionsTable || !createPlaybookVersion) {
      return;
    }

    try {
      await db.select({ id: brandsTable.id }).from(brandsTable).limit(1);
    } catch {
      console.warn("[playbook-isolation.test] playbook schema unavailable — live tests skipped");
      return;
    }

    const [brandA, brandB] = await db
      .insert(brandsTable)
      .values([
        { slug: `${slugPrefix}-a`, name: "Playbook Isolation A" },
        { slug: `${slugPrefix}-b`, name: "Playbook Isolation B" },
      ])
      .returning({ id: brandsTable.id });
    brandAId = brandA?.id;
    brandBId = brandB?.id;
    if (!brandAId || !brandBId) throw new Error("failed to create isolation test brands");

    // The brands deliberately have different latest versions: A has v2,
    // while B remains on v1. Their section headers are inserted out of order
    // in the markdown and must be returned in numeric order from the DB.
    await createPlaybookVersion({ brandId: brandAId, markdown: BRAND_A_V1 });
    await createPlaybookVersion({ brandId: brandAId, markdown: BRAND_A_V2 });
    await createPlaybookVersion({ brandId: brandBId, markdown: BRAND_B_V1 });
    schemaReady = true;
  });

  afterAll(async () => {
    if (!db || !brandsTable || !playbookTable || !playbookSectionsTable || !brandAId || !brandBId) return;
    const brandIds = [brandAId, brandBId];
    // Delete explicitly because older live schemas may not have the
    // on-delete cascade declared by the current Drizzle schema.
    await db.delete(playbookSectionsTable).where(inArray(playbookSectionsTable.brandId, brandIds));
    await db.delete(playbookTable).where(inArray(playbookTable.brandId, brandIds));
    await db.delete(brandsTable).where(inArray(brandsTable.id, [brandAId, brandBId]));
  });

  it("reads latest and explicitly pinned content only for the requested brand", async () => {
    if (!schemaReady || !brandAId || !brandBId || !buildCachedSystem || !getActivePlaybook || !getPlaybookSections || !getRoutedPlaybook) return;

    await expect(getActivePlaybook(brandAId)).resolves.toMatchObject({
      version: 2,
      content: BRAND_A_V2,
    });
    await expect(getActivePlaybook(brandBId)).resolves.toMatchObject({
      version: 1,
      content: BRAND_B_V1,
    });

    const [aPinned, bPinned] = await Promise.all([
      getActivePlaybook(brandAId, 1),
      getActivePlaybook(brandBId, 1),
    ]);
    expect(aPinned).toMatchObject({ version: 1, content: BRAND_A_V1 });
    expect(bPinned).toMatchObject({ version: 1, content: BRAND_B_V1 });
    expect(aPinned.content).not.toContain("Brand B");
    expect(bPinned.content).not.toContain("Brand A");

    const aSections = await getPlaybookSections(brandAId);
    const bSections = await getPlaybookSections(brandBId);
    expect(aSections.version).toBe(2);
    expect(aSections.sections.map((section) => section.section_number)).toEqual([1, 2, 3]);
    expect(aSections.sections.every((section) => section.section_content.includes("Brand A"))).toBe(true);
    expect(bSections.version).toBe(1);
    expect(bSections.sections.map((section) => section.section_number)).toEqual([1, 2, 3]);
    expect(bSections.sections.every((section) => section.section_content.includes("Brand B"))).toBe(true);

    const routedA = await getRoutedPlaybook("draft", brandAId);
    const routedB = await getRoutedPlaybook("draft", brandBId);
    expect(routedA).toMatchObject({ version: 2, included: [1, 2, 3] });
    expect(routedA.content).toContain("Brand A version two private instruction.");
    expect(routedA.content).not.toContain("Brand B");
    expect(routedB).toMatchObject({ version: 1, included: [1, 2, 3] });
    expect(routedB.content).toContain("Brand B version one private instruction.");
    expect(routedB.content).not.toContain("Brand A");

    const [cached] = buildCachedSystem("private rules", 7, "instructions", "draft", brandAId);
    expect(cached?.text).toContain(`BRAND_ID: ${brandAId}`);
    expect(cached?.text).toContain("PLAYBOOK_VERSION: 7");
  });

  it("fails closed when a pinned version is missing", async () => {
    if (!schemaReady || !brandAId || !getActivePlaybook || !getPlaybookSections || !getRoutedPlaybook) return;

    await expect(getActivePlaybook(brandAId, 999_999)).rejects.toThrow(
      `playbook version 999999 is not available for brand ${brandAId}`,
    );
    await expect(getPlaybookSections(brandAId, 999_999)).resolves.toMatchObject({
      version: null,
      sections: [],
    });
    await expect(getRoutedPlaybook("draft", brandAId, 999_999)).rejects.toThrow(
      `playbook version 999999 is not available for brand ${brandAId}`,
    );
  });

  it("serializes concurrent version allocation per brand without cross-brand sections", async () => {
    if (!schemaReady || !brandAId || !brandBId || !db || !playbookTable || !playbookSectionsTable || !createPlaybookVersion) return;

    const [aUpload1, aUpload2, bUpload1, bUpload2] = await Promise.all([
      createPlaybookVersion({ brandId: brandAId, markdown: BRAND_A_CONCURRENT(1) }),
      createPlaybookVersion({ brandId: brandAId, markdown: BRAND_A_CONCURRENT(2) }),
      createPlaybookVersion({ brandId: brandBId, markdown: BRAND_B_CONCURRENT(1) }),
      createPlaybookVersion({ brandId: brandBId, markdown: BRAND_B_CONCURRENT(2) }),
    ]);

    const aVersions = [aUpload1.playbookRow.version, aUpload2.playbookRow.version].sort((a, b) => a - b);
    const bVersions = [bUpload1.playbookRow.version, bUpload2.playbookRow.version].sort((a, b) => a - b);
    expect(aVersions).toEqual([3, 4]);
    expect(bVersions).toEqual([2, 3]);
    expect(new Set(aVersions).size).toBe(2);
    expect(new Set(bVersions).size).toBe(2);

    const rows = await db
      .select({
        brandId: playbookTable.brandId,
        version: playbookTable.version,
        contentMarkdown: playbookTable.contentMarkdown,
      })
      .from(playbookTable)
      .where(inArray(playbookTable.brandId, [brandAId, brandBId]))
      .orderBy(playbookTable.brandId, desc(playbookTable.version));
    expect(rows.filter((row) => row.brandId === brandAId).map((row) => row.version)).toEqual([4, 3, 2, 1]);
    expect(rows.filter((row) => row.brandId === brandBId).map((row) => row.version)).toEqual([3, 2, 1]);
    expect(new Set(rows.map((row) => `${row.brandId}:${row.version}`)).size).toBe(rows.length);

    const sectionRows = await db
      .select({
        brandId: playbookSectionsTable.brandId,
        version: playbookSectionsTable.version,
        sectionContent: playbookSectionsTable.sectionContent,
      })
      .from(playbookSectionsTable)
      .where(inArray(playbookSectionsTable.brandId, [brandAId, brandBId]));
    for (const row of sectionRows) {
      expect(row.sectionContent).toContain(row.brandId === brandAId ? "Brand A" : "Brand B");
      expect(row.sectionContent).not.toContain(row.brandId === brandAId ? "Brand B" : "Brand A");
    }

    // Explicitly exercise the same predicates used by the readers after the
    // concurrent writes: a brand/version pair can never expose another brand.
    const aVersion3 = await db
      .select({ contentMarkdown: playbookTable.contentMarkdown })
      .from(playbookTable)
      .where(and(eq(playbookTable.brandId, brandAId), eq(playbookTable.version, 3)))
      .limit(1);
    expect(aVersion3[0]?.contentMarkdown).toContain("Brand A concurrent");
  });
});