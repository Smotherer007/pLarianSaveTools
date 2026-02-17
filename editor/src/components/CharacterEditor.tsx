import { useMemo, useState, useEffect, useCallback } from "react";
import { useEditorStore } from "../store";
import { ATTR_NAMES, xpToLevel } from "../lib/globals-parser";
import {
	parseCharacterInventory,
	getItemDisplayName,
	getItemDisplayNameWithAmount,
	EQUIPMENT_SLOT_NAMES,
	type ItemEntry,
} from "../lib/inventory-parser";
import { patchItemAmount } from "../lib/globals-parser";
import { BookOpen, ChevronDown, ChevronRight, Heart, Shield, Sparkles, Package, Swords, X } from "lucide-react";
import { clsx } from "clsx";

type TalentEntry = { name: string; description: string };
type SkillEntry = { name: string; description: string };

type DetailModal = { type: "talent" | "skill" | "item"; name: string; description: string; rawId?: string };

export function CharacterEditor() {
	const { metaData, charactersData, setCharacterData, globalsXml } = useEditorStore();
	const [expandedChar, setExpandedChar] = useState<number>(0);
	const [talentsData, setTalentsData] = useState<Record<string, TalentEntry>>({});
	const [skillsData, setSkillsData] = useState<Record<string, SkillEntry>>({});
	const [detailModal, setDetailModal] = useState<DetailModal | null>(null);
	const [libraryModal, setLibraryModal] = useState<"talents" | "skills" | "items" | null>(null);
	const [statsToName, setStatsToName] = useState<Record<string, string>>({});
	const [itemsData, setItemsData] = useState<Record<string, ItemEntry>>({});

	useEffect(() => {
		fetch("/dos2-talents.json")
			.then((r) => r.json())
			.then(setTalentsData)
			.catch(() => {});
	}, []);
	useEffect(() => {
		fetch("/dos2-skills.json")
			.then((r) => r.json())
			.then(setSkillsData)
			.catch(() => {});
	}, []);
	useEffect(() => {
		fetch("/dos2-items.json")
			.then((r) => r.json())
			.then(setItemsData)
			.catch(() => {});
	}, []);

	if (!metaData) return null;

	return (
		<>
		<div className="space-y-5">
			{(charactersData.length > 0 ? charactersData : metaData.characterMeta).map((char, i) => {
				const isMetaChar = metaData.characterMeta[i];
				const metaName = isMetaChar?.characterName ?? `Charakter ${i + 1}`;
				const fullChar = charactersData[i];
				const displayName = fullChar?.characterName || metaName;
				const isExpanded = expandedChar === i;

				return (
					<div
						key={i}
						className="bg-dos-card rounded-xl border border-dos-border overflow-hidden"
					>
						<button
							onClick={() => setExpandedChar(isExpanded ? -1 : i)}
							className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-dos-elevated/50 transition-colors"
						>
							<div className="flex items-center gap-3">
								{isExpanded ? (
									<ChevronDown size={20} className="text-gray-400" />
								) : (
									<ChevronRight size={20} className="text-gray-400" />
								)}
								<div className="flex items-center gap-2">
									<span className="font-semibold">{displayName}</span>
									{fullChar && fullChar.inParty === false && (
										<span className="px-2 py-0.5 rounded text-xs bg-amber-600/30 text-amber-300">
											Im Lager
										</span>
									)}
								</div>
								{fullChar && (
									<span className="text-sm text-gray-500">
										Lvl {xpToLevel(fullChar.experience)} | HP {fullChar.vitality} | AP {fullChar.actionPoints}
									</span>
								)}
							</div>
						</button>

						{isExpanded && (
							<div className="border-t border-dos-border px-6 py-6 lg:px-8 lg:py-8">
								{/* Charaktername (aus Meta) – lokaler State, Commit on blur */}
								{isMetaChar && (
									<div className="mb-8">
										<CharNameInput
											value={metaName}
											onCommit={(name) => {
												const next = [...metaData.characterMeta];
												next[i] = { ...next[i], characterName: name };
												useEditorStore.getState().setMetaData({ ...metaData, characterMeta: next });
											}}
										/>
									</div>
								)}

								{fullChar ? (
									<div className="space-y-10">
										{/* Zwei Spalten: Links Stats, Rechts Inventar/Talente/Skills */}
										<div className="grid lg:grid-cols-[1fr_1fr] gap-10 lg:gap-12">
											{/* Linke Spalte: Charakterwerte */}
											<div className="space-y-8">
												<Section title="Basis & Vitalität" icon={<Heart size={20} />}>
													<div className="grid grid-cols-2 md:grid-cols-3 gap-5">
														<StatInput label="HP" value={fullChar.vitality} onChange={(v) => setCharacterData(i, { vitality: v })} min={1} max={9999} />
														<StatInput label="Physische Rüstung" value={fullChar.armor} onChange={(v) => setCharacterData(i, { armor: v })} min={0} max={999} />
														<StatInput label="Magische Rüstung" value={fullChar.magicArmor} onChange={(v) => setCharacterData(i, { magicArmor: v })} min={0} max={999} />
														<StatInput label="AP" value={fullChar.actionPoints} onChange={(v) => setCharacterData(i, { actionPoints: v })} min={0} max={999} />
														<StatInput label="Quellenpunkte" value={fullChar.magicPoints} onChange={(v) => setCharacterData(i, { magicPoints: v })} min={0} max={999} />
														<StatInput label="Erfahrung" value={fullChar.experience} onChange={(v) => setCharacterData(i, { experience: v })} min={0} max={999999} />
													</div>
												</Section>

												<Section title="Punkte-Pools" icon={<Sparkles size={20} />}>
													<div className="grid grid-cols-2 gap-5">
														<StatInput label="Attributspunkte" value={fullChar.attributePoints} onChange={(v) => setCharacterData(i, { attributePoints: v })} min={0} max={999} />
														<StatInput label="Fähigkeitspunkte (Kampf)" value={fullChar.combatAbilityPoints} onChange={(v) => setCharacterData(i, { combatAbilityPoints: v })} min={0} max={999} />
														<StatInput label="Zivilpunkte" value={fullChar.civilAbilityPoints} onChange={(v) => setCharacterData(i, { civilAbilityPoints: v })} min={0} max={999} />
														<StatInput label="Talentpunkte" value={fullChar.talentPoints} onChange={(v) => setCharacterData(i, { talentPoints: v })} min={0} max={999} />
													</div>
												</Section>

												<Section title="Attribute" icon={<Shield size={20} />}>
													<div className="grid grid-cols-2 md:grid-cols-3 gap-5">
														{[...(fullChar.attributes || []), 10, 10, 10, 10, 10, 10]
															.slice(0, 6)
															.map((val, ai) => (
																<StatInput
																	key={ATTR_NAMES[ai]}
																	label={ATTR_NAMES[ai]}
																	value={val}
																	onChange={(v) => {
																		const attrs = [...(fullChar.attributes || []), 10, 10, 10, 10, 10, 10].slice(0, 6);
																		attrs[ai] = v;
																		setCharacterData(i, { attributes: attrs });
																	}}
																	min={1}
																	max={99}
																/>
															))}
													</div>
												</Section>
											</div>

											{/* Rechte Spalte: Inventar, Talente, Skills */}
											<div className="space-y-8">
										{globalsXml && fullChar.inventoryHandle && (
											<InventorySection
												globalsXml={globalsXml}
												inventoryHandle={fullChar.inventoryHandle}
												statsToName={statsToName}
												itemsData={itemsData}
												onItemClick={(name, description, statsId) =>
													setDetailModal({ type: "item", name, description, rawId: statsId })
												}
												onLibraryOpen={() => setLibraryModal("items")}
											/>
										)}

												<Section
													title="Talente"
													icon={<Sparkles size={20} />}
													headerAction={
														<button
															type="button"
															onClick={() => setLibraryModal("talents")}
															className="p-1.5 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
															title="Alle Talente nachschlagen"
														>
															<BookOpen size={18} />
														</button>
													}
												>
													{fullChar.talents.length > 0 ? (
														<div className="flex flex-wrap gap-2.5 max-h-40 overflow-y-auto">
															{fullChar.talents.map((id) => {
																const t = talentsData[String(id)];
																const name = t?.name ?? `ID ${id}`;
																const desc = t?.description ?? "";
																return (
																	<button
																		key={id}
																		type="button"
																		onClick={() => setDetailModal({ type: "talent", name, description: desc, rawId: String(id) })}
																		className="px-3 py-1.5 rounded-md text-sm font-mono bg-dos-elevated text-gray-300 hover:bg-dos-elevated/80 hover:text-white transition-colors text-left"
																	>
																		{name}
																	</button>
																);
															})}
														</div>
													) : (
														<p className="text-gray-500 text-sm">Keine Talente</p>
													)}
												</Section>

												<Section
													title="Skills"
													icon={<Swords size={20} />}
													headerAction={
														<button
															type="button"
															onClick={() => setLibraryModal("skills")}
															className="p-1.5 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
															title="Alle Skills nachschlagen"
														>
															<BookOpen size={18} />
														</button>
													}
												>
													{fullChar.skills.filter((s) => s.learned).length > 0 ? (
														<div className="flex flex-wrap gap-2.5 max-h-48 overflow-y-auto">
															{fullChar.skills.filter((s) => s.learned).map((s) => {
																const sk = skillsData[s.id];
																const name = sk?.name ?? s.id;
																const desc = sk?.description ?? "";
																return (
																	<button
																		key={s.id}
																		type="button"
																		onClick={() => setDetailModal({ type: "skill", name, description: desc, rawId: s.id })}
																		className={clsx(
																			"px-3 py-1.5 rounded-md text-sm font-mono transition-colors text-left",
																			s.activated ? "bg-blue-600/30 text-blue-300 hover:bg-blue-600/50" : "bg-dos-elevated text-gray-400 hover:bg-dos-elevated/80 hover:text-gray-300"
																		)}
																	>
																		{name}
																	</button>
																);
															})}
														</div>
													) : (
														<p className="text-gray-500 text-sm">Keine Skills</p>
													)}
												</Section>
											</div>
										</div>
									</div>
								) : (
									<p className="text-gray-400 text-sm">
										Keine Charakterdaten in globals.lsx gefunden. Stelle sicher, dass die LSV globals.lsf enthält.
									</p>
								)}
							</div>
						)}
					</div>
				);
			})}
		</div>

		{detailModal && (
			<DetailModal
				type={detailModal.type}
				title={detailModal.name}
				description={detailModal.description}
				rawId={detailModal.rawId}
				onClose={() => setDetailModal(null)}
			/>
		)}

		{libraryModal && (
			<LibraryModal
				type={libraryModal}
				talentsData={talentsData}
				skillsData={skillsData}
				itemsData={itemsData}
				onClose={() => setLibraryModal(null)}
				onSelectItem={(item) => setDetailModal(item)}
			/>
		)}
		</>
	);
}

function LibraryModal({
	type,
	talentsData,
	skillsData,
	itemsData,
	onClose,
	onSelectItem,
}: {
	type: "talents" | "skills" | "items";
	talentsData: Record<string, TalentEntry>;
	skillsData: Record<string, SkillEntry>;
	itemsData: Record<string, ItemEntry>;
	onClose: () => void;
	onSelectItem: (item: DetailModal) => void;
}) {
	const [search, setSearch] = useState("");
	const entries =
		type === "talents"
			? Object.entries(talentsData)
			: type === "skills"
				? Object.entries(skillsData)
				: Object.entries(itemsData);
	const filtered = search.trim()
		? entries.filter(([, v]) => v.name.toLowerCase().includes(search.toLowerCase()))
		: entries;

	useEffect(() => {
		const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [onClose]);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="relative w-full max-w-lg max-h-[85vh] rounded-2xl border border-dos-border bg-dos-card shadow-2xl overflow-hidden flex flex-col"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between p-5 border-b border-dos-border">
					<div className="flex items-center gap-2">
						<BookOpen size={22} className="text-amber-400" />
						<h2 className="text-lg font-semibold text-white">
							{type === "talents" ? "Alle Talente" : type === "skills" ? "Alle Skills" : "Alle Items"}
						</h2>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-dos-elevated transition-colors"
						aria-label="Schließen"
					>
						<X size={20} />
					</button>
				</div>
				<div className="p-4 border-b border-dos-border">
					<input
						type="text"
						placeholder="Suchen..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="w-full px-4 py-2.5 rounded-lg bg-dos-elevated border border-dos-border text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50"
					/>
				</div>
				<div className="flex-1 overflow-y-auto p-4">
					<div className="space-y-1.5">
						{filtered.map(([id, { name, description }]) => (
							<button
								key={id}
								type="button"
								onClick={() =>
									onSelectItem({
										type: type === "talents" ? "talent" : type === "skills" ? "skill" : "item",
										name,
										description: description ?? "",
										rawId: id,
									})
								}
								className="w-full text-left px-4 py-3 rounded-lg bg-dos-elevated/60 hover:bg-dos-elevated border border-transparent hover:border-dos-border text-gray-300 hover:text-white transition-colors"
							>
								<span className="font-medium block">{name}</span>
								{description && (
									<span className="text-xs text-gray-500 line-clamp-2 mt-0.5">{description}</span>
								)}
							</button>
						))}
					</div>
					{filtered.length === 0 && (
						<p className="text-gray-500 text-sm py-8 text-center">Keine Einträge gefunden.</p>
					)}
				</div>
			</div>
		</div>
	);
}

function DetailModal({
	type,
	title,
	description,
	rawId,
	onClose,
}: {
	type: "talent" | "skill";
	title: string;
	description: string;
	rawId?: string;
	onClose: () => void;
}) {
	useEffect(() => {
		const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [onClose]);

	return (
		<div
			className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="relative w-full max-w-md rounded-2xl border border-dos-border bg-dos-card shadow-2xl overflow-hidden"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="absolute top-4 right-4">
					<button
						type="button"
						onClick={onClose}
						className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-dos-elevated transition-colors"
						aria-label="Schließen"
					>
						<X size={20} />
					</button>
				</div>
				<div className="p-6 pt-8">
					<span className="inline-block px-2.5 py-0.5 rounded text-xs font-medium bg-amber-600/20 text-amber-400 mb-3">
						{type === "talent" ? "Talent" : type === "skill" ? "Skill" : "Item"}
					</span>
					<h3 className="text-xl font-semibold text-white mb-3">{title}</h3>
					{rawId && (
						<p className="text-xs text-gray-500 font-mono mb-3">ID: {rawId}</p>
					)}
					{description ? (
						<p className="text-gray-300 text-sm leading-relaxed">{description}</p>
					) : (
						<p className="text-gray-500 text-sm italic">Keine Beschreibung verfügbar.</p>
					)}
				</div>
			</div>
		</div>
	);
}

function BagItemAmountInput({
	item,
	statsToName,
	itemsData,
	onAmountChange,
	onItemClick,
}: {
	item: { handle: string; amount: number; stats: string; level?: number };
	statsToName: Record<string, string>;
	itemsData: Record<string, ItemEntry>;
	onAmountChange: (handle: string, amount: number) => void;
	onItemClick?: (name: string, description: string, statsId: string) => void;
}) {
	const [local, setLocal] = useState(String(item.amount));
	useEffect(() => setLocal(String(item.amount)), [item.amount]);
	const commit = useCallback(() => {
		const v = Math.max(1, Math.min(9999, parseInt(local, 10) || 1));
		if (v !== item.amount) onAmountChange(item.handle, v);
		setLocal(String(v));
	}, [local, item.amount, item.handle, onAmountChange]);
	const entry = itemsData[item.stats];
	const displayName = getItemDisplayName(item, statsToName, itemsData);
	const handleNameClick = () => {
		if (onItemClick) {
			onItemClick(entry?.name ?? displayName, entry?.description ?? "", item.stats);
		}
	};
	return (
		<div className="flex items-center gap-2 px-2 py-1.5 rounded bg-dos-elevated border border-dos-border group">
			{onItemClick ? (
				<button
					type="button"
					onClick={handleNameClick}
					className="text-xs truncate max-w-[140px] font-mono text-left hover:text-amber-400 transition-colors"
					title={item.stats}
				>
					{getItemDisplayNameWithAmount(item, statsToName, itemsData)}
				</button>
			) : (
				<span className="text-xs truncate max-w-[140px] font-mono" title={item.stats}>
					{getItemDisplayNameWithAmount(item, statsToName, itemsData)}
				</span>
			)}
			<input
				type="number"
				min={1}
				max={9999}
				value={local}
				onChange={(e) => setLocal(e.target.value)}
				onBlur={commit}
				className="w-14 px-1 py-0.5 text-xs rounded bg-dos-dark border border-dos-border text-right font-mono focus:ring-1 focus:ring-blue-500"
			/>
			{item.level ? (
				<span className="text-xs text-gray-500">Lvl {item.level}</span>
			) : null}
		</div>
	);
}

function InventorySection({
	globalsXml,
	inventoryHandle,
	statsToName,
	itemsData,
	onItemClick,
	onLibraryOpen,
}: {
	globalsXml: string;
	inventoryHandle: string;
	statsToName: Record<string, string>;
	itemsData: Record<string, ItemEntry>;
	onItemClick: (name: string, description: string, statsId: string) => void;
	onLibraryOpen: () => void;
}) {
	const { setGlobalsXml } = useEditorStore();
	const inventory = useMemo(
		() => parseCharacterInventory(globalsXml, inventoryHandle),
		[globalsXml, inventoryHandle]
	);

	const handleAmountChange = (itemHandle: string, newAmount: number) => {
		const next = patchItemAmount(globalsXml, itemHandle, Math.max(1, newAmount));
		setGlobalsXml(next);
	};

	return (
		<div className="space-y-6">
			<Section
				title="Ausrüstung"
				icon={<Swords size={20} />}
				headerAction={
					<button
						type="button"
						onClick={onLibraryOpen}
						className="p-1.5 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
						title="Alle Items nachschlagen"
					>
						<BookOpen size={18} />
					</button>
				}
			>
				<div className="grid grid-cols-2 md:grid-cols-3 gap-4">
					{inventory.equipment.map((item) => {
						const entry = itemsData[item.stats];
						const name = getItemDisplayName(item, statsToName, itemsData);
						const displayText = `${name}${item.amount > 1 ? ` ×${item.amount}` : ""}`;
						return (
							<button
								key={item.handle}
								type="button"
								onClick={() => onItemClick(entry?.name ?? name, entry?.description ?? "", item.stats)}
								className="p-4 rounded-lg bg-dos-card border border-dos-border text-left hover:border-amber-500/50 hover:bg-dos-elevated/80 transition-colors"
							>
								<div className="text-xs text-gray-500 mb-1.5">
									{EQUIPMENT_SLOT_NAMES[item.slot] ?? `Slot ${item.slot}`}
								</div>
								<div className="text-sm font-medium truncate font-mono" title={item.stats}>
									{displayText}
								</div>
								{item.level ? (
									<div className="text-xs text-gray-500 mt-0.5">Lvl {item.level}</div>
								) : null}
							</button>
						);
					})}
					{inventory.equipment.length === 0 && (
						<p className="text-gray-500 text-sm col-span-2">Keine Ausrüstung</p>
					)}
				</div>
			</Section>
			<Section
				title="Tasche"
				icon={<Package size={20} />}
				headerAction={
					<button
						type="button"
						onClick={onLibraryOpen}
						className="p-1.5 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
						title="Alle Items nachschlagen"
					>
						<BookOpen size={18} />
					</button>
				}
			>
				<div className="flex flex-wrap gap-3 max-h-64 overflow-y-auto">
					{inventory.bag.map((item) => (
						<BagItemAmountInput
							key={item.handle}
							item={item}
							statsToName={statsToName}
							itemsData={itemsData}
							onAmountChange={(h, v) => handleAmountChange(h, v)}
							onItemClick={onItemClick}
						/>
					))}
					{inventory.bag.length === 0 && (
						<p className="text-gray-500 text-sm">Tasche leer</p>
					)}
				</div>
			</Section>
		</div>
	);
}

function Section({
	title,
	icon,
	headerAction,
	children,
}: {
	title: string;
	icon: React.ReactNode;
	headerAction?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="rounded-xl bg-dos-elevated/40 border border-dos-border/60 p-5 lg:p-6">
			<div className="flex items-center justify-between gap-2 mb-4">
				<h3 className="flex items-center gap-2.5 text-base font-medium text-gray-300">
					{icon}
					{title}
				</h3>
				{headerAction}
			</div>
			{children}
		</div>
	);
}

function CharNameInput({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
	const [local, setLocal] = useState(value);
	useEffect(() => setLocal(value), [value]);
	return (
		<div>
			<label className="block text-sm font-medium text-gray-400 mb-2">Name</label>
			<input
				type="text"
				value={local}
				onChange={(e) => setLocal(e.target.value)}
				onBlur={() => local !== value && onCommit(local)}
				className="w-full max-w-sm px-4 py-2.5 rounded-lg bg-dos-elevated border border-dos-border text-white focus:ring-2 focus:ring-blue-500"
			/>
		</div>
	);
}

/** Lokaler State + Commit on blur – verhindert Store-Update bei jedem Tastendruck */
function StatInput({
	label,
	value,
	onChange,
	min = 0,
	max = 999,
	disabled = false,
}: {
	label: string;
	value: number;
	onChange: (v: number) => void;
	min?: number;
	max?: number;
	disabled?: boolean;
}) {
	const [local, setLocal] = useState(String(value));
	useEffect(() => setLocal(String(value)), [value]);
	const commit = useCallback(() => {
		if (disabled) return;
		const v = Math.min(max, Math.max(min, parseInt(local, 10) || 0));
		if (v !== value) onChange(v);
		setLocal(String(v));
	}, [local, value, min, max, onChange, disabled]);
	return (
		<div>
			<label className="block text-sm text-gray-500 mb-1.5">{label}</label>
			<input
				type="number"
				value={local}
				onChange={(e) => setLocal(e.target.value)}
				onBlur={commit}
				min={min}
				max={max}
				disabled={disabled}
				className={clsx(
					"w-full px-4 py-2.5 rounded-lg border font-mono text-sm",
					disabled
						? "bg-dos-elevated/50 border-dos-border text-gray-500 cursor-not-allowed"
						: "bg-dos-elevated border-dos-border text-white focus:ring-2 focus:ring-blue-500"
				)}
			/>
		</div>
	);
}
