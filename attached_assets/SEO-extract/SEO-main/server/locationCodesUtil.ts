import fs from 'fs';
import path from 'path';
import { Location } from '@shared/schema';

// Define the location data structure
interface DataForSEOLocation {
  locationCode: string;
  locationName: string;
  locationCodeParent: string;
  countryIsoCode: string;
  locationType: string;
}

// Cache for location data
let locationCache: Map<string, DataForSEOLocation> | null = null;

/**
 * Load location codes from the CSV file
 */
export const loadLocationCodesFromCSV = (): Map<string, DataForSEOLocation> => {
  if (locationCache) {
    return locationCache;
  }

  const locationsMap = new Map<string, DataForSEOLocation>();
  
  try {
    // The file is in the attached_assets directory
    const csvFilePath = path.join(process.cwd(), 'attached_assets', 'locations_serp_google_2025_03_04.csv');
    
    // Read the file
    const fileContent = fs.readFileSync(csvFilePath, 'utf8');
    
    // Parse the CSV content
    const lines = fileContent.split('\n');
    const headers = lines[0].split(',');
    
    // Skip the header row
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = line.split(',');
      const location: DataForSEOLocation = {
        locationCode: values[0],
        locationName: values[1].replace(/"/g, ''),
        locationCodeParent: values[2],
        countryIsoCode: values[3],
        locationType: values[4]
      };
      
      locationsMap.set(location.locationCode, location);
    }
    
    console.log(`Loaded ${locationsMap.size} location codes from CSV file`);
    locationCache = locationsMap;
    return locationsMap;
  } catch (error) {
    console.error('Error loading location codes:', error);
    return new Map();
  }
};

/**
 * Get the DataForSEO location code for a location
 * @param location The location from our database
 * @returns The DataForSEO location code or null if not found
 */
export const getDataForSEOLocationCode = (location: Location): string | null => {
  const locationsMap = loadLocationCodesFromCSV();
  
  // Try direct mapping first (if we already have DataForSEO codes in our database)
  if (location.code.match(/^\d+$/)) {
    return location.code;
  }
  
  // Handle legacy location codes (e.g., "TX,US" format)
  if (location.code.includes(',')) {
    const [state, country] = location.code.split(',');
    
    // Search for matches in our loaded location data
    // Convert Map entries to array to avoid downlevelIteration issues
    const entries = Array.from(locationsMap.entries());
    
    // Try to match by country and state/province
    for (let i = 0; i < entries.length; i++) {
      const [code, locData] = entries[i];
      if (locData.countryIsoCode === country) {
        // Check if location name contains the state code
        if (locData.locationName.includes(state) && 
            (locData.locationType === 'State' || 
             locData.locationType === 'Province' ||
             locData.locationType === 'Region')) {
          console.log(`Found location code ${code} for ${location.name} (${location.code})`);
          return code;
        }
      }
    }
    
    // If no state match found, fall back to country-level
    for (let i = 0; i < entries.length; i++) {
      const [code, locData] = entries[i];
      if (locData.countryIsoCode === country && 
          locData.locationType === 'Country') {
        console.log(`Falling back to country code ${code} for ${location.name} (${location.code})`);
        return code;
      }
    }
  }
  
  // If no match found with legacy code, try to match by name and country/state
  const locationNameLower = location.name.toLowerCase();
  const entries = Array.from(locationsMap.entries());
  
  // First check for our special cases that need hardcoded values
  if (location.code.includes(',')) {
    const [state, country] = location.code.split(',');
    
    // Add debug information to help diagnose the issue
    console.log(`DEBUG: Location name: "${location.name}", Code: "${location.code}"`);
    console.log(`DEBUG: Parsed state: "${state}", country: "${country}"`);
    console.log(`DEBUG: Special case condition: name='San Francisco'=${location.name === 'San Francisco'}, state='CA'=${state === 'CA'}, country='US'=${country === 'US'}`);
    
    // Special case for San Francisco - check this first before other matches
    if (location.name === 'San Francisco' && state === 'CA' && country === 'US') {
      console.log('Using specific location code for San Francisco, CA: 1014221');
      return '1014221'; // Hardcoded San Francisco city code
    }
    
    // Try to find an exact city match with the correct state and country
    for (let i = 0; i < entries.length; i++) {
      const [code, locData] = entries[i];
      // Check for city match with correct country and state in locationName
      if (locData.countryIsoCode === country && 
          locData.locationType === 'City' &&
          locData.locationName.toLowerCase().includes(locationNameLower) &&
          locData.locationName.includes(state)) {
        console.log(`Found city location code ${code} for ${location.name} (${location.code})`);
        return code;
      }
    }
  }
  
  // Try just by name (less specific)
  for (let i = 0; i < entries.length; i++) {
    const [code, locData] = entries[i];
    if (locData.locationName.toLowerCase() === locationNameLower) {
      console.log(`Found location code ${code} for ${location.name} by name match`);
      return code;
    }
  }
  
  // If we can't find a match, warn and use United States as a fallback
  console.warn(`⚠️  WARNING: No location code found for "${location.name}" (code: "${location.code}"). Falling back to US (2840).`);
  console.warn(`   This may result in incorrect ranking data. Please add a mapping for this location.`);
  return "2840"; // United States
};