/**
 * Script to initialize location proxies for the crawler
 * 
 * This creates proxy entries for each location in the database
 * Run with: npm run init:proxies
 */

import { storage } from "./storage";
import type { Location, InsertLocationProxy } from "@shared/schema";

async function initializeLocationProxies() {
  try {
    console.log("Initializing location proxies...");
    
    // Get all locations
    const locations = await storage.getLocations();
    console.log(`Found ${locations.length} locations`);
    
    // For each location, check if we have proxies and create if needed
    for (const location of locations) {
      const existingProxies = await storage.getLocationProxiesByLocationId(location.id);
      
      if (existingProxies.length === 0) {
        console.log(`Creating proxies for ${location.name} (${location.code})...`);
        
        // Create multiple proxies per location for redundancy
        await createProxiesForLocation(location);
      } else {
        console.log(`${existingProxies.length} proxies already exist for ${location.name}`);
      }
    }
    
    // Display all proxies
    const allProxies = await storage.getLocationProxies();
    console.log(`\nTotal proxies in database: ${allProxies.length}`);
    
    for (const proxy of allProxies) {
      const location = await storage.getLocation(proxy.locationId);
      console.log(`- Proxy ID ${proxy.id}: ${location?.name} / ${proxy.host}:${proxy.port} (Success Rate: ${proxy.successRate}%)`);
    }
    
    console.log("\nLocation proxy initialization complete!");
  } catch (error) {
    console.error("Error initializing location proxies:", error);
  }
}

// Helper function to create proxies for a location
async function createProxiesForLocation(location: Location) {
  // Build proxy information based on location code
  const [region, country] = location.code.split(',');
  
  // Create primary proxy
  const primaryProxy: InsertLocationProxy = {
    locationId: location.id,
    host: `proxy-${country?.toLowerCase() || "global"}-${region?.toLowerCase() || "main"}.example.com`,
    port: 8080,
    isActive: true
  };
  
  const proxy1 = await storage.createLocationProxy(primaryProxy);
  console.log(`Created primary proxy: ${proxy1.host}:${proxy1.port}`);
  
  // Create backup proxy (different port)
  const backupProxy: InsertLocationProxy = {
    locationId: location.id,
    host: `proxy-backup-${country?.toLowerCase() || "global"}-${region?.toLowerCase() || "main"}.example.com`,
    port: 8080,
    isActive: true
  };
  
  const proxy2 = await storage.createLocationProxy(backupProxy);
  console.log(`Created backup proxy: ${proxy2.host}:${proxy2.port}`);
  
  // Create low-reliability proxy for testing fallback scenarios
  const lowReliabilityProxy: InsertLocationProxy = {
    locationId: location.id,
    host: `proxy-fallback-${country?.toLowerCase() || "global"}-${region?.toLowerCase() || "main"}.example.com`,
    port: 8080,
    isActive: true,
    successRate: 30, // Set low success rate to test fallback
    lastUsed: new Date()
  };
  
  const proxy3 = await storage.createLocationProxy(lowReliabilityProxy);
  console.log(`Created low-reliability proxy: ${proxy3.host}:${proxy3.port} (Success Rate: ${proxy3.successRate}%)`);
}

// Run the initialization
initializeLocationProxies()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });