import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { useEditorStore } from "../store";

export function UploadZone() {
	const inputRef = useRef<HTMLInputElement>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const setSession = useEditorStore((s) => s.setSession);

	const handleFile = async (file: File) => {
		if (!file.name.toLowerCase().endsWith(".lsv")) {
			setError("Bitte eine .lsv Savegame-Datei auswählen.");
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const formData = new FormData();
			formData.append("file", file);

			const res = await fetch("/api/upload", {
				method: "POST",
				body: formData,
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error || `Upload fehlgeschlagen (${res.status})`);
			}

			const { sessionId, files } = await res.json();

			// Meta und Globals laden
			const metaRes = await fetch(`/api/session/${sessionId}/file/meta.lsx`);
			const globalsRes = files.includes("globals.lsx")
				? await fetch(`/api/session/${sessionId}/file/globals.lsx`)
				: null;

			if (!metaRes.ok) throw new Error("meta.lsx konnte nicht geladen werden");

			const metaXml = await metaRes.text();
			const globalsXml = globalsRes?.ok ? await globalsRes.text() : "";

			setSession(sessionId, metaXml, globalsXml);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Unbekannter Fehler");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div
			onClick={() => inputRef.current?.click()}
			onDragOver={(e) => {
				e.preventDefault();
				e.currentTarget.classList.add("ring-2", "ring-blue-500");
			}}
			onDragLeave={(e) => {
				e.currentTarget.classList.remove("ring-2", "ring-blue-500");
			}}
			onDrop={(e) => {
				e.preventDefault();
				e.currentTarget.classList.remove("ring-2", "ring-blue-500");
				const file = e.dataTransfer.files[0];
				if (file) handleFile(file);
			}}
			className={`
				relative border-2 border-dashed border-dos-border rounded-2xl p-16
				text-center cursor-pointer transition-all
				hover:border-blue-500/50 hover:bg-dos-card/50
				${loading ? "pointer-events-none opacity-80" : ""}
			`}
		>
			<input
				ref={inputRef}
				type="file"
				accept=".lsv"
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) handleFile(file);
					e.target.value = "";
				}}
			/>
			{loading ? (
				<>
					<Loader2 className="w-16 h-16 mx-auto mb-4 text-blue-400 animate-spin" />
					<p className="text-lg">Savegame wird extrahiert…</p>
				</>
			) : (
				<>
					<Upload className="w-16 h-16 mx-auto mb-4 text-dos-border" />
					<p className="text-xl font-medium mb-2">LSV-Datei hier ablegen oder klicken</p>
					<p className="text-dos-border text-sm">
						Nur meta.lsx und globals.lsx werden bearbeitet
					</p>
				</>
			)}
			{error && (
				<p className="mt-4 text-red-400 text-sm font-medium">{error}</p>
			)}
		</div>
	);
}
