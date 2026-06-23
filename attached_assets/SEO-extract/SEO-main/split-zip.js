import fs from 'fs';
import path from 'path';

// Check if the zip file exists
if (!fs.existsSync('project-export.zip')) {
  console.error('Error: project-export.zip not found. Please run node export-code.js first.');
  process.exit(1);
}

// Read the zip file as a buffer
const zipBuffer = fs.readFileSync('project-export.zip');
const fileSize = zipBuffer.length;

// Define chunk size (1MB)
const chunkSize = 1024 * 1024;
const chunksDir = 'zip-chunks';

// Create chunks directory if it doesn't exist
if (!fs.existsSync(chunksDir)) {
  fs.mkdirSync(chunksDir);
}

// Split into chunks
const chunks = Math.ceil(fileSize / chunkSize);
console.log(`Splitting ${fileSize} bytes into ${chunks} chunks...`);

for (let i = 0; i < chunks; i++) {
  const start = i * chunkSize;
  const end = Math.min(start + chunkSize, fileSize);
  const chunk = zipBuffer.slice(start, end);
  
  // Write chunk to file
  const chunkPath = path.join(chunksDir, `chunk-${i.toString().padStart(3, '0')}.bin`);
  fs.writeFileSync(chunkPath, chunk);
  console.log(`Created ${chunkPath} (${chunk.length} bytes)`);
}

// Create a README file with instructions
const readme = `# Project Export Instructions

This directory contains chunks of the project export zip file.

## Combining the chunks

### On Linux/Mac:
\`\`\`bash
cat chunk-*.bin > project-export.zip
\`\`\`

### On Windows (PowerShell):
\`\`\`powershell
Get-ChildItem -Path "chunk-*.bin" | Sort-Object Name | Get-Content -Encoding Byte -ReadCount 0 | Set-Content -Encoding Byte -Path "project-export.zip"
\`\`\`

### On Windows (Command Prompt):
\`\`\`cmd
copy /b chunk-*.bin project-export.zip
\`\`\`

After combining, extract the zip file to get your project files.
`;

fs.writeFileSync(path.join(chunksDir, 'README.md'), readme);
console.log(`\nCreated ${chunksDir}/README.md with instructions`);
console.log(`\nProcess complete! Download all files from the '${chunksDir}' directory.`);