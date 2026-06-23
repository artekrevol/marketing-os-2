/**
 * Script to migrate all existing keywords to the Location Keywords group
 * 
 * This script:
 * 1. Finds all keywords without a groupId
 * 2. Gets the Location Keywords group
 * 3. Updates all keywords to use the Location Keywords group ID
 * 4. Clears any legacy 'group' text values
 * 
 * Run with: node migrate-keywords-to-groups.js
 */

import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
dotenv.config();

async function migrateKeywordsToLocationGroup() {
  // Create a database client
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Connect to the database
    await client.connect();
    console.log('Connected to the database');

    // Get the Location Keywords group
    const getGroupResult = await client.query(`
      SELECT id FROM "keywordGroups" 
      WHERE name = 'Location Keywords'
      LIMIT 1
    `);

    if (getGroupResult.rows.length === 0) {
      throw new Error('Location Keywords group not found. Please run the initial migration script first.');
    }

    const locationKeywordsGroupId = getGroupResult.rows[0].id;
    console.log(`Found Location Keywords group with ID: ${locationKeywordsGroupId}`);

    // Count keywords that need migration
    const countResult = await client.query(`
      SELECT COUNT(*) FROM keywords 
      WHERE "groupId" IS NULL OR "groupId" != $1
    `, [locationKeywordsGroupId]);

    const keywordsToUpdate = parseInt(countResult.rows[0].count);
    console.log(`Found ${keywordsToUpdate} keywords to migrate`);

    if (keywordsToUpdate === 0) {
      console.log('No keywords need migration. All keywords are already assigned to the Location Keywords group.');
      return;
    }

    // Update all keywords to use the Location Keywords group
    const updateResult = await client.query(`
      UPDATE keywords 
      SET "groupId" = $1, 
          "group" = NULL 
      WHERE "groupId" IS NULL OR "groupId" != $1
    `, [locationKeywordsGroupId]);

    console.log(`Migration complete. Updated ${updateResult.rowCount} keywords.`);
    
    // Verify the migration
    const verificationResult = await client.query(`
      SELECT COUNT(*) FROM keywords 
      WHERE "groupId" != $1 OR "groupId" IS NULL
    `, [locationKeywordsGroupId]);

    const remainingKeywords = parseInt(verificationResult.rows[0].count);
    
    if (remainingKeywords === 0) {
      console.log('Verification successful. All keywords are now assigned to the Location Keywords group.');
    } else {
      console.warn(`Verification warning: ${remainingKeywords} keywords still need migration.`);
    }

  } catch (error) {
    console.error('Error during migration:', error);
  } finally {
    // Close the database connection
    await client.end();
    console.log('Database connection closed');
  }
}

// Run the migration
migrateKeywordsToLocationGroup()
  .then(() => console.log('Migration script completed'))
  .catch(err => console.error('Migration script failed:', err));