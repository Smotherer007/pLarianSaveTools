/**
 * DOS2 Savegame Editor - Backend API
 * Extrahiert nur meta + globals, packt bearbeitete Dateien zurück
 */

import express from "express";
import cors from "cors";
import multer from "multer";
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
	readPackage,
	extractFileContent,
	LSFReader,
	convertLsfToLsx,
	packLsvFromLsx,
} from "@patimweb/dos2-savegame-tools";

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const SESSIONS_DIR = join(process.cwd(), "sessions");

app.use(cors());

// Production: statische Frontend-Dateien
const distPath = join(process.cwd(), "dist");
if (existsSync(distPath)) {
	app.use(express.static(distPath));
}
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 100 * 1024 * 1024 },
	fileFilter: (_, file, cb) => {
		if (file.originalname.toLowerCase().endsWith(".lsv")) {
			cb(null, true);
		} else {
			cb(new Error("Nur .lsv Dateien erlaubt"));
		}
	},
});

function ensureSessionsDir() {
	if (!existsSync(SESSIONS_DIR)) {
		mkdirSync(SESSIONS_DIR, { recursive: true });
	}
}

/** LSV hochladen → Session mit allen Dateien (meta.lsx, globals.lsx, levelcache/*, PNG, …) */
app.post("/api/upload", upload.single("file"), (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: "Keine Datei hochgeladen" });
		}

		ensureSessionsDir();
		const sessionId = randomUUID();
		const sessionDir = join(SESSIONS_DIR, sessionId);
		mkdirSync(sessionDir, { recursive: true });

		const tempPath = join(sessionDir, "upload.lsv");
		writeFileSync(tempPath, req.file.buffer);

		const { files: pkgFiles, data: pkgData, header: pkgHeader } = readPackage(tempPath);
		const dataOffset = pkgHeader.headerAtStart || pkgHeader.version > 10 ? 0 : pkgHeader.fileListOffset + 32;

		const lsfFiles: (typeof pkgFiles)[0][] = [];
		const otherFiles: (typeof pkgFiles)[0][] = [];
		for (const f of pkgFiles) {
			if (f.name.toLowerCase().endsWith(".lsf")) {
				lsfFiles.push(f);
			} else {
				otherFiles.push(f);
			}
		}

		if (lsfFiles.length === 0) {
			return res.status(400).json({ error: "Keine LSF-Dateien in der LSV gefunden" });
		}

		const manifestFiles: { name: string; flags: number }[] = [];

		// LSF → LSX (meta, globals, levelcache, …)
		for (const file of lsfFiles) {
			const content = extractFileContent(pkgData, file, dataOffset);
			const reader = new LSFReader(content);
			const root = reader.read();
			const lsx = convertLsfToLsx(root, reader.getEngineVersion());
			const lsxName = file.name.replace(/\.lsf$/i, ".lsx");
			const lsxPath = join(sessionDir, lsxName);
			mkdirSync(join(lsxPath, ".."), { recursive: true });
			writeFileSync(lsxPath, lsx, "utf8");
			manifestFiles.push({ name: lsxName, flags: file.flags ?? 33 });
		}

		// Andere Dateien (PNG, …) unverändert übernehmen
		for (const file of otherFiles) {
			const content = extractFileContent(pkgData, file, dataOffset);
			const outPath = join(sessionDir, file.name);
			mkdirSync(join(outPath, ".."), { recursive: true });
			writeFileSync(outPath, content);
			manifestFiles.push({ name: file.name, flags: file.flags ?? 33 });
		}

		const manifest = {
			version: pkgHeader.version,
			files: manifestFiles,
			flags: pkgHeader.flags,
			priority: pkgHeader.priority,
		};
		writeFileSync(
			join(sessionDir, "__manifest__.json"),
			JSON.stringify(manifest, null, 2),
			"utf8"
		);

		// Upload temp entfernen
		try {
			unlinkSync(tempPath);
		} catch {
			/* ignore */
		}

		res.json({
			sessionId,
			files: manifestFiles.map((f) => f.name),
		});
	} catch (err) {
		console.error("Upload error:", err);
		res.status(500).json({
			error: err instanceof Error ? err.message : "Upload fehlgeschlagen",
		});
	}
});

/** LSX-Datei lesen */
app.get("/api/session/:sessionId/file/:filename", (req, res) => {
	try {
		const { sessionId, filename } = req.params;
		if (!sessionId || !filename) {
			return res.status(400).json({ error: "sessionId und filename erforderlich" });
		}
		const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, "");
		if (safeName !== filename) {
			return res.status(400).json({ error: "Ungültiger Dateiname" });
		}
		const filePath = join(SESSIONS_DIR, sessionId, safeName);
		if (!existsSync(filePath)) {
			return res.status(404).json({ error: "Datei nicht gefunden" });
		}
		const content = readFileSync(filePath, "utf8");
		res.type("application/xml").send(content);
	} catch (err) {
		console.error("Read file error:", err);
		res.status(500).json({ error: "Lesen fehlgeschlagen" });
	}
});

/** LSX-Datei speichern */
app.put("/api/session/:sessionId/file/:filename", express.text({ type: "*/*", limit: "50mb" }), (req, res) => {
	try {
		const { sessionId, filename } = req.params;
		if (!sessionId || !filename) {
			return res.status(400).json({ error: "sessionId und filename erforderlich" });
		}
		const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, "");
		if (safeName !== filename) {
			return res.status(400).json({ error: "Ungültiger Dateiname" });
		}
		const sessionDir = join(SESSIONS_DIR, sessionId);
		if (!existsSync(sessionDir)) {
			return res.status(404).json({ error: "Session nicht gefunden" });
		}
		const filePath = join(sessionDir, safeName);
		const body = typeof req.body === "string" ? req.body : String(req.body ?? "");
		writeFileSync(filePath, body, "utf8");
		res.json({ ok: true });
	} catch (err) {
		console.error("Write file error:", err);
		res.status(500).json({ error: "Speichern fehlgeschlagen" });
	}
});

/** LSV packen und als Download bereitstellen */
app.post("/api/session/:sessionId/pack", (req, res) => {
	try {
		const { sessionId } = req.params;
		const sessionDir = join(SESSIONS_DIR, sessionId);
		if (!existsSync(sessionDir)) {
			return res.status(404).json({ error: "Session nicht gefunden" });
		}

		let version = 13;
		const manifestPath = join(sessionDir, "__manifest__.json");
		if (existsSync(manifestPath)) {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			if (typeof manifest.version === "number") version = manifest.version;
		}

		const outputPath = join(sessionDir, "output.lsv");
		packLsvFromLsx(sessionDir, outputPath, { version });

		res.json({
			downloadUrl: `/api/session/${sessionId}/download`,
		});
	} catch (err) {
		console.error("Pack error:", err);
		res.status(500).json({
			error: err instanceof Error ? err.message : "Packen fehlgeschlagen",
		});
	}
});

/** LSV-Datei herunterladen */
app.get("/api/session/:sessionId/download", (req, res) => {
	try {
		const { sessionId } = req.params;
		const outputPath = join(SESSIONS_DIR, sessionId, "output.lsv");
		if (!existsSync(outputPath)) {
			return res.status(404).json({ error: "LSV noch nicht erstellt. Zuerst Speichern." });
		}
		const buf = readFileSync(outputPath);
		res.setHeader("Content-Type", "application/octet-stream");
		res.setHeader("Content-Disposition", 'attachment; filename="savegame_edited.lsv"');
		res.send(buf);
	} catch (err) {
		console.error("Download error:", err);
		res.status(500).json({ error: "Download fehlgeschlagen" });
	}
});

// SPA fallback
app.get("*", (req, res, next) => {
	if (req.path.startsWith("/api")) return next();
	const indexPath = join(distPath, "index.html");
	if (existsSync(indexPath)) {
		res.sendFile(indexPath);
	} else {
		next();
	}
});

app.listen(PORT, () => {
	console.log(`DOS2 Savegame Editor: http://localhost:${PORT}`);
});
