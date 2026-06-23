import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Express app
const app = express();
const PORT = 3333;

// Serve static files from the current directory
app.use(express.static(__dirname));

// Serve index page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'download.html'));
});

// Direct download route for Mac users
app.get('/download', (req, res) => {
  const filePath = path.join(__dirname, 'project-export.zip');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename=project-export.zip');
  res.sendFile(filePath);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Download server running at http://0.0.0.0:${PORT}`);
  console.log(`Access the download page to get your project export`);
  console.log(`Direct download link: http://0.0.0.0:${PORT}/download`);
});