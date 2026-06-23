#!/bin/bash
# Development server startup script

echo "🚀 Starting SEO Rank Tracking Platform..."
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found!"
    echo ""
    echo "Creating .env file template..."
    cat > .env << EOF
# Database Configuration
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require

# DataForSEO API Credentials (optional for testing)
DATAFORSEO_API_LOGIN=your_email@example.com
DATAFORSEO_API_PASSWORD=your_api_password

# Environment
NODE_ENV=development

# Server Port
PORT=3000
EOF
    echo "✅ Created .env file template"
    echo ""
    echo "⚠️  IMPORTANT: Please edit .env and add your DATABASE_URL!"
    echo "   The app requires a PostgreSQL database to run."
    echo ""
    read -p "Press Enter to continue (the app may not work without a database)..."
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Check if DATABASE_URL is set
if grep -q "DATABASE_URL=postgresql://user:password" .env 2>/dev/null; then
    echo "⚠️  Warning: DATABASE_URL appears to be a template value!"
    echo "   Please update .env with your actual database connection string."
    echo ""
fi

echo "🔧 Starting development server..."
echo "   Frontend will be available at: http://localhost:3000"
echo "   API will be available at: http://localhost:3000/api"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start the development server
npm run dev

