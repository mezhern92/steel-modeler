# SteelModeler

A single-page React app (Vite) wrapping the SteelModeler component.

## Run locally
```bash
npm install
npm run dev
```
Then open the URL Vite prints (usually http://localhost:5173).

## Deploy to Vercel

### Option A — GitHub + Vercel dashboard (recommended)
1. Create a new GitHub repo and push this folder:
   ```bash
   git init
   git add .
   git commit -m "SteelModeler v0.2"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. Go to vercel.com → **Add New → Project** → **Import** the repo.
3. Vercel auto-detects **Vite**. Leave defaults:
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. Click **Deploy**. You get a live URL in ~1 minute.

### Option B — Vercel CLI (no GitHub needed)
```bash
npm i -g vercel
vercel        # first run links/creates the project, answer the prompts
vercel --prod # deploys to production
```
Accept the detected settings (Vite / `npm run build` / `dist`).

## Notes
- No environment variables required — the app is fully client-side.
- The `.s2k` / `.e2k` exports are generated in-browser and downloaded locally; nothing is sent to a server.
