import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a file to stream archive data to
const output = fs.createWriteStream('project-export.zip');
const archive = archiver('zip', {
  zlib: { level: 9 } // Sets the compression level
});

// Listen for all archive data to be written
output.on('close', function() {
  console.log('Archive created successfully!');
  console.log('Total bytes: ' + archive.pointer());
  console.log('Project has been exported to project-export.zip');
});

// Handle warnings and errors
archive.on('warning', function(err) {
  if (err.code === 'ENOENT') {
    console.warn('Warning:', err);
  } else {
    throw err;
  }
});

archive.on('error', function(err) {
  throw err;
});

// Pipe archive data to the file
archive.pipe(output);

// Function to recursively add directories to the archive
function addDirectoryToArchive(directory, nameInArchive = '') {
  const files = fs.readdirSync(directory);
  
  for (const file of files) {
    const filePath = path.join(directory, file);
    const stats = fs.statSync(filePath);
    
    // Skip node_modules, .git directories and zip files
    if (
      file === 'node_modules' || 
      file === '.git' || 
      file.startsWith('.') || 
      file === 'project-export.zip'
    ) {
      continue;
    }
    
    if (stats.isDirectory()) {
      addDirectoryToArchive(filePath, path.join(nameInArchive, file));
    } else {
      archive.file(filePath, { name: path.join(nameInArchive, file) });
    }
  }
}

// Add all relevant files and directories to the archive
addDirectoryToArchive('.');

// Finalize the archive
archive.finalize();