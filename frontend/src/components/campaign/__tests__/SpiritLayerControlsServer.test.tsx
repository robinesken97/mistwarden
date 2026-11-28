/**
 * The spirit layer panel shows what the server holds.
 *
 * Opening the veil marked the spirit realm open on the GM's page at once,
 * before the server had answered, so a refused switch (a dropped connection,
 * the flood ceiling) left the GM's page saying the players could cross while
 * they could not. A refused style change left the new style picked, though
 * the table kept the old one. The switch now waits for the server's
 * broadcast, and a refused style puts the picker back.
 */

import { it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { radio } from '@/test/railCards';
import userEvent from '@testing-library/user-event';
import { useGameStore } from '@/stores/gameStore';
import { TokenLayer, type Token } from '@/types';

vi.mock('framer-motion', () => {
  const MotionDiv = (props: Record<string, unknown>) => {
    const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>;
    const plain = Object.fromEntries(Object.entries(rest).filter(([k]) => !/^(initial|animate|exit|transition|layout|whileHover|whileTap)$/.test(k)));
    return <div {...(plain as Record<string, unknown>)}>{children as never}</div>;
  };
  return {
    useReducedMotionConfig: () => false,
    useIsPresent: () => true,
    motion: new Proxy({}, { get: () => MotionDiv }),
    AnimatePresence: ({ children }: { children?: unknown }) => <>{children as never}</>,
  };
});

const updateCampaignSpiritLayer = vi.fn();
const veil = vi.hoisted(() => ({ open: false }));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({
    campaign: { id: 'campaign-1', spiritLayerEnabled: veil.open, spiritLayerStyle: 'wispy' },
    // The table on another map than the one on screen.
    currentMap: { id: 'map-table' },
    viewedMap: { id: 'map-1' },
    updateCampaignSpiritLayer,
    gmViewBothPlanes: true,
    setGmViewBothPlanes: vi.fn(),
  }),
}));
const emitSpiritLayerToggle = vi.fn();
const emitSpiritLayerStyleChange = vi.fn();
const emitSpiritLayerTokenToggle = vi.fn();
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocket: () => ({ socket: { emitSpiritLayerToggle, emitSpiritLayerStyleChange, emitSpiritLayerTokenToggle } }),
}));
const updateCampaign = vi.fn();
vi.mock('@/services/campaign.service', () => ({ default: { updateCampaign: (...a: unknown[]) => updateCampaign(...a) } }));

import SpiritLayerControls from '../SpiritLayerControls';

beforeEach(() => {
  vi.clearAllMocks();
  veil.open = false;
});

it('asks the server to open the veil and leaves the page as it is until the server says so', async () => {
  render(<SpiritLayerControls spiritTokensShown onSpiritTokensShownChange={() => {}} />);
  await userEvent.click(radio('Spirit realm', 'Open'));

  expect(emitSpiritLayerToggle).toHaveBeenCalledWith({ visible: true });
  expect(updateCampaignSpiritLayer).not.toHaveBeenCalled();
  expect(radio('Spirit realm', 'Closed')).toHaveAttribute('aria-checked', 'true');
  // It waits for the server's answer before it can be pressed again.
  expect(radio('Spirit realm', 'Open')).toBeDisabled();
});

it('puts the style back when the server refuses it', async () => {
  updateCampaign.mockRejectedValue({ response: { status: 400, data: { message: 'Invalid spirit layer style' } } });
  render(<SpiritLayerControls spiritTokensShown onSpiritTokensShownChange={() => {}} />);
  const atmosphere = screen.getByRole('combobox', { name: 'Atmosphere' });
  fireEvent.change(atmosphere, { target: { value: 'shadow' } });

  expect(await screen.findByText('Invalid spirit layer style')).toBeInTheDocument();
  await waitFor(() => expect(atmosphere).toHaveValue('wispy'));
  expect(emitSpiritLayerStyleChange).not.toHaveBeenCalled();
});

// The save's answer put the veil back to how it was when the save began: a
// veil opened by the server meanwhile showed closed again on the GM's page.
it('keeps a veil opened while a style was being saved', async () => {
  let answer: () => void = () => {};
  updateCampaign.mockReturnValue(new Promise<void>((resolve) => { answer = resolve; }));
  const { rerender } = render(<SpiritLayerControls spiritTokensShown onSpiritTokensShownChange={() => {}} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Atmosphere' }), { target: { value: 'shadow' } });

  veil.open = true;
  rerender(<SpiritLayerControls spiritTokensShown onSpiritTokensShownChange={() => {}} />);
  await act(async () => { answer(); });
  expect(updateCampaignSpiritLayer).toHaveBeenLastCalledWith(true, 'shadow');
});

it('sets this screen\'s spirit tokens from its two segments', async () => {
  const onSpiritTokensShownChange = vi.fn();
  render(<SpiritLayerControls spiritTokensShown onSpiritTokensShownChange={onSpiritTokensShownChange} />);
  await userEvent.click(radio('Spirit tokens', 'Hidden'));
  expect(onSpiritTokensShownChange).toHaveBeenCalledWith(false);
});

// A GM preparing a map shows or hides a spirit token of that map, not of the
// table's.
it("toggles a spirit token of the map on screen", async () => {
  useGameStore.getState().setTokens([{
    id: 'shade', name: 'Shade', imageUrl: '', position: { x: 1, y: 1 }, size: { width: 1, height: 1 },
    layer: TokenLayer.SPIRIT, visible: false, controlledBy: null, rotation: 0, conditions: [], metadata: {},
  } as unknown as Token], 'map-1');
  render(<SpiritLayerControls spiritTokensShown onSpiritTokensShownChange={() => {}} />);
  expect(screen.getByText('Spirits in the realm (1)')).toBeInTheDocument();
  await userEvent.click(radio('Shade', 'Shown'));
  expect(emitSpiritLayerTokenToggle).toHaveBeenCalledWith('map-1', 'shade', true);
});
