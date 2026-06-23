// Production server entry point - ES Module Version
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Set DataForSEO credentials from environment secrets
// Check for credentials in different possible environment variable names
const possibleLoginKeys = ['DATAFORSEO_LOGIN', 'DATAFORSEO_API_LOGIN', 'REPLIT_SECRETS_DATAFORSEO_LOGIN'];
const possiblePasswordKeys = ['DATAFORSEO_PASSWORD', 'DATAFORSEO_API_PASSWORD', 'REPLIT_SECRETS_DATAFORSEO_PASSWORD'];

// Try to find and set the login from available environment variables
for (const key of possibleLoginKeys) {
  if (process.env[key] && !process.env.DATAFORSEO_API_LOGIN) {
    process.env.DATAFORSEO_API_LOGIN = process.env[key];
    console.log(`Set DATAFORSEO_API_LOGIN from ${key}`);
    break;
  }
}

// Try to find and set the password from available environment variables
for (const key of possiblePasswordKeys) {
  if (process.env[key] && !process.env.DATAFORSEO_API_PASSWORD) {
    process.env.DATAFORSEO_API_PASSWORD = process.env[key];
    console.log(`Set DATAFORSEO_API_PASSWORD from ${key}`);
    break;
  }
}

// Log environment status (without exposing values)
console.log("Environment variables status:");
console.log("- DATAFORSEO_API_LOGIN:", process.env.DATAFORSEO_API_LOGIN ? "Set" : "Not set");
console.log("- DATAFORSEO_API_PASSWORD:", process.env.DATAFORSEO_API_PASSWORD ? "Set" : "Not set");

// Warn if credentials are missing
if (!process.env.DATAFORSEO_API_LOGIN || !process.env.DATAFORSEO_API_PASSWORD) {
  console.warn("WARNING: DataForSEO API credentials are missing! The keyword crawler will not work correctly.");
  console.warn("Please add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to your environment secrets.");
}

// Get the directory name from ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set production mode
process.env.NODE_ENV = 'production';

// Debug information
console.log("Current directory:", __dirname);
console.log("Files in current directory:");
try {
  const files = fs.readdirSync(__dirname);
  console.log(files);
} catch (err) {
  console.error("Error reading directory:", err);
}

// Start the server
try {
  console.log('Starting production server...');

  // Check if client directory exists and contains index.html
  const clientDir = path.join(__dirname, 'client');
  const indexPath = path.join(clientDir, 'index.html');

  if (!fs.existsSync(clientDir)) {
    console.error(`Client directory not found at ${clientDir}`);
    fs.mkdirSync(clientDir, { recursive: true });
    console.log(`Created client directory at ${clientDir}`);
  }

  if (!fs.existsSync(indexPath)) {
    console.warn(`index.html not found at ${indexPath}. Client routing may not work correctly.`);
  } else {
    console.log(`Found index.html at ${indexPath}`);
  }

  // Log the available files in client directory
  console.log('Files in client directory:');
  try {
    const clientFiles = fs.readdirSync(clientDir);
    console.log(clientFiles);
  } catch (err) {
    console.warn("No files found in client directory:", err.message);
  }

  // Import the server/index.js file with our exported functions
  console.log('Loading server module...');
  let serverModule;

  // Define the possible paths to try
  const possiblePaths = [
    './server/index.js',
    './server/index.mjs',
    './dist/server/index.js',
    './dist/server/index.mjs',
    '/app/dist/server/index.js',
    '/app/server/index.js'
  ];

  // Try each path until one works
  let importError = null;
  for (const modulePath of possiblePaths) {
    try {
      console.log(`Attempting to import from: ${modulePath}`);
      serverModule = await import(modulePath);
      console.log(`Server module loaded successfully from ${modulePath}`);

      // Verify the required exports exist
      if (serverModule.createApp && serverModule.registerRoutes && serverModule.setupErrorHandling) {
        console.log('All required exports found in module');
        break; // Success - exit the loop
      } else {
        console.warn(`Module found at ${modulePath} but missing required exports`);
        console.log('Available exports:', Object.keys(serverModule));
        // Keep trying other paths
      }
    } catch (err) {
      console.log(`Import failed for ${modulePath}: ${err.message}`);
      importError = err;
      // Continue trying other paths
    }
  }

  // If we still don't have a valid server module, throw an error
  if (!serverModule || !serverModule.createApp) {
    console.error('Could not import server module from any known path');

    // Try to manually load ESM module with dynamic require if available
    try {
      console.log('Attempting to create mock server module...');

      // Create a basic Express app as fallback
      serverModule = {
        createApp: () => {
          const app = express();
          app.use(express.json());
          console.log('Created fallback Express app');
          return app;
        },
        registerRoutes: async (app) => {
          console.log('Using fallback route registration');
          // Set up a basic health check endpoint
          app.get('/api/health', (req, res) => {
            res.json({ 
              status: 'ok', 
              mode: 'fallback',
              uptime: process.uptime(),
              timestamp: new Date().toISOString(),
              environment: process.env.NODE_ENV || 'production'
            });
          });

          // Create and return an HTTP server
          const httpServer = createServer(app);
          const PORT = process.env.PORT || 3000; //Updated Port
          httpServer.listen(PORT, '0.0.0.0');
          return httpServer;
        },
        setupErrorHandling: (app) => {
          console.log('Setting up fallback error handling');
          app.use((err, req, res, next) => {
            res.status(500).json({ error: err.message });
          });
        }
      };
      console.log('Created fallback server module');
    } catch (fallbackErr) {
      console.error('Failed to create fallback module:', fallbackErr);
      throw new Error(`Failed to import server module from any path: ${importError?.message}`);
    }
  }

  const { createApp, registerRoutes, setupErrorHandling } = serverModule;

  // Create express app using our exported function
  const app = createApp();

  // Add additional production-specific middleware

  // Serve static assets from the client directory
  console.log('Setting up static file serving from:', clientDir);
  app.use(express.static(clientDir));

  // Register the API routes
  console.log('Registering API routes...');
  const server = await registerRoutes(app);

  // Setup error handling
  setupErrorHandling(app);

  // For all other routes, serve the index.html
  app.get('*', (req, res) => {
    // Skip API routes
    if (req.url.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }

    // Serve the index.html for client-side routing
    console.log('Serving index.html for path:', req.url);
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(500).send('index.html not found. Build may be incomplete.');
    }
  });

  // If server wasn't created by registerRoutes, create it
  if (!server || !server.listening) {
    const PORT = process.env.PORT || 3000; //Updated Port
    console.log(`Server not listening yet, creating HTTP server on port ${PORT}`);
    const httpServer = createServer(app);

    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Production server running on port ${PORT}`);
      console.log(`Application URL: http://localhost:${PORT}`);
    });
  } else {
    console.log(`Server already listening on port ${server.address().port}`);
  }

  console.log('Server initialization complete');
} catch (err) {
  console.error('Failed to start server:', err);
  console.error(err.stack || err);
  // Instead of exiting, keep the process running but log the error
  console.error('Server encountered an error but will continue running');
}