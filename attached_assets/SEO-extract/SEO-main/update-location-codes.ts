import { db } from './server/db';
import { locations } from './shared/schema';
import { eq } from 'drizzle-orm';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Map of well-known city names to their specific DataForSEO location codes
const LOCATION_CODE_MAP = {
  'San Francisco': '1014221', // San Francisco, California, United States
  'New York': '1023191',     // New York, New York, United States
  'Los Angeles': '1012873',  // Los Angeles, California, United States 
  'Houston': '1016968',      // Houston, Texas, United States
  'Chicago': '1016327',      // Chicago, Illinois, United States
  'Miami': '1019762',        // Miami, Florida, United States
};

async function updateLocationCodes() {
  console.log('Updating location codes in the database...');
  
  // Get all locations
  const allLocations = await db.select().from(locations);
  
  // For each location, check if we have a specific code
  for (const location of allLocations) {
    console.log(`Processing location: ${location.name}`);
    
    // Check if we have a predefined code for this location
    if (LOCATION_CODE_MAP[location.name]) {
      console.log(`Updating ${location.name} with DataForSEO location code: ${LOCATION_CODE_MAP[location.name]}`);
      
      // Update the location with the specific code
      await db.update(locations)
        .set({ dataForSEOLocationCode: LOCATION_CODE_MAP[location.name] })
        .where(eq(locations.id, location.id));
      
      console.log(`✅ Updated ${location.name}`);
    } else {
      console.log(`⚠️ No specific code found for ${location.name}, skipping`);
    }
  }
  
  console.log('Location code update complete!');
}

// Run the update function
updateLocationCodes()
  .then(() => {
    console.log('Location code update completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error updating location codes:', error);
    process.exit(1);
  });