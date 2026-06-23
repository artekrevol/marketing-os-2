# Deployment Guide

## Quick Start (Development Mode)

The easiest way to run the app locally is in development mode, which includes hot-reloading for both frontend and backend.

### Prerequisites

1. **Node.js** (v18 or higher)
2. **PostgreSQL Database** (Neon, Supabase, or local PostgreSQL)
3. **DataForSEO API Credentials** (optional for testing, required for keyword crawling)

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` and add your:
- `DATABASE_URL`: PostgreSQL connection string
- `DATAFORSEO_API_LOGIN`: Your DataForSEO email/username
- `DATAFORSEO_API_PASSWORD`: Your DataForSEO API password

### Step 3: Initialize Database

The database schema will be automatically created on first run, but you can also push it manually:

```bash
npm run db:push
```

### Step 4: Start Development Server

```bash
npm run dev
```

This will:
- Start the Express backend server on port 3000
- Start the Vite dev server for the frontend
- Enable hot-reloading for both frontend and backend

The app will be available at: **http://localhost:3000**

## Production Deployment

### Step 1: Build the Application

```bash
npm run build
```

This will:
- Build the React frontend to `dist/public`
- Bundle the Express server to `dist/index.js`

### Step 2: Start Production Server

```bash
npm start
```

Or use the production script:

```bash
node production.js
```

## Environment Variables

### Required

- `DATABASE_URL`: PostgreSQL connection string
  - Format: `postgresql://user:password@host:port/database?sslmode=require`
  - Example (Neon): `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require`

### Optional (but recommended)

- `DATAFORSEO_API_LOGIN`: DataForSEO API username/email
- `DATAFORSEO_API_PASSWORD`: DataForSEO API password
- `PORT`: Server port (defaults to 3000)
- `NODE_ENV`: `development` or `production` (defaults to `development`)

## Troubleshooting

### Database Connection Issues

1. Verify your `DATABASE_URL` is correct
2. Check if your database allows connections from your IP
3. Ensure SSL is enabled if required by your provider

### DataForSEO API Issues

- The app will work without DataForSEO credentials, but keyword crawling won't function
- Sign up at https://dataforseo.com/ to get API credentials
- Add credentials to `.env` file

### Port Already in Use

If port 3000 is already in use:

```bash
PORT=8080 npm run dev
```

### Build Errors

If you encounter build errors:

1. Clear node_modules and reinstall:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

2. Clear build cache:
   ```bash
   rm -rf dist
   npm run build
   ```

## Development vs Production

### Development Mode (`npm run dev`)
- Hot-reloading enabled
- Vite dev server for frontend
- TypeScript compiled on-the-fly
- Better error messages
- Slower initial load

### Production Mode (`npm start`)
- Optimized builds
- Single server process
- Faster performance
- No hot-reloading
- Requires build step first

## Next Steps

1. Access the app at http://localhost:3000
2. Add locations in the "Manage Locations" page
3. Add keywords in the "Manage Keywords" page
4. Run a crawl to start tracking rankings
5. View results in the Dashboard

