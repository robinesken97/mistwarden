/**
 * The SRD 5.1 credit in the Spell Library, which its CC BY 4.0 licence asks
 * for wherever the material is shown: at the foot of the library whenever it
 * may list an SRD spell, word for word, with the line saying CozyVTT changed it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SpellLibrary from '../SpellLibrary';
import type { SpellSummary } from '@/types/spells';
import { SRD_ATTRIBUTION, SRD_MODIFIED } from '@/constants/gameContentNotices';

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ campaign: { id: 'campaign-1' }, userRole: 'PLAYER' }),
}));

const api = vi.hoisted(() => ({
  listCampaignSpells: vi.fn(),
  getSpellSeedStatus: vi.fn(),
  getCampaignSpell: vi.fn(),
}));
vi.mock('@/services/api', () => ({ api, default: api }));

function spell(over: Partial<SpellSummary>): SpellSummary {
  return {
    id: 's1', name: 'Ember Rain', source: 'custom', gameSystem: null, campaignId: 'campaign-1', level: 2, school: null,
    castingTime: null, range: null, components: null, duration: null, concentration: false, ritual: false,
    area: null, element: 'none', ...over,
  };
}

function renderLibrary() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SpellLibrary isOpen onClose={() => {}} /></QueryClientProvider>);
}

const CREDIT = /System Reference Document 5\.1/;

beforeEach(() => vi.clearAllMocks());

describe('the SRD credit in the Spell Library', () => {
  it('shows while the library lists an SRD spell, with the line saying CozyVTT changed it', async () => {
    api.listCampaignSpells.mockResolvedValue([spell({}), spell({ id: 'srd1', name: 'Fireball', source: 'srd', campaignId: null, level: 3 })]);
    api.getSpellSeedStatus.mockResolvedValue({ srdCount: 319, seedInProgress: false, canSeed: false });
    renderLibrary();

    expect(await screen.findByText('Fireball')).toBeInTheDocument();
    expect(screen.getByText(CREDIT).textContent).toBe(SRD_ATTRIBUTION);
    expect(screen.getByText(SRD_MODIFIED)).toHaveClass('text-xs', 'text-ink-muted');
  });

  it('is not shown while the server holds no SRD spell', async () => {
    api.listCampaignSpells.mockResolvedValue([spell({})]);
    api.getSpellSeedStatus.mockResolvedValue({ srdCount: 0, seedInProgress: false, canSeed: false });
    renderLibrary();

    expect(await screen.findByText('Ember Rain')).toBeInTheDocument();
    expect(screen.queryByText(CREDIT)).not.toBeInTheDocument();
  });

  it('offers a player neither a new spell nor the import, and tells them who imports', async () => {
    api.listCampaignSpells.mockResolvedValue([]);
    api.getSpellSeedStatus.mockResolvedValue({ srdCount: 0, seedInProgress: false, canSeed: false });
    renderLibrary();

    expect(await screen.findByText(/An administrator can import the SRD spells/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New spell/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import SRD spells/ })).not.toBeInTheDocument();
  });
});
