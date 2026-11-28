// ============================================
// The Spell Library's spells, as the library, the AoE tool's From spell and
// a character sheet's Place area use them.
// ============================================

import { createContext } from 'react';
import type { AoEConfig } from '@/components/campaign/map/layers';
import type { AreaElement } from '@/constants/areaLimits';
import type { SpellArea, SpellSummary } from '@/types/spells';

/**
 * Whose spell it is, from the most particular: a campaign's own, the
 * server's own, the server's imported from Markdown (source custom:<tag>),
 * the SRD's.
 */
export type SpellScopeName = 'campaign' | 'instance' | 'imported' | 'srd';

export const IMPORTED_SPELL_PREFIX = 'custom:';

export function spellScope(spell: Pick<SpellSummary, 'source' | 'campaignId'>): SpellScopeName {
  if (spell.campaignId) return 'campaign';
  if (spell.source === 'srd') return 'srd';
  return spell.source.startsWith(IMPORTED_SPELL_PREFIX) ? 'imported' : 'instance';
}

export const SPELL_SCOPE_LABELS: Record<SpellScopeName, string> = {
  campaign: 'Campaign',
  instance: 'Server',
  imported: 'Imported',
  srd: 'SRD 5.1',
};

const PRECEDENCE: Record<SpellScopeName, number> = { campaign: 0, instance: 1, imported: 2, srd: 3 };

type Resolvable = Pick<SpellSummary, 'name' | 'source' | 'campaignId'> & Partial<Pick<SpellSummary, 'area' | 'element'>>;

const nameKey = (name: string) => String(name ?? '').trim().toLowerCase();
const rank = (spell: Resolvable) => PRECEDENCE[spellScope(spell)];

/**
 * The spell a name means, matched in any case and ignoring spaces at
 * either end: where several share it, the campaign's own, then the
 * server's, then the server's imported, then the SRD's; among equals the
 * first listed (the server lists by name, source, id). Null when none has it.
 * With no area of its own it takes one from below (withFallbackArea).
 */
export function resolveSpellByName<T extends Resolvable>(spells: readonly T[], name: string): T | null {
  const wanted = nameKey(name);
  if (!wanted) return null;
  let best: T | null = null;
  for (const spell of spells) {
    if (nameKey(spell.name) !== wanted) continue;
    if (!best || rank(spell) < rank(best)) best = spell;
  }
  return best && withFallbackArea(best, spells);
}

/**
 * The spell as it is placed: one with no area takes the area of the most
 * particular spell of its name below it that has one (an imported summary
 * that names none, over the SRD's that does), and that one's look where it
 * has none of its own. The stored spells stay as they are.
 */
export function withFallbackArea<T extends Resolvable>(spell: T, spells: readonly T[]): T {
  if (spell.area) return spell;
  let donor: T | null = null;
  for (const other of spells) {
    if (!other.area || nameKey(other.name) !== nameKey(spell.name) || rank(other) <= rank(spell)) continue;
    if (!donor || rank(other) < rank(donor)) donor = other;
  }
  if (!donor) return spell;
  return { ...spell, area: donor.area, element: spell.element && spell.element !== 'none' ? spell.element : donor.element };
}

/** "20 ft. sphere", "100 × 5 ft. line": an area in words. */
export function areaInWords(area: SpellArea): string {
  const shape = area.shape === 'sphere' ? 'radius' : area.shape === 'cylinder' ? 'radius cylinder' : area.shape;
  return area.shape === 'line' ? `${area.sizeFt} × ${area.widthFt ?? 5} ft. line` : `${area.sizeFt} ft. ${shape}`;
}

/** "Cantrip", "Level 3". */
export const levelInWords = (level: number) => (level === 0 ? 'Cantrip' : `Level ${level}`);

/** What the AoE panel takes from a spell: its template, its look, its name as the label, and the spell it came from. */
export interface SpellAoE {
  config: AoEConfig;
  element: AreaElement;
  label: string;
  spellId: string;
}

/** The AoE panel's settings for a spell with an area; null for one without. */
export function spellAoE(spell: Pick<SpellSummary, 'id' | 'name' | 'area' | 'element'>): SpellAoE | null {
  if (!spell.area) return null;
  const { shape, sizeFt, widthFt } = spell.area;
  return {
    config: shape === 'line' ? { shape, sizeFt, widthFt: widthFt ?? 5 } : { shape, sizeFt },
    element: spell.element,
    label: spell.name,
    spellId: spell.id,
  };
}

/** Sent on `window` by a sheet's Place area: the map's AoE tool opens with it (detail: SpellAoE). */
export const PLACE_SPELL_AREA_EVENT = 'mistwarden:place-spell-area';

export function requestSpellArea(aoe: SpellAoE): void {
  window.dispatchEvent(new CustomEvent<SpellAoE>(PLACE_SPELL_AREA_EVENT, { detail: aoe }));
}

/**
 * The campaign whose map a sheet's Place area places on, while the campaign
 * page shows one; null anywhere else (the Characters page), where the button
 * is not shown.
 */
export const SpellAreaCampaign = createContext<string | null>(null);
