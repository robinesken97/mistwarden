// Mistwarden (added 2026-11-24): the lantern mark and the night scene behind
// the pages outside a campaign. Shapes and colours: styles/night-scene.css.

const LANTERN_BODY = 'M24 4v5M19 9h10M17 15l2-6h10l2 6M15 15h18v18l-4 7H19l-4-7zM19 40l-1 4h12l-1-4';
const LANTERN_FLAME = 'M24 21c3 3 4 5 4 7a4 4 0 01-8 0c0-2 1-4 4-7z';

/** The Mistwarden lantern, drawn in the accent with a lit flame. */
export function Lantern({ className = 'w-12 h-12' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={`lantern ${className}`}>
      <path d={LANTERN_BODY} />
      <path d={LANTERN_FLAME} className="lantern-flame" />
    </svg>
  );
}

const SCENE = [
  'scene-moon',
  'scene-moon scene-moon-core',
  'scene-hills scene-hills-far',
  'scene-tower',
  'scene-window',
  'scene-hills scene-hills-near',
  'scene-mist mist-1',
  'scene-mist mist-2',
  'scene-mist mist-3',
];

/** Moon, hills, a watchtower with a lit window and mist; fixed behind the page. */
export function NightScene() {
  return (
    <div className="night-scene" aria-hidden="true">
      {SCENE.map((className) => (
        <div key={className} className={className} />
      ))}
    </div>
  );
}
