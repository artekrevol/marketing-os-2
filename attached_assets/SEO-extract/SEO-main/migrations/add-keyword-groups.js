/**
 * Database migration to add keyword groups functionality
 * This script will:
 * 1. Create the keywordGroups table
 * 2. Add groupId column to keywords table
 * 3. Create the initial main groups (Location Keywords and Competitor Keywords)
 * 4. Migrate existing keywords to the Location Keywords group
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Define the main groups that we want to create
const MAIN_GROUPS = {
  LOCATION_KEYWORDS: 'Location Keywords',
  COMPETITOR_KEYWORDS: 'Competitor Keywords',
};

async function runMigration() {
  console.log('Starting keyword groups migration...');
  
  // Connect to the database
  const connectionString = process.env.DATABASE_URL;
  const sql = postgres(connectionString);
  const db = drizzle(sql);
  
  try {
    // Step 1: Create the keywordGroups table
    console.log('Creating keywordGroups table...');
    await sql`
      CREATE TABLE IF NOT EXISTS "keywordGroups" (
        "id" SERIAL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "parentId" INTEGER REFERENCES "keywordGroups" ("id"),
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "updatedAt" TIMESTAMP DEFAULT NOW()
      )
    `;
    
    // Step 2: Add groupId column to keywords table if it doesn't exist
    console.log('Adding groupId column to keywords table...');
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM information_schema.columns 
                      WHERE table_name='keywords' AND column_name='groupId') THEN
          ALTER TABLE "keywords" ADD COLUMN "groupId" INTEGER REFERENCES "keywordGroups" ("id");
        END IF;
      END $$;
    `;
    
    // Step 3: Create the main groups
    console.log('Creating main keyword groups...');
    
    // First check if groups already exist
    const existingGroups = await sql`
      SELECT * FROM "keywordGroups" 
      WHERE "name" IN (${MAIN_GROUPS.LOCATION_KEYWORDS}, ${MAIN_GROUPS.COMPETITOR_KEYWORDS})
    `;
    
    let locationGroupId;
    let competitorGroupId;
    
    if (existingGroups.length === 0) {
      console.log('Main groups not found, creating them...');
      
      // Create Location Keywords group
      const locationGroup = await sql`
        INSERT INTO "keywordGroups" ("name", "description", "parentId")
        VALUES (${MAIN_GROUPS.LOCATION_KEYWORDS}, 'Keywords related to specific locations', NULL)
        RETURNING "id"
      `;
      locationGroupId = locationGroup[0].id;
      
      // Create Competitor Keywords group
      const competitorGroup = await sql`
        INSERT INTO "keywordGroups" ("name", "description", "parentId")
        VALUES (${MAIN_GROUPS.COMPETITOR_KEYWORDS}, 'Keywords related to competitors', NULL)
        RETURNING "id"
      `;
      competitorGroupId = competitorGroup[0].id;
      
      console.log(`Created groups: Location Keywords (ID: ${locationGroupId}), Competitor Keywords (ID: ${competitorGroupId})`);
    } else {
      // Use existing groups
      const locationGroup = existingGroups.find(g => g.name === MAIN_GROUPS.LOCATION_KEYWORDS);
      const competitorGroup = existingGroups.find(g => g.name === MAIN_GROUPS.COMPETITOR_KEYWORDS);
      
      locationGroupId = locationGroup ? locationGroup.id : null;
      competitorGroupId = competitorGroup ? competitorGroup.id : null;
      
      console.log(`Using existing groups: Location Keywords (ID: ${locationGroupId}), Competitor Keywords (ID: ${competitorGroupId})`);
    }
    
    // Step 4: Migrate existing keywords to Location Keywords group
    if (locationGroupId) {
      console.log('Migrating existing keywords to Location Keywords group...');
      
      // Count keywords with no groupId set
      const keywordsCount = await sql`
        SELECT COUNT(*) FROM "keywords" WHERE "groupId" IS NULL
      `;
      const count = parseInt(keywordsCount[0].count);
      
      if (count > 0) {
        // Update keywords without a groupId to the Location Keywords group
        await sql`
          UPDATE "keywords" 
          SET "groupId" = ${locationGroupId}
          WHERE "groupId" IS NULL
        `;
        console.log(`Migrated ${count} keywords to Location Keywords group`);
      } else {
        console.log('No keywords to migrate');
      }
    }
    
    console.log('Keyword groups migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    // Close database connection
    await sql.end();
  }
}

// Export the migration function
export { runMigration };

// Execute if this script is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration().catch(err => {
    console.error('Migration error:', err);
    process.exit(1);
  });
}