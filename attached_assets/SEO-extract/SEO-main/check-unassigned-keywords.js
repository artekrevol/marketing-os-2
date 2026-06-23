/**
 * Script to check for keywords without a group assignment
 * 
 * This script:
 * 1. Identifies keywords that don't have a groupId assigned
 * 2. Shows details about these keywords
 * 
 * Run with: node check-unassigned-keywords.js
 */

import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
dotenv.config();

async function checkUnassignedKeywords() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  
  try {
    await client.connect();
    console.log('Connected to the database');
    
    // Find keywords without a group
    const result = await client.query(`
      SELECT id, keyword, "locationId", "targetUrl"
      FROM keywords
      WHERE "groupId" IS NULL
      ORDER BY id
    `);
    
    if (result.rows.length === 0) {
      console.log('All keywords are assigned to groups.');
    } else {
      console.log(`Found ${result.rows.length} keywords without group assignment:`);
      console.table(result.rows);
      
      // Check available groups
      const groups = await client.query(`
        SELECT id, name, description, "parentId"
        FROM "keywordGroups"
        ORDER BY id
      `);
      
      console.log('\nAvailable keyword groups:');
      console.table(groups.rows);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

checkUnassignedKeywords();