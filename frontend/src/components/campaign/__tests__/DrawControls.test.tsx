/**
 * Draw's card body on its own: what it offers whom, and the user's player
 * colour first among the colours, where drawings and the laser start.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import DrawControls, { drawColourName, type DrawControlsProps } from '../DrawControls';
import { DEFAULT_DRAW_SETTINGS } from '../map/tools/useDrawTool';
import { choose, radio } from '@/test/railCards';

const SKY = '#45a8e0';

function panel(extra: Partial<DrawControlsProps> = {}) {
  const props: DrawControlsProps = {
    kind: 'pen', onKindChange: vi.fn(), settings: DEFAULT_DRAW_SETTINGS, onSettingsChange: vi.fn(), isGM: false,
    polygonCorners: 0, onPolygonDone: vi.fn(), onPolygonCancel: vi.fn(), clearable: 2, onClear: vi.fn(), onClose: vi.fn(),
    members: [], onClearMember: vi.fn(), playerColour: SKY,
    ...extra,
  };
  render(<DrawControls {...props} />);
  return props;
}

describe('the drawing tools', () => {
  it('offers the nine tools in a 3 by 3 grid, the one in use chosen', () => {
    const props = panel({ kind: 'arrow' });

    const names = ['Pen', 'Line', 'Arrow', 'Rectangle', 'Ellipse', 'Polygon', 'Text label', 'Eraser', 'Laser pointer'];
    for (const name of names) {
      expect(radio('Tool', name)).toHaveAttribute('aria-checked', name === 'Arrow' ? 'true' : 'false');
    }
    expect(screen.getByRole('radiogroup', { name: 'Tool' }).style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    choose('Tool', 'Ellipse');
    expect(props.onKindChange).toHaveBeenCalledWith('ellipse');
  });

  it("starts the colours with the user's own, named Your colour", () => {
    panel({ settings: { ...DEFAULT_DRAW_SETTINGS, color: SKY } });
    const swatches = screen.getAllByRole('radio').filter((r) => r.closest('[aria-label="Colour"]'));
    expect(swatches[0]).toHaveAccessibleName('Your colour');
    expect(swatches[0]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Your colour', { selector: 'b' })).toBeInTheDocument();
  });

  it('offers the eight colours by name and any other, and sets the one chosen', () => {
    const props = panel();

    choose('Colour', 'Green');
    expect(props.onSettingsChange).toHaveBeenCalledWith({ color: '#4caf6e' });
    expect(radio('Colour', 'Red')).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByLabelText('Pick a custom colour'), { target: { value: '#123456' } });
    expect(props.onSettingsChange).toHaveBeenCalledWith({ color: '#123456' });
  });

  it('names the colour chosen: the own, a named one, or Custom', () => {
    expect(drawColourName(SKY, SKY)).toBe('Your colour');
    expect(drawColourName('#4CAF6E', SKY)).toBe('Green');
    expect(drawColourName('#123456', SKY)).toBe('Custom');
  });

  it('offers Fill for the closed shapes only, and Snap for every shape', () => {
    panel({ kind: 'line' });
    expect(screen.getByRole('radiogroup', { name: 'Snap' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Fill' })).not.toBeInTheDocument();
  });

  it('sets Fill and Snap from their segments', () => {
    const props = panel({ kind: 'rect' });
    choose('Fill', 'Filled');
    expect(props.onSettingsChange).toHaveBeenCalledWith({ fill: true });
    choose('Snap', 'Off');
    expect(props.onSettingsChange).toHaveBeenCalledWith({ snap: false });
  });

  it('offers neither on the pen, and no width with the laser', () => {
    panel({ kind: 'laser' });
    expect(screen.queryByRole('radiogroup', { name: 'Snap' })).not.toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Width' })).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Colour' })).toBeInTheDocument();
  });

  it('offers a polygon’s Done once it has three corners, and Cancel', () => {
    const props = panel({ kind: 'polygon', polygonCorners: 2 });
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onPolygonCancel).toHaveBeenCalled();
  });
});

describe('who is offered what', () => {
  it('gives a player Clear mine, at once, and no Only I can see this', () => {
    const props = panel({ isGM: false });

    expect(screen.queryByRole('radiogroup', { name: 'Who sees it' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear mine' }));
    expect(props.onClear).toHaveBeenCalled();
  });

  it('turns Clear mine off with nothing to clear', () => {
    panel({ clearable: 0 });
    expect(screen.getByRole('button', { name: 'Clear mine' })).toBeDisabled();
  });

  // The laser pointer goes to everyone, so a box ticked for a secret note
  // must not seem to keep it to the GM.
  it('offers the GM no Only I can see this under the laser pointer, and says everyone sees it', () => {
    panel({ isGM: true, kind: 'laser', settings: { ...DEFAULT_DRAW_SETTINGS, gmOnly: true } });

    expect(screen.queryByRole('radiogroup', { name: 'Who sees it' })).not.toBeInTheDocument();
    expect(screen.getByText('Everyone sees the laser pointer.')).toBeInTheDocument();
  });

  it('gives the GM Only I can see this, and Clear drawings, which asks first and says how many', () => {
    const props = panel({ isGM: true, clearable: 3 });

    expect(screen.getByRole('radiogroup', { name: 'Who sees it' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear drawings' }));
    expect(props.onClear).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('3 drawings');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear drawings' }));
    expect(props.onClear).toHaveBeenCalled();
  });
});

// The GM tidies up after one player without losing anyone else's work.
describe('clearing one player’s drawings', () => {
  const members = [{ authorId: 'mara', name: 'Mara', count: 3 }, { authorId: 'tom', name: 'Tom', count: 1 }];

  it('lists each player with drawings on the map and how many, for the GM', () => {
    panel({ isGM: true, members });

    expect(screen.getByRole('button', { name: "Clear Mara's drawings (3)" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Clear Tom's drawings (1)" })).toBeInTheDocument();
  });

  it('asks first, naming the player and how many, and clears only theirs', () => {
    const props = panel({ isGM: true, members });

    fireEvent.click(screen.getByRole('button', { name: "Clear Mara's drawings (3)" }));
    expect(props.onClearMember).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Mara');
    expect(dialog).toHaveTextContent('3 drawings');
    fireEvent.click(within(dialog).getByRole('button', { name: "Clear Mara's drawings" }));

    expect(props.onClearMember).toHaveBeenCalledWith('mara');
    expect(props.onClear).not.toHaveBeenCalled();
  });

  it('is not offered to a player', () => {
    panel({ isGM: false, members });

    expect(screen.queryByRole('button', { name: /Clear Mara/ })).not.toBeInTheDocument();
  });
});
