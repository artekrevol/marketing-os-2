import dotenv from 'dotenv';
// Load environment variables from .env file (must be first)
dotenv.config();

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@shared/schema';

// Initialize database connection
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('⚠️  WARNING: DATABASE_URL is not set. Database features will not work.');
  console.warn('   Please create a .env file with your DATABASE_URL');
  console.warn('   Example: DATABASE_URL=postgresql://user:pass@host:port/db?sslmode=require');
}

// For development, use SSL where required; Replit provides a PostgreSQL database with SSL
// Only create connection if DATABASE_URL is provided
let sql: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle> | null = null;

if (connectionString) {
  try {
    sql = postgres(connectionString, { ssl: 'require' });
    db = drizzle(sql, { schema });
  } catch (error) {
    console.error('❌ Failed to initialize database connection:', error);
    console.error('   The app will start but database features will not work.');
  }
}

// Export db with type assertion - will be null if DATABASE_URL is not set
export { db };
export type DbType = typeof db;