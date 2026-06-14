import { getCategoryLabel } from "@/lib/utils";
import { Animal } from "@/lib/types";
import type { FarmMode } from "@/lib/farm-mode";
import {
  canPerformLoggerAction,
  type LoggerAction,
} from "@/lib/logger/canPerformAction";
import { Icon } from "@/components/ds";

type ModalType = LoggerAction;

interface AnimalChecklistProps {
  campId: string;
  onFlag: (animalId: string, type: ModalType) => void;
  animals?: Animal[];
  flaggedIds?: Set<string>;
  species?: FarmMode;
}

// Tinted "actions" affordance — each action carries a ds Icon + a token tone
// colour matching the design's action sheet (Health=crit, Weigh=info,
// Treat=fair, Move=info, Calving=good, Repro=poor, Death=crit).
type ActionButton = { type: ModalType; Ico: typeof Icon.health; label: string; tone: string };

const TONE: Record<string, string> = {
  good: "var(--ft-good)",
  fair: "var(--ft-fair)",
  poor: "var(--ft-poor)",
  crit: "var(--ft-crit)",
  info: "var(--ft-info)",
};

const SHARED_BUTTONS: ActionButton[] = [
  { type: "health",   Ico: Icon.health, label: "Health", tone: "crit" },
  { type: "weigh",    Ico: Icon.weigh,  label: "Weigh",  tone: "info" },
  { type: "treat",    Ico: Icon.treat,  label: "Treat",  tone: "fair" },
  { type: "movement", Ico: Icon.move,   label: "Move",   tone: "info" },
];

const CATTLE_BUTTONS: ActionButton[] = [
  ...SHARED_BUTTONS,
  { type: "calving",      Ico: Icon.calving, label: "Calving", tone: "good" },
  { type: "reproduction", Ico: Icon.repro,   label: "Repro",   tone: "poor" },
  { type: "death",        Ico: Icon.death,   label: "Death",   tone: "crit" },
];

const SHEEP_BUTTONS: ActionButton[] = [
  ...SHARED_BUTTONS,
  { type: "calving",      Ico: Icon.calving, label: "Lambing", tone: "good" },
  { type: "reproduction", Ico: Icon.repro,   label: "Repro",   tone: "poor" },
  { type: "death",        Ico: Icon.death,   label: "Death",   tone: "crit" },
];

// Game animals are rarely tracked individually, but when they are (boma species), use basic buttons
const GAME_BUTTONS: ActionButton[] = [
  ...SHARED_BUTTONS,
  { type: "death", Ico: Icon.death, label: "Death", tone: "crit" },
];

const ACTION_BUTTONS_BY_MODE: Record<FarmMode, ActionButton[]> = {
  cattle: CATTLE_BUTTONS,
  sheep: SHEEP_BUTTONS,
  game: GAME_BUTTONS,
};

export default function AnimalChecklist({ campId, onFlag, animals: animalsProp, flaggedIds, species = "cattle" }: AnimalChecklistProps) {
  const animals = animalsProp ?? [];
  const actionButtons = ACTION_BUTTONS_BY_MODE[species];

  if (animals.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--ft-subtle)' }}>
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
              borderBottom: '1px solid var(--ft-border)',
              backgroundColor: isFlagged ? 'var(--ft-accent-faint)' : undefined,
            }}
          >
            {/* ID + category */}
            <div data-animal-id-col className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="ft-mono font-bold text-sm"
                  style={{ color: 'var(--ft-text)' }}
                >
                  {animal.animal_id}
                </span>
                <span className="ft-pill ft-pill-muted text-xs">
                  {getCategoryLabel(animal.category)}
                </span>
                {isFlagged && (
                  <span
                    className="ft-pill text-xs font-bold animate-fade-in"
                    style={{ backgroundColor: 'var(--ft-accent-faint)', color: 'var(--ft-accent)' }}
                  >
                    <Icon.check size={11} /> flagged
                  </span>
                )}
              </div>
              {animal.name && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--ft-muted)' }}>
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
              {actionButtons.map((btn) => {
                // Issue #391 — pure predicate gates invalid (animal, action)
                // pairs at the UI layer so the farmer cannot tick something
                // the server will reject (e.g. calving on a bull, reproduction
                // on a lamb). The reason string doubles as the tooltip +
                // aria-description so the disabled state is self-explanatory.
                const eligibility = canPerformLoggerAction(
                  { sex: animal.sex, category: animal.category },
                  btn.type,
                );
                const disabled = !eligibility.allowed;
                const reason = eligibility.allowed ? undefined : eligibility.reason;
                const tone = TONE[btn.tone];
                const { Ico } = btn;
                return (
                  <button
                    key={btn.type}
                    onClick={() => onFlag(animal.animal_id, btn.type)}
                    aria-label={btn.label}
                    aria-disabled={disabled}
                    aria-description={reason}
                    title={reason}
                    disabled={disabled}
                    data-action-disabled-reason={reason}
                    className="shrink-0 flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl min-w-[44px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
                    style={{
                      color: tone,
                      backgroundColor: 'var(--ft-surface2)',
                      border: '1px solid var(--ft-border)',
                    }}
                  >
                    <Ico size={17} />
                    <span className="text-[10px] leading-none" style={{ color: 'var(--ft-muted)' }}>{btn.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
