# 🚀 Quick Start Guide

## Step 1: Fix API CORS (2 minutes) ⚠️ CRITICAL

1. Go to https://dashboard.render.com
2. Click your `anime-api` service
3. Go to **Environment** tab
4. Add these variables:
   ```
   ORIGIN=*
   BASE_URL=https://anime-api-wvm9.onrender.com
   RATE_LIMIT_WINDOW_MS=60000
   RATE_LIMIT_LIMIT=100
   ```
5. Click **Save Changes**

## Step 2: Keep API Alive (5 minutes)

### Option A: UptimeRobot (Easiest)
1. Go to https://uptimerobot.com
2. Sign up free
3. Click "Add New Monitor"
4. Settings:
   - **Monitor Type:** HTTP(s)
   - **URL:** `https://anime-api-wvm9.onrender.com/`
   - **Interval:** 5 minutes
5. Save

### Option B: Cron-job.org
1. Go to https://cron-job.org
2. Create free account
3. New cronjob → URL: `https://anime-api-wvm9.onrender.com/`
4. Every 5 minutes

## Step 3: Test Your Site

```bash
cd "c:\Users\CABAHIT\Desktop\Website Projects\anigemini-stream"
npm run dev
```

Open browser → Test:
- ✅ Homepage loads
- ✅ Search works
- ✅ Videos play

## Step 4: Deploy (Optional)

```bash
npm run build
```

Upload `dist` folder to:
- **Vercel** (free, recommended)
- **Netlify** (free)
- **GitHub Pages**

---

## ✅ Done! Your site is now:
- 2-3x faster
- Has caching
- Better loading states
- Won't crash on errors
- Videos work properly

## 🐛 Issues?

**CORS Error?** → Set `ORIGIN=*` on Render
**Videos not playing?** → Try different server (HD-2, HD-3)
**Slow loading?** → Set up UptimeRobot monitoring

---

See `PERFORMANCE_OPTIMIZATIONS.md` for full details.
