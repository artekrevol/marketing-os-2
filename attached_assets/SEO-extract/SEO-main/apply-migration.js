/**
 * Script to apply the keyword groups migration to the database
 * Run with: node apply-migration.js
 */

import 'dotenv/config';
import { runMigration } from './migrations/add-keyword-groups.js';

async function main() {
  console.log('Applying keyword groups migration...');
  
  try {
    // Execute the migration
    await runMigration();
    
    console.log('Migration applied successfully');
  } catch (error) {
    console.error('Failed to apply migration:', error);
    process.exit(1);
  }
}

main();