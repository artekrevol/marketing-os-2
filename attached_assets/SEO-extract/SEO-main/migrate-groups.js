/**
 * Script to migrate existing keywords to the new keyword groups structure
 * This script will:
 * 1. Create the main groups (Location Keywords, Competitor Keywords)
 * 2. Migrate existing keywords to the Location Keywords group
 */

const { db } = require('./server/db');
const { keywordGroups, keywords } = require('./shared/schema');
const { eq } = require('drizzle-orm');

async function migrateKeywordsToGroups() {
  console.log('Starting keyword group migration...');

  try {
    // Check if we already have the main groups
    const existingGroups = await db.select().from(keywordGroups);
    let locationGroupId, competitorGroupId;

    if (existingGroups.length === 0) {
      console.log('Creating main keyword groups...');
      
      // Create "Location Keywords" main group
      const [locationGroup] = await db.insert(keywordGroups)
        .values({
          name: 'Location Keywords',
          type: 'location',
          parentGroupId: null
        })
        .returning();
      
      locationGroupId = locationGroup.id;
      console.log(`Created "Location Keywords" group with ID ${locationGroupId}`);
      
      // Create "Competitor Keywords" main group
      const [competitorGroup] = await db.insert(keywordGroups)
        .values({
          name: 'Competitor Keywords',
          type: 'competitor',
          parentGroupId: null
        })
        .returning();
      
      competitorGroupId = competitorGroup.id;
      console.log(`Created "Competitor Keywords" group with ID ${competitorGroupId}`);
    } else {
      // Find existing main groups
      const locationGroup = existingGroups.find(g => g.type === 'location');
      const competitorGroup = existingGroups.find(g => g.type === 'competitor');
      
      locationGroupId = locationGroup?.id;
      competitorGroupId = competitorGroup?.id;
      
      if (!locationGroupId) {
        const [newLocationGroup] = await db.insert(keywordGroups)
          .values({
            name: 'Location Keywords',
            type: 'location',
            parentGroupId: null
          })
          .returning();
        
        locationGroupId = newLocationGroup.id;
        console.log(`Created "Location Keywords" group with ID ${locationGroupId}`);
      }
      
      if (!competitorGroupId) {
        const [newCompetitorGroup] = await db.insert(keywordGroups)
          .values({
            name: 'Competitor Keywords',
            type: 'competitor',
            parentGroupId: null
          })
          .returning();
        
        competitorGroupId = newCompetitorGroup.id;
        console.log(`Created "Competitor Keywords" group with ID ${competitorGroupId}`);
      }
    }
    
    // Migrate existing keywords to "Location Keywords" group
    const existingKeywords = await db.select().from(keywords).where(eq(keywords.groupId, null));
    
    if (existingKeywords.length > 0) {
      console.log(`Migrating ${existingKeywords.length} keywords to "Location Keywords" group...`);
      
      for (const keyword of existingKeywords) {
        await db.update(keywords)
          .set({ groupId: locationGroupId })
          .where(eq(keywords.id, keyword.id));
      }
      
      console.log('Keywords migration completed!');
    } else {
      console.log('No keywords to migrate.');
    }
    
    // Create some example subgroups if they don't exist
    const subgroups = [
      { name: 'SEO Keywords', parentGroupId: locationGroupId, type: 'location' },
      { name: 'Local Keywords', parentGroupId: locationGroupId, type: 'location' },
      { name: 'Top Competitors', parentGroupId: competitorGroupId, type: 'competitor' },
      { name: 'New Competitors', parentGroupId: competitorGroupId, type: 'competitor' }
    ];
    
    for (const subgroup of subgroups) {
      const existingSubgroup = existingGroups.find(g => 
        g.name === subgroup.name && g.parentGroupId === subgroup.parentGroupId
      );
      
      if (!existingSubgroup) {
        const [newSubgroup] = await db.insert(keywordGroups)
          .values(subgroup)
          .returning();
        
        console.log(`Created "${subgroup.name}" subgroup with ID ${newSubgroup.id}`);
      }
    }
    
    console.log('Keyword groups migration completed successfully!');
  } catch (error) {
    console.error('Error during keyword group migration:', error);
  }
}

// Execute the migration
migrateKeywordsToGroups();