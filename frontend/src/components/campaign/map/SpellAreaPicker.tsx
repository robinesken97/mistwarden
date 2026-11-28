// ============================================
// The AoE panel's From spell: a spell from the campaign's Spell Library
// fills the template's shape and size, and the area's look and label. A
// spell without an area is listed greyed, so a search for it says why.
// ============================================

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCampaignSpellsQuery } from '@/hooks/queries';
import { areaInWords, levelInWords, spellAoE, type SpellAoE } from '@/utils/spells';

/** How many matches the list shows at once; a search narrows the rest. */
const SHOWN = 40;

export default function SpellAreaPicker({ campaignId, onPick }: { campaignId: string; onPick: (aoe: SpellAoE) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const spells = useCampaignSpellsQuery(open ? campaignId : null);

  const matches = useMemo(() => {
    const wanted = search.trim().toLowerCase();
    return (spells.data ?? []).filter((s) => (!wanted || s.name.toLowerCase().includes(wanted)) && (level === '' || s.level === Number(level)));
  }, [spells.data, search, level]);

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="touch-target inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:text-brand-ink/80"
      >
        {open ? <ChevronDown className="w-3 h-3" aria-hidden="true" /> : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
        From spell…
      </button>
      {open && (
        <>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Spell name"
            aria-label="Spell name"
            className="w-full input-cozy text-sm py-1"
          />
          <select aria-label="Spell level" value={level} onChange={(e) => setLevel(e.target.value)} className="w-full input-cozy text-sm py-1">
            <option value="">All levels</option>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => <option key={l} value={l}>{levelInWords(l)}</option>)}
          </select>
          {spells.isLoading && <p className="text-xs text-stone-gray">Loading spells...</p>}
          {spells.isSuccess && matches.length === 0 && <p className="text-xs text-stone-gray">No spell of that name.</p>}
          <ul aria-label="Spells" className="max-h-48 overflow-y-auto overscroll-contain space-y-0.5">
            {matches.slice(0, SHOWN).map((spell) => {
              const aoe = spellAoE(spell);
              return (
                <li key={spell.id}>
                  <button
                    type="button"
                    disabled={!aoe}
                    onClick={() => aoe && onPick(aoe)}
                    className="touch-target w-full text-left px-2 py-1 rounded-sm text-xs hover:bg-moss-green/10 disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <span className="block font-medium text-ink">{spell.name}</span>
                    <span className="block text-ink-muted">{spell.area ? areaInWords(spell.area) : 'no area'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
