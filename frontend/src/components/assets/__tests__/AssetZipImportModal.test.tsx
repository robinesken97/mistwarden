// Added for Mistwarden on 2026-11-27.
/**
 * The ZIP import dialog sends the archive with the choices made, follows the
 * import's progress and shows what was imported, skipped and already there.
 * Campaign is offered only for campaigns the user runs: a player imports
 * nothing into a campaign's library.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AssetZipImportModal from '../AssetZipImportModal';
import type { AssetZipImportJob, Campaign } from '@/types';

let campaigns: Campaign[] = [];
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', platformRole: 'USER', globalAssetManager: false } }) }));
vi.mock('@/services/campaign.service', () => ({ default: { getCampaigns: () => Promise.resolve(campaigns) } }));
const importAssetZip = vi.fn();
const getAssetZipImport = vi.fn();
vi.mock('@/services/api', () => ({
  api: {
    importAssetZip: (form: FormData, onProgress?: (percent: number) => void) => importAssetZip(form, onProgress),
    getAssetZipImport: (id: string) => getAssetZipImport(id),
  },
}));

const campaign = (id: string, userRole: 'GM' | 'PLAYER') =>
  ({ id, name: `Campaign ${id}`, ownerId: 'someone-else', userRole, memberships: [] }) as unknown as Campaign;

const job = (over: Partial<AssetZipImportJob>): AssetZipImportJob => ({
  id: 'job-1', status: 'running', total: 3, processed: 0, imported: [], skipped: [], skippedCount: 0, duplicates: [], duplicateCount: 0, ...over,
});

beforeEach(() => {
  campaigns = [];
  importAssetZip.mockReset();
  getAssetZipImport.mockReset();
});

function chooseZip() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['zip'], 'tokens.zip', { type: 'application/zip' })] } });
}

describe('the ZIP import dialog', () => {
  it('offers Campaign only for a campaign the user runs', async () => {
    campaigns = [campaign('played', 'PLAYER')];
    const { unmount } = render(<AssetZipImportModal isOpen onClose={() => undefined} onImported={() => undefined} />);
    expect(await screen.findByRole('button', { name: 'Personal' })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('button', { name: 'Campaign' })).not.toBeInTheDocument();
    unmount();

    campaigns = [campaign('run', 'GM')];
    render(<AssetZipImportModal isOpen onClose={() => undefined} onImported={() => undefined} />);
    expect(await screen.findByRole('button', { name: 'Campaign' })).toBeInTheDocument();
  });

  it('sends the choices before the file, follows the progress and shows the outcome', async () => {
    campaigns = [campaign('run', 'GM')];
    const onImported = vi.fn();
    importAssetZip.mockResolvedValue({ job: job({}) });
    getAssetZipImport.mockResolvedValue({
      job: job({
        status: 'done',
        processed: 3,
        imported: [{ id: 'a', name: 'brown horse' }],
        skipped: [{ file: 'readme.txt', reason: 'Not a picture this kind of asset can be (.png).' }],
        skippedCount: 1,
        duplicates: ['wolf.png'],
        duplicateCount: 1,
      }),
    });
    render(<AssetZipImportModal isOpen onClose={() => undefined} onImported={onImported} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Campaign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Maps' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import duplicates too' }));
    fireEvent.change(screen.getByLabelText(/Extra tags/), { target: { value: 'Pack' } });
    chooseZip();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(importAssetZip).toHaveBeenCalled());
    const form = importAssetZip.mock.calls[0][0] as FormData;
    expect([...form.keys()]).toEqual(['type', 'scope', 'campaignId', 'tags', 'dropTopFolder', 'allowDuplicates', 'file']);
    expect(Object.fromEntries([...form.entries()].filter(([k]) => k !== 'file'))).toEqual({
      type: 'MAP', scope: 'CAMPAIGN', campaignId: 'run', tags: 'Pack', dropTopFolder: 'true', allowDuplicates: 'true',
    });

    expect(await screen.findByText('1 imported, 1 already in the library, 1 skipped', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(getAssetZipImport).toHaveBeenCalledWith('job-1');
    expect(onImported).toHaveBeenCalled();
    expect(screen.getByText('readme.txt')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it("shows the server's refusal", async () => {
    importAssetZip.mockRejectedValue({ response: { status: 400, data: { message: 'The file is not a ZIP archive, or it is damaged.' } } });
    render(<AssetZipImportModal isOpen onClose={() => undefined} onImported={() => undefined} />);
    chooseZip();
    fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is not a ZIP archive, or it is damaged.');
  });
});
