/**
 * A sheet spell's Place area: shown where the campaign page shows a map
 * and the spell's name, in any case, is a library spell with an area (the
 * campaign's own first, then the server's, then the SRD's). It opens the
 * map's AoE tool filled from that spell. The sheet stores only the name.
 */

import { useContext } from 'react';
import { Target } from 'lucide-react';
import { useCampaignSpellsQuery } from '@/hooks/queries';
import { SpellAreaCampaign, requestSpellArea, resolveSpellByName, spellAoE } from '@/utils/spells';

export function PlaceSpellArea({ name }: { name: string }) {
  const campaignId = useContext(SpellAreaCampaign);
  return campaignId ? <PlaceSpellAreaIn campaignId={campaignId} name={name} /> : null;
}

function PlaceSpellAreaIn({ campaignId, name }: { campaignId: string; name: string }) {
  const spells = useCampaignSpellsQuery(campaignId);
  const spell = spells.data ? resolveSpellByName(spells.data, name) : null;
  const aoe = spell ? spellAoE(spell) : null;
  if (!aoe) return null;
  return (
    <button
      type="button"
      onClick={() => requestSpellArea(aoe)}
      aria-label={`Place area of ${name}`}
      className="touch-target inline-flex items-center justify-center gap-1 px-2 py-0.5 text-xs rounded-full border border-info/30 text-info-ink hover:bg-info/10 transition-colors"
    >
      <Target className="w-3 h-3" aria-hidden="true" /> Place area
    </button>
  );
}
