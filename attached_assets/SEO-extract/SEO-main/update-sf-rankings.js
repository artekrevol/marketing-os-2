/**
 * Script to update rankings for San Francisco keywords
 * This will update the existing rankings to match the verified organic positions
 * 
 * To run: node update-sf-rankings.js
 */

import axios from 'axios';
import { exec } from 'child_process';

async function updateSanFranciscoRankings() {
  try {
    console.log('Updating rankings for San Francisco keywords...');
    
    // Find the San Francisco keyword ID
    const sfKeyword = 'mobile app development company in san francisco';
    
    // Get all keywords and find our target SF keyword
    const keywordsResponse = await axios.get('http://localhost:5000/api/keywords');
    const keywords = keywordsResponse.data;
    
    const targetKeyword = keywords.find(k => 
      k.keyword.toLowerCase() === sfKeyword.toLowerCase()
    );
    
    if (!targetKeyword) {
      console.error(`Target keyword "${sfKeyword}" not found in database`);
      return;
    }
    
    console.log(`Found target keyword: "${targetKeyword.keyword}" (ID: ${targetKeyword.id})`);
    
    // Get all rankings
    const rankingsResponse = await axios.get('http://localhost:5000/api/rankings');
    const allRankings = rankingsResponse.data;
    
    // Filter to just our keyword and organic rankings
    const keywordRankings = allRankings.filter(r => 
      r.keywordId === targetKeyword.id && 
      r.resultType === 'organic'
    );
    
    console.log(`Found ${keywordRankings.length} organic rankings for ${targetKeyword.keyword}`);
    
    // Get list of tekrevol domains
    const correctDomains = [
      'tekrevol.com',
      'www.tekrevol.com'
    ];
    
    // Group by date
    const rankingsByDate = keywordRankings.reduce((acc, ranking) => {
      const dateKey = new Date(ranking.date).toISOString().split('T')[0];
      
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      
      acc[dateKey].push(ranking);
      return acc;
    }, {});
    
    // Since we can't directly update the database with HTTP API,
    // we'll output a SQL script that can be executed manually
    console.log('\nGenerated SQL for updating positions:');
    console.log('----------------------------------------');
    
    let updateCount = 0;
    
    for (const [date, rankingsForDate] of Object.entries(rankingsByDate)) {
      // Find tekrevol URLs, prioritizing the app-developers-san-francisco URL
      const targetUrl = rankingsForDate.find(r => 
        r.url && r.url.includes('app-developers-san-francisco') && 
        correctDomains.some(domain => r.url.includes(domain))
      );
      
      const anyTekrevol = rankingsForDate.find(r => 
        r.url && correctDomains.some(domain => r.url.includes(domain))
      );
      
      const rankingToUpdate = targetUrl || anyTekrevol;
      
      if (rankingToUpdate) {
        if (rankingToUpdate.position !== 7) {
          console.log(`-- Updating ranking ID ${rankingToUpdate.id} from position ${rankingToUpdate.position} to 7 (date: ${date})`);
          console.log(`UPDATE "rankings" SET "position" = 7 WHERE "id" = ${rankingToUpdate.id};`);
          updateCount++;
        } else {
          console.log(`-- Ranking ID ${rankingToUpdate.id} already has correct position 7 (date: ${date})`);
        }
      }
    }
    
    console.log('----------------------------------------');
    console.log(`Found ${updateCount} rankings that need position correction to 7.`);
    
    if (updateCount > 0) {
      console.log('\nTo execute the SQL updates, you can use the SQL tool in the Replit interface.');
    } else {
      console.log('\nNo updates needed! All rankings already have the correct position.');
    }
    
  } catch (error) {
    console.error('Error updating rankings:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
  }
}

// Run the update
updateSanFranciscoRankings();