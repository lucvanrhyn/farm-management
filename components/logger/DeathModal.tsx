"use client";

interface DeathModalProps {
  readonly isOpen: boolean;
  readonly animalId: string;
  readonly causes: string[];
  readonly onSelect: (cause: string) => void;
  readonly onClose: () => void;
}

export default function DeathModal({ isOpen, animalId, causes, onSelect, onClose }: DeathModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative rounded-t-3xl p-6 flex flex-col gap-4"
        style={{ backgroundColor: '#1E0F07', boxShadow: '0 -8px 40px rgba(0,0,0,0.6)' }}
      >
        <div className="flex justify-center">
          <div
            className="w-10 h-1.5 rounded-full"
            style={{ backgroundColor: 'rgba(139, 105, 20, 0.4)' }}
          />
        </div>
        <h2
          className="font-bold text-lg"
          style={{ fontFamily: 'var(--font-display)', color: '#F5F0E8' }}
        >
          Record Death — {animalId}
        </h2>
        <p className="text-sm" style={{ color: '#D2B48C' }}>
          Confirm that animal <span className="font-bold" style={{ color: '#F5F0E8' }}>{animalId}</span> is deceased?
        </p>
        <div className="flex flex-col gap-2">
          {causes.map((cause) => (
            <button
              key={cause}
              onClick={() => onSelect(cause)}
              className="w-full py-3.5 rounded-xl text-sm font-medium transition-colors hover:border-[#B87333] hover:text-[#F5F0E8]"
              style={{
                backgroundColor: 'rgba(44, 21, 8, 0.5)',
                border: '1px solid rgba(92, 61, 46, 0.4)',
                color: '#D2B48C',
              }}
            >
              {cause}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="text-sm py-2"
          style={{ color: 'rgba(210, 180, 140, 0.5)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
