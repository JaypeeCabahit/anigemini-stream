# AniWeb Stream — AI Assistant Guide

## Project Overview
**AniWeb Stream** is a React + TypeScript anime streaming frontend. It talks to a separate Express backend called **Yorumi**.

- **Frontend repo:** `anigemini-stream` (this repo)
- **Backend repo:** `Yorumi-main/Yorumi-main/` (separate folder on disk: `C:\Users\CABAHIT\Desktop\Website Projects\Yorumi-main\Yorumi-main\`)
- **Owner/GitHub:** `JaypeeCabahit`

---

## Workflow Rules

### Always commit and deploy after changes
1. Stage only the files you changed (never `git add -A` blindly).
2. Commit with a clear message.
3. Push to `origin main`.
4. Run `vercel --prod` from the project root to deploy to production.

```bash
# From anigemini-stream/
git add <changed files>
git commit -m "description"
git push origin main
vercel --prod
```

If backend files were also changed, deploy Yorumi too:
```bash
# From Yorumi-main/Yorumi-main/
vercel --prod
```

### Never deploy the wrong project
- Frontend deploys from: `C:\Users\CABAHIT\Desktop\Website Projects\anigemini-stream`  → Vercel project: `anigemini-stream`
- Backend deploys from: `C:\Users\CABAHIT\Desktop\Website Projects\Yorumi-main\Yorumi-main` → Vercel project: `yorumi-backend`
- There is a stale Vercel project called `backend` (accidental deploy) — ignore it, never deploy to it.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v3 (PostCSS) |
| Routing | React Router v7 |
| Icons | lucide-react |
| Backend | Express (Node), deployed on Vercel as serverless functions |
| Auth | Firebase (Google login) |
| Anime data | AniList GraphQL API + Jikan REST API (MAL proxy) |
| AI chat | Google Gemini (`@google/genai`) |

---

## Tailwind Setup
Tailwind is configured via **PostCSS** (not CDN). Do NOT add the CDN script back to `index.html`.

- Config: `tailwind.config.js`
- PostCSS: `postcss.config.js`
- Entry CSS: `index.css` (imported in `index.tsx`)
- Custom brand colors are in `tailwind.config.js` under `theme.extend.colors.brand`
- Dynamic class names used in props (e.g. `color="bg-brand-600"`) must be added to the **`safelist`** in `tailwind.config.js` or Tailwind will purge them.

---

## Key Architecture Notes

### IDs: AniList ID vs MAL ID
The app stores and uses **MAL IDs** (`anime.mal_id = raw.idMal`) in URLs and watchlist. The backend `getAnimeById` tries AniList ID first, then falls back to MAL ID lookup on 404.

### Language Toggle
- Context: `TitleLangContext` (`lang: 'english' | 'romaji'`)
- `AppContent` **must stay defined at module level**, outside `AppInner`. Defining it inside `AppInner` causes full page remounts every time `lang` changes (React sees it as a new component type).
- The lang toggle should instantly swap text — no page reload.
- The season/relations dropdown must also respect the selected language.

### Season Dropdown English Titles
Jikan relations API only returns romaji titles. English titles are fetched asynchronously via AniList after the initial list loads (background enrichment). The `AnimeRelation` type has an optional `englishTitle?: string` field in `services/jikanService.ts`.

### Caching
`services/cacheService.ts` caches API responses in `localStorage` under the prefix `aniweb_cache_v2_`. The storage limit is ~5MB. On quota exceeded, it evicts expired then oldest entries before retrying. Do not change the cache prefix without also clearing old data.

---

## MAL Import
The import UI has **two modes only**: `username` and `xml`. OAuth was deliberately removed.

- **Username mode:** calls `/api/mal-list?username=...` (Vercel API function at `api/mal-list.ts`) — list must be Public on MAL.
- **XML mode:** user uploads their MAL export XML file.
- Do **not** re-add OAuth mode unless the user explicitly asks.

---

## Profile Page
- Email visibility toggle persists to `localStorage` key `profileShowEmail`.
- Stat icons use PNG files from `/public/` (`icon-spectate.png`, `icon-stats.png`, `icon-checkmark.png`).
- Tab bar uses `inline-flex` (not `flex`) so it sizes to its content, not full width.
- Active tab color: `bg-white/15` (not `bg-brand-500` — looked wrong).

---

## Environment Variables

### Frontend (`anigemini-stream/.env`)
| Variable | Purpose |
|---|---|
| `VITE_API_BASE` | Backend base URL (e.g. `https://yorumi-backend-xxx.vercel.app`) |
| `VITE_MAL_CLIENT_ID` | MAL OAuth client ID (kept for future use, not shown in UI) |
| `VITE_MAL_REDIRECT_URI` | MAL OAuth redirect (kept for future use) |
| `GEMINI_API_KEY` | Google Gemini API key |

### Backend (`Yorumi-main/Yorumi-main/.env`)
| Variable | Purpose |
|---|---|
| `MAL_CLIENT_ID` | MAL API client ID |
| `MAL_CLIENT_SECRET` | Optional — MAL PKCE works without it |

---

## People
- **JaypeeCabahit** — main developer
- **Lexus Mancera** — Web Developer & Bug Hunter, dev partner (ideas, bug finding)
