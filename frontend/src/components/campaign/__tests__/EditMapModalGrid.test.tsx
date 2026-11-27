/**
 * Edit Map's grid: Apply on a detected grid sets its size between whole
 * pixels and where its lines start, and a hex grid hides what only squares
 * have, the diagonal rule and the detection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Asset, CampaignMap, UpdateMapRequest } from '@/types';

const updateMap = vi.fn();
vi.mock('@/services/map.service', () => ({
  default: { getMap: vi.fn(), updateMap: (...a: unknown[]) => updateMap(...a) },
}));
vi.mock('@/services/api', () => {
  const client = { getAssetUrl: (id: string) => `/api/assets/maps/${id}`, getAssetThumbnailUrl: (id: string) => `/api/assets/maps/${id}/thumbnail` };
  return { api: client, default: client };
});
// A 1408 by 1056 picture of 70.4 px squares whose lines start 40 px from the left and 12 from the top.
vi.mock('@/utils/detectMapGrid', () => ({
  detectMapGrid: vi.fn().mockResolvedValue({
    gridSize: 70.4, period: 70.4, width: 20, height: 15, offsetX: 40, offsetY: 12, confidence: 0.9, imageWidth: 1408, imageHeight: 1056,
  }),
}));
vi.mock('@/components/assets/AssetPicker', () => ({
  default: ({ label, onSelect }: { label: string; onSelect: (a: Asset | null) => void }) => (
    <button type="button" onClick={() => onSelect({ id: 'new-picture' } as Asset)}>{`Pick ${label}`}</button>
  ),
}));

import EditMapModal from '../EditMapModal';

const map = {
  id: 'map-1', name: 'Crossing', imageUrl: '/api/assets/maps/old-picture', width: 20, height: 15, gridSize: 50,
  feetPerSquare: 5, diagonalRule: 'flat', lightingEnabled: false, fogEnabled: true, globalIllumination: true, explorationEnabled: true,
  spiritLayerUrl: null,
} as unknown as CampaignMap;

function sent(): UpdateMapRequest {
  expect(updateMap).toHaveBeenCalledTimes(1);
  return updateMap.mock.calls[0][2] as UpdateMapRequest;
}

beforeEach(() => {
  updateMap.mockReset().mockImplementation(async (_c: string, _id: string, data: UpdateMapRequest) => ({ ...map, ...data }));
});

describe('Edit Map grid', () => {
  it('applies a detected grid with its size and its offset, brought within half a square', async () => {
    render(<EditMapModal isOpen map={map} campaignId="c" onClose={vi.fn()} onUpdated={vi.fn()} />);
    fireEvent.click(screen.getByText('Pick Map Image'));
    fireEvent.click(await screen.findByText('Apply'));
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(updateMap).toHaveBeenCalled());
    expect(sent()).toMatchObject({ imageUrl: 'new-picture', gridSize: 70.4, gridOffsetX: -30.4, gridOffsetY: 12 });
  });

  it('sends a hex grid, and has no diagonal rule or detected squares for it', async () => {
    render(<EditMapModal isOpen map={map} campaignId="c" onClose={vi.fn()} onUpdated={vi.fn()} />);
    expect(screen.getByText('Diagonal Movement')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hexes, point up' }));
    expect(screen.queryByText('Diagonal Movement')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Pick Map Image'));
    await waitFor(() => expect(screen.queryByText('Analysing…')).not.toBeInTheDocument());
    expect(screen.queryByText('Grid detected')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(updateMap).toHaveBeenCalled());
    expect(sent()).toMatchObject({ gridType: 'hexPointy' });
    expect(sent()).not.toHaveProperty('gridOffsetX');
  });

  it('takes an offset typed over another one character by character', async () => {
    render(<EditMapModal isOpen map={{ ...map, gridOffsetX: 30 } as CampaignMap} campaignId="c" onClose={vi.fn()} onUpdated={vi.fn()} />);
    const box = screen.getByLabelText('X') as HTMLInputElement;
    for (const typed of ['', '-', '-1', '-12', '-12.', '-12.5']) fireEvent.change(box, { target: { value: typed } });
    expect(box.value).toBe('-12.5');
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(updateMap).toHaveBeenCalled());
    expect(sent()).toEqual({ gridOffsetX: -12.5 });
  });
});
