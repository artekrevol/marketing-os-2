// Debug script for location code detection
import { loadLocationCodesFromCSV, getDataForSEOLocationCode } from './server/locationCodesUtil.ts';

// Create a mock location that matches our San Francisco database entry
const mockSFLocation = {
  id: 6,
  name: 'San Francisco',
  code: 'CA,US',
  createdAt: new Date()
};

// Test the function directly
console.log('\nTesting getDataForSEOLocationCode function with San Francisco location:');
console.log('Input location:', mockSFLocation);
const locationCode = getDataForSEOLocationCode(mockSFLocation);
console.log('Output location code:', locationCode);

// Check if the special case is triggering
console.log('\nDebugging special case conditions:');
const locationNameLower = mockSFLocation.name.toLowerCase();
console.log('locationNameLower === "san francisco":', locationNameLower === 'san francisco');
console.log('location.name === "San Francisco":', mockSFLocation.name === 'San Francisco');

if (mockSFLocation.code.includes(',')) {
  const [state, country] = mockSFLocation.code.split(',');
  console.log('state:', state);
  console.log('country:', country);
  console.log('state === "CA":', state === 'CA');
  console.log('country === "US":', country === 'US');
  
  console.log('\nFull condition evaluation:');
  const conditionPart1 = (locationNameLower === 'san francisco' || mockSFLocation.name === 'San Francisco');
  const conditionPart2 = (state === 'CA' && country === 'US');
  console.log('(locationNameLower === "san francisco" || location.name === "San Francisco"):', conditionPart1);
  console.log('(state === "CA" && country === "US"):', conditionPart2);
  console.log('Full condition:', conditionPart1 && conditionPart2);
}

// Load location codes
console.log('\nLoading location codes from CSV...');
const locationsMap = loadLocationCodesFromCSV();
console.log('Loaded', locationsMap.size, 'location codes');

// Search for San Francisco locations
console.log('\nSearching for San Francisco locations in CSV data:');
const entries = Array.from(locationsMap.entries());
let sfLocationsFound = 0;

for (let i = 0; i < entries.length; i++) {
  const [code, locData] = entries[i];
  if (locData.locationName.toLowerCase().includes('san francisco')) {
    console.log(`Found: [${code}] ${locData.locationName} (${locData.locationType}) - Country: ${locData.countryIsoCode}`);
    sfLocationsFound++;
  }
}

console.log(`\nFound ${sfLocationsFound} San Francisco related locations`);