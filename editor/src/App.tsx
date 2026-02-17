import { useState, useCallback } from "react";
import { Save, Download, Users, Settings } from "lucide-react";
import { useEditorStore } from "./store";
import { UploadZone } from "./components/UploadZone";
import { MetaEditor } from "./components/MetaEditor";
import { CharacterEditor } from "./components/CharacterEditor";
import { clsx } from "clsx";
import { applyMetaChanges } from "./lib/lsx-parser";
import { patchCharacterInXml } from "./lib/globals-parser";

type Tab = "meta" | "characters";

function App() {
	const { sessionId, metaData, globalsXml, charactersData, setMetaData } = useEditorStore();
	const [activeTab, setActiveTab] = useState<Tab>("meta");
	const [saving, setSaving] = useState(false);
	const [packing, setPacking] = useState(false);

	const handleSave = useCallback(async () => {
		if (!sessionId) return;
		setSaving(true);
		try {
			const { metaXml } = useEditorStore.getState();
			if (metaXml && metaData) {
				const updatedMeta = applyMetaChanges(metaXml, metaData);
				const metaRes = await fetch(`/api/session/${sessionId}/file/meta.lsx`, {
					method: "PUT",
					headers: { "Content-Type": "text/xml" },
					body: updatedMeta,
				});
				if (!metaRes.ok) throw new Error("Meta speichern fehlgeschlagen");
			}
			// Globals mit Charakter-Änderungen speichern
			if (globalsXml && charactersData.length > 0) {
				let updatedGlobals = globalsXml;
				charactersData.forEach((char) => {
					updatedGlobals = patchCharacterInXml(updatedGlobals, char.globalsIndex, char);
				});
				const globalsRes = await fetch(`/api/session/${sessionId}/file/globals.lsx`, {
					method: "PUT",
					headers: { "Content-Type": "text/xml" },
					body: updatedGlobals,
				});
				if (!globalsRes.ok) throw new Error("Globals speichern fehlgeschlagen");
			}
		} finally {
			setSaving(false);
		}
	}, [sessionId, metaData, globalsXml, charactersData]);

	const handlePackAndDownload = useCallback(async () => {
		if (!sessionId) return;
		setPacking(true);
		try {
			await handleSave();
			const packRes = await fetch(`/api/session/${sessionId}/pack`, { method: "POST" });
			if (!packRes.ok) {
				const err = await packRes.json();
				throw new Error(err.error || "Packen fehlgeschlagen");
			}
			const { downloadUrl } = await packRes.json();
			window.open(downloadUrl, "_blank");
		} catch (e) {
			alert(e instanceof Error ? e.message : "Fehler beim Erstellen der LSV");
		} finally {
			setPacking(false);
		}
	}, [sessionId, handleSave]);

	if (!sessionId) {
		return (
			<div className="min-h-screen flex flex-col items-center justify-center p-8 bg-dos-dark">
				<div className="max-w-2xl w-full text-center">
					<h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
						DOS2 Savegame Editor
					</h1>
					<p className="text-dos-border mb-12 text-lg">
						Divinity: Original Sin 2 – Meta & Charaktere bearbeiten
					</p>
					<UploadZone />
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-dos-dark">
			<header className="border-b border-dos-border bg-dos-card/80 backdrop-blur sticky top-0 z-10">
				<div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
					<h1 className="text-xl font-semibold">DOS2 Savegame Editor</h1>
					<div className="flex items-center gap-3">
						<button
							onClick={handleSave}
							disabled={saving}
							className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium"
						>
							<Save size={18} />
							{saving ? "Speichern…" : "Speichern"}
						</button>
						<button
							onClick={handlePackAndDownload}
							disabled={packing}
							className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-sm font-medium"
						>
							<Download size={18} />
							{packing ? "Erstelle LSV…" : "Als LSV herunterladen"}
						</button>
					</div>
				</div>
			</header>

			<main className="max-w-6xl mx-auto px-6 py-8">
				<div className="flex gap-2 mb-6">
					<button
						onClick={() => setActiveTab("meta")}
						className={clsx(
							"flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
							activeTab === "meta"
								? "bg-dos-elevated text-white"
								: "text-gray-400 hover:text-white hover:bg-dos-card"
						)}
					>
						<Settings size={18} />
						Meta & Einstellungen
					</button>
					<button
						onClick={() => setActiveTab("characters")}
						className={clsx(
							"flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
							activeTab === "characters"
								? "bg-dos-elevated text-white"
								: "text-gray-400 hover:text-white hover:bg-dos-card"
						)}
					>
						<Users size={18} />
						Charaktere
					</button>
				</div>

				{activeTab === "meta" && <MetaEditor />}
				{activeTab === "characters" && <CharacterEditor />}
			</main>
		</div>
	);
}

export default App;
