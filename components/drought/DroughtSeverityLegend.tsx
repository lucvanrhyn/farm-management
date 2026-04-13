/**
 * Horizontal color-ramp legend for SPI severity bands.
 * Purely presentational — no interactivity.
 */

const BANDS = [
  { label: 'Extreme Drought', bg: 'bg-red-900',    text: 'text-white'      },
  { label: 'Severe Drought',  bg: 'bg-red-600',    text: 'text-white'      },
  { label: 'Moderate Drought',bg: 'bg-orange-500', text: 'text-white'      },
  { label: 'Mild Dry',        bg: 'bg-amber-300',  text: 'text-gray-800'   },
  { label: 'Near Normal',     bg: 'bg-gray-100',   text: 'text-gray-700'   },
  { label: 'Mild Wet',        bg: 'bg-sky-200',    text: 'text-gray-800'   },
  { label: 'Moderate Wet',    bg: 'bg-blue-400',   text: 'text-white'      },
  { label: 'Severe Wet',      bg: 'bg-blue-700',   text: 'text-white'      },
  { label: 'Extreme Wet',     bg: 'bg-blue-950',   text: 'text-white'      },
] as const;

export function DroughtSeverityLegend() {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        SPI Severity Scale
      </p>
      <div className="flex flex-wrap gap-1">
        {BANDS.map((band) => (
          <span
            key={band.label}
            className={`rounded px-2 py-0.5 text-xs font-medium ${band.bg} ${band.text}`}
          >
            {band.label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-400">
        SPI &lt; −1 = drought conditions. SPI method: Z-score vs 30-year ERA5 normal (WMO 2012).
      </p>
    </div>
  );
}
