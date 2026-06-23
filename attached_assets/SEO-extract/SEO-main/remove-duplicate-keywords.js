/**
 * Script to remove duplicate keywords from the database
 * 
 * This script:
 * 1. Identifies keywords with the same name
 * 2. Keeps the one with the lowest ID (oldest)
 * 3. Removes the duplicates
 * 
 * Run with: node remove-duplicate-keywords.js
 */

import { sql } from 'drizzle-orm';
import { db } from './server/db.js';
import * as schema from './shared/schema.js';

async function removeDuplicateKeywords() {
  try {
    console.log('Identifying duplicate keywords...');
    
    // Find duplicate keywords
    const duplicateQuery = `
      WITH keyword_counts AS (
        SELECT keyword, COUNT(*) as count
        FROM keywords
        GROUP BY keyword
        HAVING COUNT(*) > 1
      )
      SELECT k.id, k.keyword
      FROM keywords k
      JOIN keyword_counts kc ON k.keyword = kc.keyword
      ORDER BY k.keyword, k.id
    `;
    
    const duplicates = await db.execute(sql.raw(duplicateQuery));
    
    // Group duplicates by keyword
    const duplicateGroups = {};
    for (const row of duplicates) {
      const { id, keyword } = row;
      if (!duplicateGroups[keyword]) {
        duplicateGroups[keyword] = [];
      }
      duplicateGroups[keyword].push(id);
    }
    
    console.log(`Found ${Object.keys(duplicateGroups).length} keywords with duplicates`);
    
    // Process each group of duplicates
    for (const [keyword, ids] of Object.entries(duplicateGroups)) {
      // Sort IDs to keep the lowest one
      ids.sort((a, b) => a - b);
      const keepId = ids[0];
      const removeIds = ids.slice(1);
      
      console.log(`Keyword "${keyword}": keeping ID ${keepId}, removing IDs ${removeIds.join(', ')}`);
      
      // Remove duplicate keywords
      for (const id of removeIds) {
        // First remove any rankings that reference this keyword
        await db.execute(sql.raw(`DELETE FROM rankings WHERE "keywordId" = ${id}`));
        
        // Then remove any keyword batch items
        await db.execute(sql.raw(`DELETE FROM "keywordBatchItems" WHERE "keywordId" = ${id}`));
        
        // Then remove the keyword itself
        await db.execute(sql.raw(`DELETE FROM keywords WHERE id = ${id}`));
      }
    }
    
    console.log('Duplicate keywords have been removed');
    
    // Count remaining keywords
    const countQuery = 'SELECT COUNT(*) as count FROM keywords';
    const [{ count }] = await db.execute(sql.raw(countQuery));
    
    console.log(`Database now has ${count} unique keywords`);
    
  } catch (error) {
    console.error('Error removing duplicate keywords:', error.message);
  }
}

removeDuplicateKeywords()
  .then(() => console.log('Process completed'))
  .catch(err => console.error('Process failed:', err.message));