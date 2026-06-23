
#!/bin/bash
# Custom build script for deployment

# Ensure we're in production mode
export NODE_ENV=production

# Start with a clean build
echo "Cleaning previous build..."
rm -rf dist

# Build client files
echo "Building client..."
npx vite build --config vite.config.ts

# Build server files
echo "Building server..."
npx esbuild server/**/*.ts shared/**/*.ts --platform=node --packages=external --bundle --format=esm --outdir=dist/server --sourcemap

# Create proper structure for production
echo "Setting up production structure..."
mkdir -p dist/client

# Move client files to the right location
echo "Moving client files to the right location..."
cp -r dist/public/* dist/client/

# Ensure server files are in the right place
echo "Setting up server files..."
cp -r dist/server/* dist/
mkdir -p dist/dist/server
cp -r dist/server/* dist/dist/server/

# Copy production entry point
echo "Setting up production entry point..."
cp production.js dist/index.js

# Verify build output
echo "Verifying build output..."
ls -la dist/
ls -la dist/client/

echo "Build completed successfully!"
