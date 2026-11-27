// Added for Mistwarden on 2026-11-27.
/**
 * The GM shows a gallery picture to everyone or to chosen players, and a
 * player's pill with Everyone on takes that player out of everyone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GalleryPanel from '../GalleryPanel';
import type { GalleryPicture } from '@/types';

let role: 'GM' | 'PLAYER' = 'GM';
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({
    campaign: {
      id: 'c1',
      memberships: [
        { userId: 'gm', role: 'GM', user: { id: 'gm', displayName: 'Robin' } },
        { userId: 'p1', role: 'PLAYER', user: { id: 'p1', displayName: 'Ada' } },
        { userId: 'p2', role: 'PLAYER', user: { id: 'p2', displayName: 'Bo' } },
      ],
    },
    userRole: role,
  }),
}));
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({ socket: null }) }));
vi.mock('@/services/api', () => ({
  default: {
    listGallery: vi.fn(),
    updateGalleryPicture: vi.fn(),
    addGalleryPicture: vi.fn(),
    removeGalleryPicture: vi.fn(),
    uploadAsset: vi.fn(),
  },
}));

import api from '@/services/api';

const picture = (over: Partial<GalleryPicture> = {}): GalleryPicture => ({
  id: 'g1', assetId: 'a1', name: 'The crypt', folder: 'Act 1', shownToAll: false, shownTo: [],
  url: '/api/assets/maps/a1', thumbnailUrl: '/api/assets/maps/a1/thumbnail', updatedAt: '2026-11-27T00:00:00Z',
  ...over,
});

beforeEach(() => {
  vi.mocked(api.listGallery).mockReset();
  vi.mocked(api.updateGalleryPicture).mockReset().mockImplementation(async (_c, _id, body) => ({ picture: picture(body) }));
  role = 'GM';
});

describe('GalleryPanel for the GM', () => {
  it('files pictures under their folder and shows one to a chosen player', async () => {
    vi.mocked(api.listGallery).mockResolvedValue({ pictures: [picture()] });
    render(<GalleryPanel />);
    expect(await screen.findByText('Act 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ada' }));
    await waitFor(() => expect(api.updateGalleryPicture).toHaveBeenCalledWith('c1', 'g1', { shownToAll: false, shownTo: ['p1'] }));
  });

  it('takes a player out of everyone when Everyone is on', async () => {
    vi.mocked(api.listGallery).mockResolvedValue({ pictures: [picture({ shownToAll: true })] });
    render(<GalleryPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Bo' }));
    await waitFor(() => expect(api.updateGalleryPicture).toHaveBeenCalledWith('c1', 'g1', { shownToAll: false, shownTo: ['p1'] }));
  });

  it('turns Everyone on and clears the chosen players', async () => {
    vi.mocked(api.listGallery).mockResolvedValue({ pictures: [picture({ shownTo: ['p2'] })] });
    render(<GalleryPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Everyone' }));
    await waitFor(() => expect(api.updateGalleryPicture).toHaveBeenCalledWith('c1', 'g1', { shownToAll: true, shownTo: [] }));
  });
});

describe('GalleryPanel for a player', () => {
  it('lists the pictures shown to them, without the GM controls', async () => {
    role = 'PLAYER';
    vi.mocked(api.listGallery).mockResolvedValue({ pictures: [picture({ folder: undefined, shownTo: undefined, shownToAll: undefined })] });
    render(<GalleryPanel />);
    expect(await screen.findByText('The crypt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Everyone' })).toBeNull();
    expect(screen.queryByText('Add')).toBeNull();
  });
});
