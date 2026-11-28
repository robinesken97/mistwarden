/**
 * Importing stat blocks from Markdown, in the Creature Library: offered to
 * an administrator only, a dry run's report shown row by row, and an
 * imported creature shown with its tag and without Edit or Delete, which the
 * server refuses for a creature every campaign shares.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreatureLibrary from '../CreatureLibrary';

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ campaign: { id: 'campaign-1', gameSystem: null }, currentMap: null, viewedMap: null }),
}));
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({ socket: null }) }));
vi.mock('@/components/assets/AssetPicker', () => ({ default: () => null }));

const api = vi.hoisted(() => ({
  listCreatures: vi.fn(),
  getSeedStatus: vi.fn(),
  listCreatureFavorites: vi.fn(),
  importCreatureMarkdown: vi.fn(),
  deleteImportedCreatures: vi.fn(),
  matchCreatureTokenPictures: vi.fn(),
}));
vi.mock('@/services/api', () => ({ api, default: api }));

const imported = {
  id: 'c1', name: 'Moss Toad', gameSystem: 'FIFTH_EDITION', source: 'custom:notes', challengeRating: '1/4', creatureType: 'Small beast',
  alignment: 'unaligned', imageUrl: null, size: { width: 1, height: 1 }, disposition: 'hostile', displayMode: 'pog',
  createdById: null, campaignId: null, createdAt: '', updatedAt: '',
  statBlock: { ac: 12, hpMax: 11, speed: '30 ft.', abilities: { str: 10, dex: 10, con: 10, int: 3, wis: 10, cha: 5 } },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listCreatures.mockResolvedValue({ creatures: [imported], total: 1 });
  api.listCreatureFavorites.mockResolvedValue({ favoriteIds: [], creatures: [] });
});

describe('Import from Markdown', () => {
  it('is not offered to a GM who is not an administrator', async () => {
    api.getSeedStatus.mockResolvedValue({ srdCount: 1, customCount: 0, seedInProgress: false, canSeed: false });
    render(<CreatureLibrary isOpen onClose={() => {}} />);
    expect(await screen.findByText('Moss Toad')).toBeInTheDocument();
    expect(screen.queryByText('Import from Markdown')).not.toBeInTheDocument();
  });

  it('runs a dry run for an administrator and shows each row of the report', async () => {
    api.getSeedStatus.mockResolvedValue({ srdCount: 1, customCount: 0, seedInProgress: false, canSeed: true });
    api.importCreatureMarkdown.mockResolvedValue({
      sourceTag: 'notes', dryRun: true, armorClassLines: 1, counts: { imported: 1, updated: 0, skipped: 1, errors: 0 },
      rows: [
        { line: 3, name: 'Moss Toad', status: 'imported', warnings: [] },
        { line: 30, name: 'Swarm Template', status: 'skipped', reason: 'No Armor Class: not a stat block' },
      ],
    });
    render(<CreatureLibrary isOpen onClose={() => {}} />);
    await userEvent.click(await screen.findByText('Import from Markdown'));

    await userEvent.upload(screen.getByLabelText('Markdown files'), new File(['### Moss Toad'], 'notes.md', { type: 'text/markdown' }));
    await userEvent.type(screen.getByLabelText('Source tag'), 'Notes');
    await userEvent.type(screen.getByLabelText('Only under heading (optional)'), '## Checked');
    await userEvent.click(screen.getByRole('button', { name: 'Dry run' }));

    expect(api.importCreatureMarkdown).toHaveBeenCalledWith({ markdown: '### Moss Toad', sourceTag: 'notes', onlyUnderHeading: '## Checked', dryRun: true });
    expect(await screen.findByText(/Dry run, nothing stored: 1 imported, 0 updated, 1 skipped, 0 refused/)).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Swarm Template')).toBeInTheDocument();
    expect(within(table).getByText('No Armor Class: not a stat block')).toBeInTheDocument();
  });

  it('shows an imported creature with its tag, and without Edit or Delete', async () => {
    api.getSeedStatus.mockResolvedValue({ srdCount: 1, customCount: 0, seedInProgress: false, canSeed: false });
    render(<CreatureLibrary isOpen onClose={() => {}} />);
    await userEvent.click(await screen.findByText('Moss Toad'));
    expect(screen.getByText('notes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Duplicate/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Moss Toad' })).not.toBeInTheDocument();
  });
});
