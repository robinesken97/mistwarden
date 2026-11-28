import { describe, it, expect } from 'vitest';
import { areaInWords, resolveSpellByName, spellAoE, withFallbackArea } from '../spells';
import type { SpellArea } from '@/types/spells';
import type { AreaElement } from '@/constants/areaLimits';

const srd = { id: 'srd', name: 'Fireball', source: 'srd', campaignId: null };
const server = { id: 'server', name: 'fireball', source: 'custom', campaignId: null };
const campaign = { id: 'campaign', name: 'FIREBALL ', source: 'custom', campaignId: 'c1' };

describe('resolveSpellByName', () => {
  it('picks the campaign\'s own over the server\'s over the SRD\'s, in any case', () => {
    expect(resolveSpellByName([srd, server, campaign], ' Fireball')?.id).toBe('campaign');
    expect(resolveSpellByName([campaign, server, srd].slice(1), 'fireball')?.id).toBe('server');
    expect(resolveSpellByName([srd], 'FIREBALL')?.id).toBe('srd');
  });

  it('picks an imported spell over the SRD\'s, below the campaign\'s and the server\'s own, the first of two tags', () => {
    const imported = { id: 'imported', name: 'Fireball', source: 'custom:homebrew', campaignId: null };
    const other = { id: 'other', name: 'Fireball', source: 'custom:notes', campaignId: null };
    expect(resolveSpellByName([srd, imported, other], 'fireball')?.id).toBe('imported');
    expect(resolveSpellByName([imported, server], 'fireball')?.id).toBe('server');
    expect(resolveSpellByName([imported, campaign], 'fireball')?.id).toBe('campaign');
  });

  it('takes the area, and the look where it has none, of a spell of its name below it, leaving the rows as they are', () => {
    type Row = { id: string; name: string; source: string; campaignId: null; area: SpellArea | null; element: AreaElement };
    const cone: SpellArea = { shape: 'cone', sizeFt: 30 };
    const plain: Row = { id: 'imported', name: 'Glass Gale', source: 'custom:homebrew', campaignId: null, area: null, element: 'none' };
    const below: Row = { id: 'srd', name: 'glass gale', source: 'srd', campaignId: null, area: cone, element: 'cold' };
    const resolved = resolveSpellByName([plain, below], 'Glass Gale');
    expect(resolved).toMatchObject({ id: 'imported', area: cone, element: 'cold' });
    expect(plain.area).toBeNull();
    // Its own look stays; a spell above lends nothing; one with an area keeps it.
    expect(withFallbackArea<Row>({ ...plain, element: 'force' }, [below])).toMatchObject({ area: cone, element: 'force' });
    expect(withFallbackArea({ ...below, area: null }, [{ ...plain, area: cone }]).area).toBeNull();
    const own: SpellArea = { shape: 'sphere', sizeFt: 10 };
    expect(withFallbackArea({ ...plain, area: own }, [below]).area).toBe(own);
  });

  it('finds nothing for a name no spell has, or none at all', () => {
    expect(resolveSpellByName([srd], 'Fire Bolt')).toBeNull();
    expect(resolveSpellByName([srd], '  ')).toBeNull();
  });
});

describe('spellAoE', () => {
  it('fills the template, look and label from a spell with an area', () => {
    expect(spellAoE({ id: 's', name: 'Lightning Bolt', area: { shape: 'line', sizeFt: 100, widthFt: 5 }, element: 'lightning' }))
      .toEqual({ config: { shape: 'line', sizeFt: 100, widthFt: 5 }, element: 'lightning', label: 'Lightning Bolt', spellId: 's' });
    expect(spellAoE({ id: 's', name: 'Burning Hands', area: { shape: 'cone', sizeFt: 15 }, element: 'fire' })?.config)
      .toEqual({ shape: 'cone', sizeFt: 15 });
  });

  it('gives nothing for a spell without one', () => {
    expect(spellAoE({ id: 's', name: 'Magic Missile', area: null, element: 'none' })).toBeNull();
  });
});

describe('areaInWords', () => {
  it('names a radius, a line\'s width and the rest by their shape', () => {
    expect(areaInWords({ shape: 'sphere', sizeFt: 20 })).toBe('20 ft. radius');
    expect(areaInWords({ shape: 'line', sizeFt: 100, widthFt: 5 })).toBe('100 × 5 ft. line');
    expect(areaInWords({ shape: 'cone', sizeFt: 15 })).toBe('15 ft. cone');
  });
});
