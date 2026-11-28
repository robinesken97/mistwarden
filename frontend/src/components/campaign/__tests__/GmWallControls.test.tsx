/**
 * GM tools' Walls tab: the modes, one Snap control in place of two boxes,
 * the colour grid and the clear that asks twice.
 */

import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GmWallControls, { type GmWallControlsProps } from '../GmWallControls';
import { choose, radio } from '@/test/railCards';

function renderTab(over: Partial<GmWallControlsProps> = {}) {
  const props: GmWallControlsProps = {
    wallMode: null,
    onWallModeChange: vi.fn(),
    wallType: 'wall',
    onWallTypeChange: vi.fn(),
    snapToGrid: true,
    onSnapToGridChange: vi.fn(),
    snapToEndpoint: false,
    onSnapToEndpointChange: vi.fn(),
    wallCount: 3,
    onClearAll: vi.fn(),
    wallColor: '#f97316',
    onWallColorChange: vi.fn(),
    ...over,
  };
  render(<GmWallControls {...props} />);
  return props;
}

it('arms a mode, and a press on the armed one puts it down', () => {
  const props = renderTab({ wallMode: 'wall-draw' });
  choose('Mode', 'Polygon');
  expect(props.onWallModeChange).toHaveBeenLastCalledWith('wall-polygon');
  choose('Mode', 'Draw');
  expect(props.onWallModeChange).toHaveBeenLastCalledWith(null);
});

it('shows Snap as one choice, grid winning over endpoints as the old boxes did', () => {
  renderTab({ snapToGrid: true, snapToEndpoint: true });
  expect(radio('Snap', 'Grid')).toHaveAttribute('aria-checked', 'true');
});

it('sets both old flags from one Snap choice', () => {
  const props = renderTab();
  choose('Snap', 'Endpoints');
  expect(props.onSnapToGridChange).toHaveBeenLastCalledWith(false);
  expect(props.onSnapToEndpointChange).toHaveBeenLastCalledWith(true);
  choose('Snap', 'Off');
  expect(props.onSnapToGridChange).toHaveBeenLastCalledWith(false);
  expect(props.onSnapToEndpointChange).toHaveBeenLastCalledWith(false);
});

it('offers the draw type only while a drawing mode is armed', () => {
  renderTab();
  expect(screen.queryByRole('combobox', { name: 'Draw type' })).toBeNull();
});

it('sets the draw type from its select', () => {
  const props = renderTab({ wallMode: 'wall-brush' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Draw type' }), { target: { value: 'door-closed' } });
  expect(props.onWallTypeChange).toHaveBeenCalledWith('door-closed');
});

it('picks a named colour, and takes a typed hex once it is whole', () => {
  const props = renderTab();
  choose('Colour', 'Red');
  expect(props.onWallColorChange).toHaveBeenLastCalledWith('#ef4444');
  const hex = screen.getByRole('textbox', { name: 'Custom colour hex code' });
  fireEvent.change(hex, { target: { value: '#12' } });
  expect(props.onWallColorChange).toHaveBeenCalledTimes(1);
  fireEvent.change(hex, { target: { value: '123ABC' } });
  expect(props.onWallColorChange).toHaveBeenLastCalledWith('#123abc');
});

it('clears all walls on the second press only', () => {
  const props = renderTab();
  const button = screen.getByRole('button', { name: 'Clear all (3)' });
  fireEvent.click(button);
  expect(props.onClearAll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm clear all?' }));
  expect(props.onClearAll).toHaveBeenCalledTimes(1);
});
