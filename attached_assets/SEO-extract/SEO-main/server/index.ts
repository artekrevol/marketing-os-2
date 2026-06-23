import dotenv from "dotenv";
// Load environment variables from .env file
dotenv.config();

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { serverCache } from "./cache";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Setup express middleware for request logging
 */
function setupRequestLogging(app: express.Express) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }

        if (logLine.length > 80) {
          logLine = logLine.slice(0, 79) + "…";
        }

        log(logLine);
      }
    });

    next();
  });
}

/**
 * Create and configure the express app
 * This is used both in development and production
 */
export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  
  // Setup request logging
  setupRequestLogging(app);
  
  // Log cache statistics periodically (every 5 minutes)
  setInterval(() => {
    log(`Cache stats: ${serverCache.size()} items in cache`);
  }, 300000);
  
  return app;
}

/**
 * Setup error handling middleware
 */
export function setupErrorHandling(app: express.Express) {
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error(`API Error: ${status} - ${message}`);
    if (err.stack) {
      console.error(err.stack);
    }

    res.status(status).json({ message });
    
    // In production, don't throw the error further to avoid crashing the server
    if (process.env.NODE_ENV !== 'production') {
      throw err;
    }
  });
}

// Start the server (both development and production)
(async () => {
  const app = createApp();
  const server = await registerRoutes(app);
  
  setupErrorHandling(app);
  
  // Add request logging for debugging
  app.use((req, res, next) => {
    console.log(`[Request] ${req.method} ${req.path}`);
    next();
  });

  if (process.env.NODE_ENV !== 'production') {
    // Setup Vite in development mode
    await setupVite(app, server);
  } else {
    // In production, serve static files from dist/public (Vite build output)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    
    // Vite builds to dist/public (see vite.config.ts)
    // When running from dist/index.js, __dirname is dist/, so public is at ./public
    const clientDistPath = path.resolve(__dirname, './public');
    
    console.log('Production mode: Serving static files from', clientDistPath);
    
    // Check if directory exists
    const fs = await import('fs');
    if (!fs.existsSync(clientDistPath)) {
      console.warn(`⚠️  Warning: Client build directory not found at ${clientDistPath}`);
      console.warn('   Make sure "npm run build" completed successfully');
    } else {
      console.log(`✅ Found client build directory at ${clientDistPath}`);
    }
    
    // Serve static files from the built client
    // This must come AFTER API routes (which are registered in registerRoutes)
    app.use(express.static(clientDistPath));
    
    // Fallback to index.html for client-side routing (SPA)
    // This must be LAST, after all other routes
    app.get('*', (req, res) => {
      // Skip API routes - they should have been handled by registerRoutes
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ message: 'API endpoint not found' });
      }
      
      // Serve index.html for all non-API routes (SPA routing)
      // Use absolute path for sendFile
      const indexPath = path.resolve(clientDistPath, 'index.html');
      console.log(`[SPA Route] Serving index.html for ${req.path} from ${indexPath}`);
      res.sendFile(indexPath, (err) => {
        if (err) {
          console.error(`Error serving index.html for ${req.path}:`, err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to serve index.html', path: req.path });
          }
        }
      });
    });
  }

  // Add error handlers to prevent crashes
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error('❌ Server error:', error);
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use`);
    }
    // Don't exit - let Railway handle restarts
  });

  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    // Log but don't exit in production
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Log but don't exit in production
  });

  // Start the server
  const port = parseInt(process.env.PORT || "3000", 10);
  console.log(`Starting server on port ${port}...`);
  
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    console.log(`✅ Server started successfully on port ${port}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Listening on: 0.0.0.0:${port}`);
  });
})().catch((error) => {
  console.error('❌ Failed to start server:', error);
  console.error(error.stack);
  process.exit(1);
});

// Re-export registerRoutes for production use
export { registerRoutes };
