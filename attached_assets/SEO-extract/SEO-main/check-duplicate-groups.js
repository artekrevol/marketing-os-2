/**
 * Script to check for duplicate keyword groups in the database
 * 
 * This script:
 * 1. Identifies keyword groups with the same name
 * 2. Shows details about these duplicates
 * 
 * Run with: node check-duplicate-groups.js
 */

import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
dotenv.config();

async function checkDuplicateGroups() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  
  try {
    await client.connect();
    console.log('Connected to the database');
    
    // Find duplicate groups
    const result = await client.query(`
      SELECT name, COUNT(*) as count
      FROM "keywordGroups"
      GROUP BY name
      HAVING COUNT(*) > 1
      ORDER BY count DESC, name
    `);
    
    if (result.rows.length === 0) {
      console.log('No duplicate keyword groups found.');
    } else {
      console.log('Found duplicate keyword groups:');
      console.table(result.rows);
      
      // Get detailed info on duplicates
      for (const row of result.rows) {
        const details = await client.query(`
          SELECT id, name, description, "parentId"
          FROM "keywordGroups"
          WHERE name = $1
          ORDER BY id
        `, [row.name]);
        
        console.log(`\nDetails for duplicate group: '${row.name}'`);
        console.table(details.rows);
        
        // Count keywords in each group
        for (const group of details.rows) {
          const keywordCount = await client.query(`
            SELECT COUNT(*) as count
            FROM keywords
            WHERE "groupId" = $1
          `, [group.id]);
          
          console.log(`Group ID ${group.id} contains ${keywordCount.rows[0].count} keywords`);
        }
      }
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

checkDuplicateGroups();