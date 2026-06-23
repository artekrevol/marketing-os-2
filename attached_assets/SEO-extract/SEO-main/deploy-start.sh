#!/bin/bash
# Custom start script for deployment

# Exit on any error
set -e

# Set production environment
export NODE_ENV=production

# Check if we're in the root or dist directory
if [ -f "production.js" ]; then
  echo "Already in root directory, no need to change"
elif [ -d "dist" ] && [ -f "dist/production.js" ]; then
  echo "Moving to dist directory"
  cd dist
else
  echo "Could not find production.js in current directory or dist/"
  echo "Current directory: $(pwd)"
  echo "Listing files:"
  ls -la
  echo "Looking for production.js:"
  find . -name "production.js" || echo "production.js not found"
fi

# Debug information
echo "Current directory: $(pwd)"
echo "Files in current directory:"
ls -la
echo "Server directory content:"
ls -la server/

# Add permissions check and fix if needed
echo "Checking file permissions..."
if [ ! -x production.js ]; then
  echo "Adding execute permission to production.js"
  chmod +x production.js
fi

# Check server/index.js content and exports
echo "Server index.js file content (first 20 lines):"
head -n 20 server/index.js
echo "Server index.js file exports:"
grep -n "export" server/index.js || echo "No exports found in server/index.js"

# Check client directory
echo "Client directory content:"
ls -la client/ || echo "Client directory not found or empty"
echo "Looking for index.html:"
find . -name "index.html" || echo "index.html not found in build"

# Print Node.js version and ESM compatibility
echo "Node.js version and compatibility:"
node --version
echo "Testing ESM import compatibility:"
node -e "console.log('ESM import test:', import.meta.url)" || echo "ESM import not supported"

# Start with increased diagnostics
echo "Starting production server with diagnostics..."
NODE_DEBUG=module node --trace-warnings production.js