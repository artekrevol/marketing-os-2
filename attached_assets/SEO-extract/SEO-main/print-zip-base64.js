import fs from 'fs';

// Check if the zip file exists
if (!fs.existsSync('project-export.zip')) {
  console.error('Error: project-export.zip not found. Please run node export-code.js first.');
  process.exit(1);
}

// Read the zip file as a buffer
const zipBuffer = fs.readFileSync('project-export.zip');

// Convert to base64
const base64Data = zipBuffer.toString('base64');

// Print instructions
console.log('---------- COPY EVERYTHING BELOW THIS LINE ----------');
console.log(base64Data);
console.log('---------- COPY EVERYTHING ABOVE THIS LINE ----------');
console.log('\nInstructions:');
console.log('1. Copy the base64 string between the marker lines');
console.log('2. On your local machine, create a file named "decode-zip.js" with the following content:');
console.log(`
const fs = require('fs');

// Paste your base64 data between the quotes below
const base64Data = '';

// Convert base64 to buffer
const zipBuffer = Buffer.from(base64Data, 'base64');

// Write to file
fs.writeFileSync('project-export.zip', zipBuffer);
console.log('Successfully created project-export.zip');
`);
console.log('3. Paste the copied base64 string between the quotes');
console.log('4. Run "node decode-zip.js" to create the zip file');
console.log('5. Extract the zip file to get your project files');