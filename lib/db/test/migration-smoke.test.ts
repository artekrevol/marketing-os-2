import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const testDir = resolve(fileURLToPath(import.meta.url), "..");
const migration = readFileSync(
  resolve(testDir, "../drizzle/0005_brand_isolation.sql"),
  "utf8",
);

describe("brand isolation migration", () => {
  it("creates legacy QA sign-off columns before same-brand constraints", () => {
    const column = migration.indexOf(
      "ALTER TABLE qa_signoffs\n  ADD COLUMN IF NOT EXISTS qa_run_id uuid;",
    );
    const sameBrand = migration.indexOf(
      "ADD CONSTRAINT qa_signoffs_run_same_brand_fk",
    );
    expect(column).toBeGreaterThanOrEqual(0);
    expect(sameBrand).toBeGreaterThan(column);
  });

  it("keeps the QA override follow-up migration additive and brand-scoped", () => {
    const followUp = readFileSync(
      resolve(testDir, "../drizzle/0006_qa_overrides_same_brand.sql"),
      "utf8",
    );
    expect(followUp).toContain("ADD COLUMN IF NOT EXISTS qa_run_id uuid");
    expect(followUp).toContain(
      "FOREIGN KEY (qa_run_id, brand_id) REFERENCES qa_runs(id, brand_id)",
    );
  });
});