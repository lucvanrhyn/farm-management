// StatusIndicator — Color-coded status badge (good/fair/poor/critical)
export default function StatusIndicator({ label }: { label: string }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs bg-stone-100 text-stone-500">
      {label}
    </span>
  );
}
