/**
 * Script to check for duplicate keywords in the database
 * 
 * This script:
 * 1. Identifies keywords with the same name
 * 2. Shows details about these duplicates
 * 
 * Run with: node check-duplicate-keywords.js
 */

import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
dotenv.config();

async function checkDuplicateKeywords() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  
  try {
    await client.connect();
    console.log('Connected to the database');
    
    // Find duplicate keywords
    const result = await client.query(`
      SELECT keyword, COUNT(*) as count
      FROM keywords
      GROUP BY keyword
      HAVING COUNT(*) > 1
      ORDER BY count DESC, keyword
    `);
    
    if (result.rows.length === 0) {
      console.log('No duplicate keywords found.');
    } else {
      console.log('Found duplicate keywords:');
      console.table(result.rows);
      
      // Get detailed info on duplicates
      for (const row of result.rows) {
        const details = await client.query(`
          SELECT id, keyword, "locationId", "groupId"
          FROM keywords
          WHERE keyword = $1
          ORDER BY id
        `, [row.keyword]);
        
        console.log(`\nDetails for duplicate keyword: '${row.keyword}'`);
        console.table(details.rows);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

checkDuplicateKeywords();