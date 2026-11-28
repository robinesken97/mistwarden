/**
 * Importing spells from Markdown, in the Spell Library: offered to an
 * administrator only, a dry run's report shown row by row, and an imported
 * spell shown with its tag, without Edit or Delete (the server refuses
 * both), and to a player without its description.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SpellLibrary from '../SpellLibrary';
import type { SpellSummary } from '@/types/spells';

const role = vi.hoisted(() => ({ current: 'PLAYER' }));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ campaign: { id: 'campaign-1' }, userRole: role.current }),
}));

const api = vi.hoisted(() => ({
  listCampaignSpells: vi.fn(),
  getSpellSeedStatus: vi.fn(),
  getCampaignSpell: vi.fn(),
  importSpellMarkdown: vi.fn(),
  deleteImportedSpells: vi.fn(),
}));
vi.mock('@/services/api', () => ({ api, default: api }));

const imported: SpellSummary = {
  id: 's1', name: 'Frost Bloom', source: 'custom:homebrew', gameSystem: 'FIFTH_EDITION', campaignId: null, level: 2, school: 'Evocation',
  castingTime: '1 action', range: '90 feet', components: 'V, S', duration: 'Instantaneous', concentration: false, ritual: false,
  area: { shape: 'sphere', sizeFt: 10 }, element: 'cold',
};

function renderLibrary() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SpellLibrary isOpen onClose={() => {}} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  role.current = 'PLAYER';
  api.listCampaignSpells.mockResolvedValue([imported]);
});

describe('Import from Markdown', () => {
  it('is not offered to a GM who is not an administrator', async () => {
    role.current = 'GM';
    api.getSpellSeedStatus.mockResolvedValue({ srdCount: 0, seedInProgress: false, canSeed: false });
    renderLibrary();
    expect(await screen.findByText('Frost Bloom')).toBeInTheDocument();
    expect(screen.queryByText('Import from Markdown')).not.toBeInTheDocument();
  });

  it('runs a dry run for an administrator and shows each row of the report', async () => {
    api.getSpellSeedStatus.mockResolvedValue({ srdCount: 0, seedInProgress: false, canSeed: true });
    api.importSpellMarkdown.mockResolvedValue({
      sourceTag: 'homebrew', dryRun: true, castingTimeLines: 1, counts: { imported: 1, updated: 0, skipped: 1, errors: 0 },
      rows: [
        { line: 1, name: 'Spell Lists', status: 'skipped', reason: 'No Casting Time: not a spell' },
        { line: 3, name: 'Frost Bloom', status: 'imported', warnings: [] },
      ],
    });
    renderLibrary();
    await userEvent.click(await screen.findByText('Import from Markdown'));

    await userEvent.upload(screen.getByLabelText('Markdown files'), new File(['### Frost Bloom'], 'spells.md', { type: 'text/markdown' }));
    await userEvent.type(screen.getByLabelText('Source tag'), 'Homebrew');
    await userEvent.click(screen.getByRole('button', { name: 'Dry run' }));

    expect(api.importSpellMarkdown).toHaveBeenCalledWith({ markdown: '### Frost Bloom', sourceTag: 'homebrew', dryRun: true });
    expect(await screen.findByText(/Dry run, nothing stored: 1 imported, 0 updated, 1 skipped, 0 refused \(1 Casting Time line\)/)).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Spell Lists')).toBeInTheDocument();
    expect(within(table).getByText('No Casting Time: not a spell')).toBeInTheDocument();
  });
});

describe('an imported spell', () => {
  it('shows with its tag, without Edit or Delete for an administrator', async () => {
    api.getSpellSeedStatus.mockResolvedValue({ srdCount: 0, seedInProgress: false, canSeed: true });
    api.getCampaignSpell.mockResolvedValue({ ...imported, description: 'Frost bursts.', createdById: null, createdAt: '', updatedAt: '' });
    renderLibrary();
    expect(await screen.findByText('homebrew')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Frost Bloom'));
    expect(await screen.findByText('Frost bursts.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete$/ })).not.toBeInTheDocument();
  });

  it('tells a player its description is the GM\'s', async () => {
    api.getSpellSeedStatus.mockResolvedValue({ srdCount: 0, seedInProgress: false, canSeed: false });
    api.getCampaignSpell.mockResolvedValue({ ...imported, description: null, createdById: null, createdAt: '', updatedAt: '' });
    renderLibrary();
    await userEvent.click(await screen.findByText('Frost Bloom'));
    expect(await screen.findByText('Description available to the GM')).toBeInTheDocument();
    expect(screen.getByText('90 feet')).toBeInTheDocument();
  });
});
