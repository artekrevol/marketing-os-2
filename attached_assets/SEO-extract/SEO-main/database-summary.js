/**
 * Script to generate a summary of the database
 * 
 * This script:
 * 1. Shows counts of keywords, rankings, groups, and other entities
 * 2. Provides a high-level overview of the database state
 * 
 * Run with: node database-summary.js
 */

import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
dotenv.config();

async function generateDatabaseSummary() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  
  try {
    await client.connect();
    console.log('Connected to the database');
    
    // Count keywords
    const keywordsCount = await client.query(`
      SELECT COUNT(*) as count FROM keywords
    `);
    
    // Count rankings
    const rankingsCount = await client.query(`
      SELECT COUNT(*) as count FROM rankings
    `);
    
    // Count keyword groups
    const keywordGroupsCount = await client.query(`
      SELECT COUNT(*) as count FROM "keywordGroups"
    `);
    
    // Count locations
    const locationsCount = await client.query(`
      SELECT COUNT(*) as count FROM locations
    `);
    
    // Count keyword batches
    const keywordBatchesCount = await client.query(`
      SELECT COUNT(*) as count FROM "keywordBatches"
    `);
    
    // Count competitors
    const competitorsCount = await client.query(`
      SELECT COUNT(*) as count FROM competitors
    `);
    
    // Keywords per group
    const keywordsPerGroup = await client.query(`
      SELECT kg.name, COUNT(k.id) as count
      FROM "keywordGroups" kg
      LEFT JOIN keywords k ON kg.id = k."groupId"
      GROUP BY kg.name, kg.id
      ORDER BY count DESC
    `);
    
    // Keywords per location
    const keywordsPerLocation = await client.query(`
      SELECT l.name, COUNT(k.id) as count
      FROM locations l
      LEFT JOIN keywords k ON l.id = k."locationId"
      GROUP BY l.name, l.id
      ORDER BY count DESC
    `);
    
    // Output the summary
    console.log('\n======= DATABASE SUMMARY =======');
    console.log(`Total Keywords: ${keywordsCount.rows[0].count}`);
    console.log(`Total Rankings: ${rankingsCount.rows[0].count}`);
    console.log(`Total Keyword Groups: ${keywordGroupsCount.rows[0].count}`);
    console.log(`Total Locations: ${locationsCount.rows[0].count}`);
    console.log(`Total Keyword Batches: ${keywordBatchesCount.rows[0].count}`);
    console.log(`Total Competitors: ${competitorsCount.rows[0].count}`);
    
    console.log('\n--- Keywords per Group ---');
    keywordsPerGroup.rows.forEach(row => {
      console.log(`${row.name}: ${row.count} keywords`);
    });
    
    console.log('\n--- Keywords per Location ---');
    keywordsPerLocation.rows.forEach(row => {
      console.log(`${row.name}: ${row.count} keywords`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
    console.log('\nDatabase connection closed');
  }
}

generateDatabaseSummary();