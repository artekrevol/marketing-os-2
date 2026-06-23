# Quick Start Guide

## 🚀 Your App is Starting!

The development server is starting up. Once it's ready, you can access:

- **Frontend**: http://localhost:3000
- **API Health Check**: http://localhost:3000/api/health

## ⚙️ Configuration Required

### 1. Database Setup (Required for full functionality)

The app needs a PostgreSQL database. You can use:

- **Neon** (Free tier available): https://neon.tech
- **Supabase** (Free tier available): https://supabase.com
- **Local PostgreSQL**: Install PostgreSQL locally

Once you have a database, create a `.env` file in the root directory:

```bash
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require
DATAFORSEO_API_LOGIN=your_email@example.com
DATAFORSEO_API_PASSWORD=your_api_password
NODE_ENV=development
PORT=3000
```

### 2. DataForSEO API (Optional but Recommended)

For keyword ranking tracking, you'll need DataForSEO API credentials:

1. Sign up at https://dataforseo.com/
2. Get your API login and password
3. Add them to your `.env` file

**Note**: The app will work without DataForSEO credentials, but keyword crawling won't function.

## 📋 Next Steps

1. **Wait for server to start** (check terminal output)
2. **Open browser** to http://localhost:3000
3. **Configure database** in `.env` file
4. **Initialize database schema** (runs automatically on first start, or run `npm run db:push`)
5. **Add locations** in the "Manage Locations" page
6. **Add keywords** in the "Manage Keywords" page
7. **Run a crawl** to start tracking rankings

## 🛠️ Commands

- **Start dev server**: `npm run dev`
- **Build for production**: `npm run build`
- **Start production**: `npm start`
- **Push database schema**: `npm run db:push`
- **Type check**: `npm run check`

## 🐛 Troubleshooting

### Server won't start
- Check if port 3000 is available: `lsof -i :3000`
- Check Node.js version: `node --version` (needs v18+)
- Check for errors in terminal output

### Database connection errors
- Verify `DATABASE_URL` in `.env` is correct
- Check if database allows connections from your IP
- Ensure SSL is enabled if required

### Frontend not loading
- Check browser console for errors
- Verify Vite dev server is running
- Try clearing browser cache

## 📚 Documentation

- **Full Deployment Guide**: See `DEPLOYMENT.md`
- **Project Scope**: See `PROJECT_SCOPE_AND_DEBUG.md`
- **Debug Checklist**: See `DEBUG_CHECKLIST.md`

## 🎯 Features

Once configured, you can:

- ✅ Track keyword rankings across multiple locations
- ✅ Analyze competitor performance
- ✅ View ranking history and trends
- ✅ Schedule automated crawls
- ✅ Export ranking data
- ✅ Organize keywords into groups
- ✅ Customize dashboard layouts

Enjoy your SEO Rank Tracking Platform! 🎉

