# DOS2 Savegame Editor

Web-basierter Editor für Divinity: Original Sin 2 Savegames. Bearbeitet **meta.lsx** und **globals.lsx** – Schwierigkeit, Charakternamen und weitere Meta-Daten.

## Features

- **LSV Upload** – Savegame hochladen, nur meta + globals werden extrahiert
- **Meta-Editor** – Schwierigkeit, Level, Save Game ID
- **Charakter-Editor** – Charakternamen der Party bearbeiten
- **LSV Download** – Bearbeitete Dateien als .lsv herunterladen

## Technologie

- **Backend:** Express, nutzt `@patimweb/dos2-savegame-tools` für LSV extract/pack
- **Frontend:** React 19, Vite, Tailwind CSS, Zustand

## Starten

```bash
# Im Editor-Verzeichnis
npm install
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3001

## Build

```bash
npm run build
npm start   # Server starten, Frontend aus dist/
```

## Hinweis

Für Produktion muss der Server die statischen Frontend-Dateien aus `dist/` ausliefern oder ein Reverse-Proxy (z.B. nginx) konfiguriert werden.
