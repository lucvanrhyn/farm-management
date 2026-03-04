import { getAnimalsByCamp, getCategoryLabel } from "@/lib/utils";
import { Animal, AnimalCategory } from "@/lib/types";

type ModalType = "health" | "movement" | "calving" | "death";

interface AnimalChecklistProps {
  campId: string;
  onFlag: (animalId: string, type: ModalType) => void;
  animals?: Animal[];
}

const ACTION_BUTTONS: { type: ModalType; icon: string; label: string; className: string }[] = [
  { type: "health",   icon: "🏥", label: "Gesond", className: "text-amber-400 active:bg-amber-400/10" },
  { type: "movement", icon: "➡️", label: "Skuif",  className: "text-sky-400 active:bg-sky-400/10" },
  { type: "calving",  icon: "🐄", label: "Kalf",   className: "text-violet-400 active:bg-violet-400/10" },
  { type: "death",    icon: "✕",  label: "Dood",   className: "text-red-400 active:bg-red-400/10" },
];

function getCategoryChipDark(category: AnimalCategory): string {
  switch (category) {
    case "Cow":    return "bg-stone-800/50 text-stone-200";
    case "Calf":   return "bg-sky-900/50 text-sky-300";
    case "Heifer": return "bg-violet-900/50 text-violet-300";
    case "Bull":   return "bg-amber-900/50 text-amber-300";
    case "Ox":     return "bg-stone-800/50 text-stone-300";
  }
}

export default function AnimalChecklist({ campId, onFlag, animals: animalsProp }: AnimalChecklistProps) {
  const animals = animalsProp ?? getAnimalsByCamp(campId);

  if (animals.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm" style={{ color: 'rgba(210, 180, 140, 0.6)' }}>
        Geen diere in hierdie kamp nie.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {animals.map((animal) => (
        <div
          key={animal.animal_id}
          className="flex items-center gap-3 px-4 py-3.5 min-h-[68px]"
          style={{ borderBottom: '1px solid rgba(92, 61, 46, 0.25)' }}
        >
          {/* ID + category */}
          <div className="flex-1 min-w-0">
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
            </div>
            {animal.name && (
              <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(210, 180, 140, 0.65)' }}>
                {animal.name}
              </p>
            )}
          </div>

          {/* Action pill buttons */}
          <div className="flex items-center gap-1 shrink-0">
            {ACTION_BUTTONS.map((btn) => (
              <button
                key={btn.type}
                onClick={() => onFlag(animal.animal_id, btn.type)}
                aria-label={btn.label}
                className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl min-w-[44px] transition-colors ${btn.className}`}
              >
                <span className="text-base leading-none">{btn.icon}</span>
                <span className="text-[10px] leading-none">{btn.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
