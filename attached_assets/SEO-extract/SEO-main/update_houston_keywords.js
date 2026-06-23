import axios from 'axios';

async function updateHoustonKeywords() {
  try {
    // Get all keywords
    const response = await axios.get('http://localhost:5000/api/keywords');
    const keywords = response.data;
    
    // Filter for Houston keywords (locationId === 1)
    const houstonKeywords = keywords.filter(keyword => keyword.locationId === 1);
    
    console.log(`Found ${houstonKeywords.length} Houston keywords to update`);
    
    // Update each keyword with the new target URL
    const updatePromises = houstonKeywords.map(async (keyword) => {
      console.log(`Updating keyword: ${keyword.keyword} (ID: ${keyword.id})`);
      
      try {
        const updateResponse = await axios.put(
          `http://localhost:5000/api/keywords/${keyword.id}`,
          {
            targetUrl: 'https://www.tekrevol.com/houston-app-development'
          }
        );
        
        console.log(`  ✓ Updated successfully`);
        return { id: keyword.id, success: true };
      } catch (error) {
        console.error(`  ✗ Error updating keyword ${keyword.id}: ${error.message}`);
        return { id: keyword.id, success: false, error: error.message };
      }
    });
    
    const results = await Promise.all(updatePromises);
    
    const successCount = results.filter(r => r.success).length;
    console.log(`\nUpdate complete: ${successCount}/${houstonKeywords.length} keywords updated successfully`);
    
  } catch (error) {
    console.error('Error fetching keywords:', error.message);
  }
}

updateHoustonKeywords();