import { useEditorStore } from "../store";

const DIFFICULTIES = [
	{ value: 0, label: "Story" },
	{ value: 1, label: "Klassisch" },
	{ value: 2, label: "Taktiker" },
	{ value: 3, label: "Ehrenmodus" },
];

export function MetaEditor() {
	const { metaData, setMetaData } = useEditorStore();

	if (!metaData) return null;

	return (
		<div className="bg-dos-card rounded-xl border border-dos-border p-6">
			<h2 className="text-lg font-semibold mb-6">Meta & Einstellungen</h2>

			<div className="space-y-6">
				<div>
					<label className="block text-sm font-medium text-gray-400 mb-2">Schwierigkeit</label>
					<select
						value={metaData.difficulty}
						onChange={(e) =>
							setMetaData({
								...metaData,
								difficulty: parseInt(e.target.value, 10),
							})
						}
						className="w-full max-w-xs px-4 py-2 rounded-lg bg-dos-elevated border border-dos-border text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					>
						{DIFFICULTIES.map((d) => (
							<option key={d.value} value={d.value}>
								{d.label}
							</option>
						))}
					</select>
				</div>

				<div>
					<label className="block text-sm font-medium text-gray-400 mb-2">Aktueller Level</label>
					<input
						type="text"
						value={metaData.level}
						onChange={(e) =>
							setMetaData({
								...metaData,
								level: e.target.value,
							})
						}
						className="w-full max-w-xs px-4 py-2 rounded-lg bg-dos-elevated border border-dos-border text-white font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						placeholder="z.B. FJ_FortJoy_Main"
					/>
				</div>

				<div>
					<label className="block text-sm font-medium text-gray-400 mb-2">Save Game ID</label>
					<input
						type="number"
						value={metaData.saveGameId}
						onChange={(e) =>
							setMetaData({
								...metaData,
								saveGameId: parseInt(e.target.value, 10) || 0,
							})
						}
						className="w-full max-w-xs px-4 py-2 rounded-lg bg-dos-elevated border border-dos-border text-white font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					/>
				</div>
			</div>
		</div>
	);
}
