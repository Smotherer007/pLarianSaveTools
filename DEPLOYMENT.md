# DOS2 Savegame Editor – Deployment

Der Web-Editor besteht aus einem **React-Frontend** und einem **Express-Backend** (LSV-Upload, LSF-Konvertierung). Beide müssen gemeinsam gehostet werden – reines GitHub Pages reicht nicht.

## Option 1: Render.com (empfohlen)

1. [Render.com](https://render.com) → **New** → **Blueprint**
2. GitHub-Repo verbinden
3. `render.yaml` wird automatisch erkannt
4. **Create** – Render baut und deployed

Die App läuft unter `https://dos2-savegame-editor.onrender.com` (oder dein gewählter Name).

**Hinweis:** Free Tier schläft nach Inaktivität ein; der erste Request kann 30–60 Sekunden dauern.

## Option 2: Railway

1. [Railway](https://railway.app) → **New Project** → **Deploy from GitHub**
2. Repo auswählen
3. **Build Command:** `npm ci && npm run build && npm run editor:build`
4. **Start Command:** `npm run editor:start`
5. **Root Directory:** `/` (Standard)

## Option 3: Lokal / eigener Server

```bash
npm ci
npm run build
npm run editor:build
npm run editor:start
```

Die App läuft auf `http://localhost:3001` (oder `PORT`-Umgebungsvariable).

## GitHub Actions (CI)

Der Workflow `.github/workflows/editor.yml` baut den Editor bei jedem Push auf `main`/`next` und bei Pull Requests. So siehst du, ob der Build funktioniert.

## Technische Details

- **Node.js** LTS (18+)
- Native Module: `lz4-napi`, `zstd-napi`, `fzstd` – werden beim Build für die Zielplattform kompiliert
- Backend-Port: `PORT` (Standard: 3001)
