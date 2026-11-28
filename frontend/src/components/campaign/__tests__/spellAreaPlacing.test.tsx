/**
 * Placing a spell's area from the Spell Library: the AoE panel's From
 * spell fills the template from a spell with an area and lists one without
 * greyed; a sheet's Place area shows only on the campaign page with a map,
 * for a spell whose name the library knows with an area, and opens the map's
 * AoE tool with it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import SpellAreaPicker from '../map/SpellAreaPicker';
import { PlaceSpellArea } from '@/components/character-sheets/fifth-edition/components/PlaceSpellArea';
import { PLACE_SPELL_AREA_EVENT, SpellAreaCampaign, type SpellAoE } from '@/utils/spells';
import type { SpellSummary } from '@/types/spells';

const api = vi.hoisted(() => ({ listCampaignSpells: vi.fn() }));
vi.mock('@/services/api', () => ({ api, default: api }));

function spell(over: Partial<SpellSummary>): SpellSummary {
  return {
    id: 'x', name: 'X', source: 'srd', gameSystem: null, campaignId: null, level: 3, school: 'Evocation', castingTime: null,
    range: null, components: null, duration: null, concentration: false, ritual: false, area: null, element: 'none', ...over,
  };
}

const SPELLS = [
  spell({ id: 'cone', name: 'Cone of Cold', level: 5, area: { shape: 'cone', sizeFt: 60 }, element: 'cold' }),
  spell({ id: 'srd-ball', name: 'Fireball', area: { shape: 'sphere', sizeFt: 20 }, element: 'fire' }),
  spell({ id: 'our-ball', name: 'Fireball', source: 'custom', campaignId: 'c1', area: { shape: 'sphere', sizeFt: 30 }, element: 'fire' }),
  spell({ id: 'missile', name: 'Magic Missile', level: 1 }),
];

function wrap(children: ReactNode, campaignId: string | null = 'c1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SpellAreaCampaign.Provider value={campaignId}>{children}</SpellAreaCampaign.Provider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listCampaignSpells.mockResolvedValue(SPELLS);
});

describe('From spell in the AoE panel', () => {
  it('gives an imported spell with no area the area and look of the SRD spell of its name', async () => {
    api.listCampaignSpells.mockResolvedValue([
      spell({ id: 'imp-gale', name: 'Glass Gale', source: 'custom:homebrew' }),
      spell({ id: 'srd-gale', name: 'Glass Gale', area: { shape: 'cone', sizeFt: 30 }, element: 'cold' }),
    ]);
    const onPick = vi.fn<(aoe: SpellAoE) => void>();
    wrap(<SpellAreaPicker campaignId="c1" onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: /From spell/ }));
    const [imported] = await screen.findAllByRole('button', { name: /Glass Gale/ });
    await userEvent.click(imported);
    expect(onPick).toHaveBeenCalledWith({ config: { shape: 'cone', sizeFt: 30 }, element: 'cold', label: 'Glass Gale', spellId: 'imp-gale' });
  });

  it('fills the template, look and label from a cone spell, and greys a spell with no area', async () => {
    const onPick = vi.fn<(aoe: SpellAoE) => void>();
    wrap(<SpellAreaPicker campaignId="c1" onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: /From spell/ }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Spell name' }), 'cone');
    await userEvent.click(await screen.findByRole('button', { name: /Cone of Cold/ }));
    expect(onPick).toHaveBeenCalledWith({ config: { shape: 'cone', sizeFt: 60 }, element: 'cold', label: 'Cone of Cold', spellId: 'cone' });

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Spell name' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Spell name' }), 'missile');
    const missile = await screen.findByRole('button', { name: /Magic Missile/ });
    expect(missile).toBeDisabled();
    expect(missile).toHaveTextContent('no area');
  });

  it('narrows the list by level', async () => {
    wrap(<SpellAreaPicker campaignId="c1" onPick={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /From spell/ }));
    await screen.findByRole('button', { name: /Cone of Cold/ });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Spell level' }), '5');
    expect(screen.getByRole('button', { name: /Cone of Cold/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Magic Missile/ })).not.toBeInTheDocument();
  });
});

describe('Place area on a sheet', () => {
  it('shows for a spell the library knows with an area, and places the campaign\'s own of that name', async () => {
    const placed = vi.fn();
    window.addEventListener(PLACE_SPELL_AREA_EVENT, placed);
    wrap(<PlaceSpellArea name="fireball" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Place area of fireball' }));
    window.removeEventListener(PLACE_SPELL_AREA_EVENT, placed);
    expect((placed.mock.calls[0][0] as CustomEvent<SpellAoE>).detail).toMatchObject({ spellId: 'our-ball', config: { shape: 'sphere', sizeFt: 30 } });
  });

  it('is not shown for a spell without an area, nor one the library does not know', async () => {
    // Fireball's button says the list has arrived.
    wrap(<><PlaceSpellArea name="Magic Missile" /><PlaceSpellArea name="Eldritch Whisper" /><PlaceSpellArea name="Fireball" /></>);
    await screen.findByRole('button', { name: 'Place area of Fireball' });
    expect(screen.getAllByRole('button', { name: /Place area/ })).toHaveLength(1);
  });

  it('is not shown away from a campaign\'s map, and asks for no spells there', async () => {
    wrap(<PlaceSpellArea name="Fireball" />, null);
    expect(screen.queryByRole('button', { name: /Place area/ })).not.toBeInTheDocument();
    expect(api.listCampaignSpells).not.toHaveBeenCalled();
  });
});
