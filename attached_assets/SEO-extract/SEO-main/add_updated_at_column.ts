
import { db } from "./server/db";
import { sql } from "drizzle-orm";

async function main() {
    try {
        console.log("Adding updatedAt column to keywordBatchItems table...");
        await db.execute(sql`ALTER TABLE "keywordBatchItems" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL;`);
        console.log("Successfully added updatedAt column.");
        process.exit(0);
    } catch (error) {
        console.error("Error adding column:", error);
        process.exit(1);
    }
}

main();
