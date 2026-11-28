/**
 * GM tools' Fog tab: the scene's switch, the tools while it is on, and the
 * bulk actions that ask twice.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GmFogControls, { type FogToolMode } from '../GmFogControls';
import type { FogShape } from '../map/tools/useFogTool';
import { choose, radio } from '@/test/railCards';

function renderTab(over: Partial<{ fogMode: FogToolMode; fogEnabled: boolean; fogShape: FogShape; onResetExploration: () => void }> = {}) {
  const props = {
    fogMode: null as FogToolMode,
    onFogModeChange: vi.fn(),
    onRevealAll: vi.fn(),
    onHideAll: vi.fn(),
    fogEnabled: true,
    onFogEnabledChange: vi.fn(),
    onFogShapeChange: vi.fn(),
    onBrushSquaresChange: vi.fn(),
    ...over,
  };
  render(<GmFogControls {...props} />);
  return props;
}
const checked = (group: string, name: string) => radio(group, name).getAttribute('aria-checked');

describe('GmFogControls', () => {
  it('offers the modes, shapes and bulk actions while fog is on', () => {
    renderTab();
    expect(checked('Fog', 'On')).toBe('true');
    expect(radio('Mode', 'Reveal')).toBeTruthy();
    expect(radio('Shape', 'Box')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reveal all' })).toBeTruthy();
  });

  it('replaces the tools with an explanation while fog is off', () => {
    renderTab({ fogEnabled: false });
    expect(checked('Fog', 'Off')).toBe('true');
    expect(screen.queryByRole('radiogroup', { name: 'Mode' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reveal all' })).toBeNull();
    expect(screen.getByText(/Fog is off/)).toBeTruthy();
  });

  it('turning fog off puts an armed tool down and reports the change', () => {
    const props = renderTab({ fogMode: 'fog-reveal' });
    choose('Fog', 'Off');
    expect(props.onFogModeChange).toHaveBeenCalledWith(null);
    expect(props.onFogEnabledChange).toHaveBeenCalledWith(false);
  });

  it('turning fog on reports the change and leaves the tool alone', () => {
    const props = renderTab({ fogEnabled: false });
    choose('Fog', 'On');
    expect(props.onFogEnabledChange).toHaveBeenCalledWith(true);
    expect(props.onFogModeChange).not.toHaveBeenCalled();
  });

  it('arms a mode, and a press on the armed one puts it down', () => {
    const props = renderTab({ fogMode: 'fog-reveal' });
    choose('Mode', 'Hide');
    expect(props.onFogModeChange).toHaveBeenLastCalledWith('fog-hide');
    choose('Mode', 'Reveal');
    expect(props.onFogModeChange).toHaveBeenLastCalledWith(null);
  });

  it('shows the help only while a mode is armed', () => {
    renderTab();
    expect(screen.queryByText(/Esc or right-drag cancels/)).toBeNull();
  });

  it('offers Brush size only with the brush, in squares', () => {
    renderTab();
    expect(screen.queryByRole('radiogroup', { name: 'Brush size' })).toBeNull();
  });

  it('sets the brush size in squares', () => {
    const props = renderTab({ fogShape: 'brush' });
    choose('Brush size', 'Large');
    expect(props.onBrushSquaresChange).toHaveBeenCalledWith(2);
  });

  it('reveals the whole map on the second press only', () => {
    const props = renderTab();
    const button = screen.getByRole('button', { name: 'Reveal all' });
    fireEvent.click(button);
    expect(props.onRevealAll).not.toHaveBeenCalled();
    expect(button.textContent).toBe('Confirm?');
    fireEvent.click(button);
    expect(props.onRevealAll).toHaveBeenCalledTimes(1);
  });

  it('offers to reset explored areas only when there is memory to forget', () => {
    renderTab();
    expect(screen.queryByRole('button', { name: 'Reset explored areas' })).toBeNull();
  });

  it('resets explored areas on the second press', () => {
    const onResetExploration = vi.fn();
    renderTab({ onResetExploration });
    const button = screen.getByRole('button', { name: 'Reset explored areas' });
    fireEvent.click(button);
    expect(onResetExploration).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onResetExploration).toHaveBeenCalledTimes(1);
  });
});
