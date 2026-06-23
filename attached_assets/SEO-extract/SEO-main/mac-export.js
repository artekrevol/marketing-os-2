import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

// Create the zip archive
const outputFile = fs.createWriteStream('project-export.zip');
const archive = archiver('zip', { zlib: { level: 9 } });

// Listen for archive events
outputFile.on('close', function() {
  const fileSizeInMB = (archive.pointer() / 1024 / 1024).toFixed(2);
  console.log(`✓ Archive created successfully: ${fileSizeInMB} MB`);
  console.log('✓ The project-export.zip file is ready for download');
});

archive.on('error', function(err) {
  throw err;
});

// Pipe archive data to the file
archive.pipe(outputFile);

// Function to add files and directories recursively
const addToArchive = (source, destination = '') => {
  // Check if it's a directory
  if (fs.statSync(source).isDirectory()) {
    // Get directory contents
    const files = fs.readdirSync(source);
    
    // Skip hidden files and node_modules
    files
      .filter(file => !file.startsWith('.') && 
                      file !== 'node_modules' && 
                      file !== '.git' &&
                      file !== 'project-export.zip' &&
                      file !== 'zip-chunks')
      .forEach(file => {
        const filePath = path.join(source, file);
        const destPath = path.join(destination, file);
        addToArchive(filePath, destPath);
      });
  } else {
    // It's a file, add it to the archive
    archive.file(source, { name: destination });
  }
};

// Add all project files to the archive
console.log('Creating project export...');
addToArchive('.');

// Finalize the archive
archive.finalize();