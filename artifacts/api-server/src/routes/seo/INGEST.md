# Ahrefs XLSX Ingest — Reference

**File:** `ahrefs-upload.ts`  
**Endpoint:** `POST /api/seo/ahrefs/upload` (multipart/form-data)

---

## File → Table Mapping

| Ahrefs export filename (contains) | Detected type | Target table(s) | Notes |
|---|---|---|---|
| `Backlinks` | `backlinks` | `ahrefs_backlinks` | `is_lost=false` for active links |
| `BrokenBacklinks` | `broken_backlinks` | `ahrefs_backlinks` | `is_lost=true`; populates `target_http_code` |
| `ReferringDomains` | `referring_domains` | `referring_domains` | `traffic_domain` is **bigint** — top domains exceed 2.1B |
| `Anchors` | `anchors` | `ahrefs_anchors` | Keyed on `(brand_id, anchor_text)` |
| `TopPages` | `top_pages` | `ahrefs_page_performance` | Traffic-change crash detection source |
| `OrganicKeywords` | `organic_keywords` | `keywords` (UPDATE only) | Enriches existing keyword rows; rows without a match are silently skipped |
| `ContentGap` | `content_gap` | `ahrefs_content_gap` | One row per keyword × competitor combination |
| `BestByLinks` | `best_by_links` | `ahrefs_best_by_links` | Top pages ranked by referring-domain count |

---

## Intentionally Skipped Files

These file types are detected (so they don't throw an "unrecognised file" error) but
**no rows are ingested** and no table exists for them yet.

| Ahrefs export filename (contains) | Detected type | Why skipped |
|---|---|---|
| `LinkingAuthors` | `linking_authors` | Reserved for **author-based outreach discovery** — knowing which authors wrote the content that links to us. No current dashboard feature consumes this data. |
| `ReferringIPs` | `referring_ips` | Reserved for **bot/link-farm detection** — identifying clusters of backlinks originating from the same IP range. No current dashboard feature consumes this data. |

---

## Filename Detection Convention

`detectFileType(filename)` lowercases the filename and checks for substrings in
priority order:

1. `brokenbacklinks` → `broken_backlinks` (checked before `backlinks` to avoid false match)
2. `referringdomains` → `referring_domains`
3. `anchors` → `anchors`
4. `backlinks` → `backlinks`
5. `organickeywords` → `organic_keywords`
6. `toppages` → `top_pages`
7. `bestbylinks` → `best_by_links`
8. `contentgap` → `content_gap`
9. `linkingauthors` → `linking_authors` *(skipped — see above)*
10. `referringips` → `referring_ips` *(skipped — see above)*

Files that match nothing return `null` and are skipped with no error.

---

## Known Column Quirks (real-export gotchas)

| Column | Quirk |
|---|---|
| `Traffic ` (ReferringDomains) | Has a **trailing space** in the header. Code reads `row["Traffic "] ?? row["Traffic"]` to handle both. |
| `Lost` (Backlinks, ReferringDomains) | Contains a **date string** when lost, `null` when active — not a boolean. Test `row["Lost"] != null`. Store the date in `lost_at`. |
| `domain_traffic`, `page_traffic` (Backlinks) | **bigint** — Wikipedia traffic is 4,062,811,136. |
| `traffic_domain` (ReferringDomains) | **bigint** — same overflow risk. |
| `Intents` (ContentGap) | CSV-quoted values like `"Informational","Commercial"`. Split by comma first, then strip quotes per element. Store as PostgreSQL array literal `{val1,val2}::text[]`. |
| `target_http_code` (BrokenBacklinks) | Column `Target page HTTP code`. Stored on `ahrefs_backlinks` so broken-link queries need no join. |

---

## How to Add a New File Type

1. **Add a detection branch** in `detectFileType()`:
   ```ts
   if (n.includes("mynewexport")) return "my_new_type";
   ```

2. **Add required headers** to `REQUIRED_HEADERS` (validated before any DB write):
   ```ts
   my_new_type: ["Column A", "Column B"],
   ```

3. **Add a count field** to the `counts` object in the upload handler and to the response `imported` block.

4. **Write an ingest function** following the pattern of `ingestReferringDomains` or `ingestBestByLinks`:
   - Accept `(brandId, rows, dbExec)`
   - Upsert row-by-row using `ON CONFLICT … DO UPDATE`
   - Return the row count

5. **Add a case** to the `if/else` switch in the upload handler:
   ```ts
   } else if (fileType === "my_new_type") {
     counts.myNewType += await ingestMyNewType(guard.brandId, rows, exec);
   }
   ```

6. **Create or extend a migration** in `lib/db/drizzle/` and add a journal entry in `meta/_journal.json`.

7. **Update this file** (`INGEST.md`) with the new row in the table above.
