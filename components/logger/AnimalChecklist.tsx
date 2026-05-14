import { getCategoryLabel } from "@/lib/utils";
import { Animal, AnimalCategory } from "@/lib/types";
import type { FarmMode } from "@/lib/farm-mode";

type ModalType = "health" | "movement" | "calving" | "death" | "reproduction" | "weigh" | "treat";

interface AnimalChecklistProps {
  campId: string;
  onFlag: (animalId: string, type: ModalType) => void;
  animals?: Animal[];
  flaggedIds?: Set<string>;
  species?: FarmMode;
}

type ActionButton = { type: ModalType; icon: string; label: string; className: string };

const SHARED_BUTTONS: ActionButton[] = [
  { type: "health",   icon: "🏥", label: "Health", className: "text-amber-400 active:bg-amber-400/10" },
  { type: "weigh",    icon: "⚖️", label: "Weigh",  className: "text-blue-400 active:bg-blue-400/10" },
  { type: "treat",    icon: "💊", label: "Treat",  className: "text-green-400 active:bg-green-400/10" },
  { type: "movement", icon: "➡️", label: "Move",   className: "text-sky-400 active:bg-sky-400/10" },
];

const CATTLE_BUTTONS: ActionButton[] = [
  ...SHARED_BUTTONS,
  { type: "calving",      icon: "🐄", label: "Calving", className: "text-violet-400 active:bg-violet-400/10" },
  { type: "reproduction", icon: "🔬", label: "Repro",   className: "text-pink-400 active:bg-pink-400/10" },
  { type: "death",        icon: "✕",  label: "Death",   className: "text-red-400 active:bg-red-400/10" },
];

const SHEEP_BUTTONS: ActionButton[] = [
  ...SHARED_BUTTONS,
  { type: "calving",      icon: "🐑", label: "Lambing", className: "text-violet-400 active:bg-violet-400/10" },
  { type: "reproduction", icon: "🔬", label: "Repro",   className: "text-pink-400 active:bg-pink-400/10" },
  { type: "death",        icon: "✕",  label: "Death",   className: "text-red-400 active:bg-red-400/10" },
];

// Game animals are rarely tracked individually, but when they are (boma species), use basic buttons
const GAME_BUTTONS: ActionButton[] = [
  ...SHARED_BUTTONS,
  { type: "death", icon: "✕", label: "Death", className: "text-red-400 active:bg-red-400/10" },
];

const ACTION_BUTTONS_BY_MODE: Record<FarmMode, ActionButton[]> = {
  cattle: CATTLE_BUTTONS,
  sheep: SHEEP_BUTTONS,
  game: GAME_BUTTONS,
};

function getCategoryChipDark(category: AnimalCategory): string {
  switch (category) {
    case "Cow":    return "bg-stone-800/50 text-stone-200";
    case "Calf":   return "bg-sky-900/50 text-sky-300";
    case "Heifer": return "bg-violet-900/50 text-violet-300";
    case "Bull":   return "bg-amber-900/50 text-amber-300";
    case "Ox":     return "bg-stone-800/50 text-stone-300";
    // Sheep
    case "Ewe":        return "bg-rose-900/50 text-rose-300";
    case "Ram":        return "bg-amber-900/50 text-amber-300";
    case "Lamb":       return "bg-sky-900/50 text-sky-300";
    case "Wether":     return "bg-stone-800/50 text-stone-300";
    case "Hogget":     return "bg-teal-900/50 text-teal-300";
    case "Maiden Ewe": return "bg-pink-900/50 text-pink-300";
    case "Ewe Lamb":   return "bg-fuchsia-900/50 text-fuchsia-300";
    // Game
    case "Adult Male":   return "bg-indigo-900/50 text-indigo-300";
    case "Adult Female": return "bg-purple-900/50 text-purple-300";
    case "Sub-adult":    return "bg-cyan-900/50 text-cyan-300";
    case "Juvenile":     return "bg-sky-900/50 text-sky-300";
    default:             return "bg-gray-800/50 text-gray-300";
  }
}

export default function AnimalChecklist({ campId, onFlag, animals: animalsProp, flaggedIds, species = "cattle" }: AnimalChecklistProps) {
  const animals = animalsProp ?? [];
  const actionButtons = ACTION_BUTTONS_BY_MODE[species];

  if (animals.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm" style={{ color: 'rgba(210, 180, 140, 0.6)' }}>
        No animals in this camp.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {animals.map((animal) => {
        const isFlagged = flaggedIds?.has(animal.animal_id) ?? false;
        return (
          <div
            key={animal.animal_id}
            data-animal-row
            // Wave 262: stack vertically on mobile (< sm) so the 7-button cattle
            // action cluster never collides with the ID+chip column on a 390px
            // viewport. Side-by-side returns at sm+ where the row has space.
            className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3.5 min-h-[68px] transition-colors"
            style={{
              borderBottom: '1px solid rgba(92, 61, 46, 0.25)',
              backgroundColor: isFlagged ? 'rgba(184, 115, 51, 0.08)' : undefined,
            }}
          >
            {/* ID + category */}
            <div data-animal-id-col className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="font-mono font-bold text-sm"
                  style={{ color: '#F5F0E8' }}
                >
                  {animal.animal_id}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${getCategoryChipDark(animal.category)}`}>
                  {getCategoryLabel(animal.category)}
                </span>
                {isFlagged && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full font-bold animate-fade-in"
                    style={{ backgroundColor: 'rgba(184, 115, 51, 0.25)', color: '#F0A050' }}
                  >
                    ✓ flagged
                  </span>
                )}
              </div>
              {animal.name && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(210, 180, 140, 0.65)' }}>
                  {animal.name}
                </p>
              )}
            </div>

            {/* Action pill buttons — species-specific.
                Wave 262: `overflow-x-auto` so on tighter widths (or when more
                actions are added) the user swipes through actions instead of
                clipping. `-mx-4 px-4` matches the row's parent gutter so the
                strip can scroll edge-to-edge without a visible inset. */}
            <div
              data-animal-actions
              className="flex items-center gap-1 shrink-0 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible"
            >
              {actionButtons.map((btn) => (
                <button
                  key={btn.type}
                  onClick={() => onFlag(animal.animal_id, btn.type)}
                  aria-label={btn.label}
                  className={`shrink-0 flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl min-w-[44px] transition-colors ${btn.className}`}
                >
                  <span className="text-base leading-none">{btn.icon}</span>
                  <span className="text-[10px] leading-none">{btn.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
