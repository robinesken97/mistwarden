/**
 * The token details card on its own: its close button and its place. What it shows for
 * whom is driven through MapCanvas (MapCanvasInput.test.tsx, "the card a
 * hovered token shows", and MapCanvasTouch.test.tsx, the selection's card).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TokenLayer, TokenType, type Token } from '@/types';
import TokenDetailsCard from '../TokenDetailsCard';

const wolf = {
  id: 'tok-wolf', name: 'Dire Wolf', imageUrl: '', position: { x: 4, y: 19 }, size: { width: 1, height: 1 },
  layer: TokenLayer.TOKEN, visible: true, type: TokenType.NPC, conditions: [], rotation: 0, controlledBy: null, characterId: null,
} as unknown as Token;

describe('TokenDetailsCard', () => {
  it('has no close button unless it is given something to close', () => {
    render(<TokenDetailsCard token={wolf} square={wolf.position} hp={null} mayMove />);

    expect(screen.getByText('Dire Wolf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close details' })).toBeNull();
  });

  it('closes on its close button', () => {
    const onClose = vi.fn();
    render(<TokenDetailsCard token={wolf} square={wolf.position} hp={null} mayMove onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // It was 32 pixels square, and the card shows only after a finger's or a
  // pen's tap. jsdom cannot show a touch screen's size, so the classes are
  // what is checked: 40 with a mouse, 44 for a finger, the cross in the middle.
  it('has a close button big enough for a finger, with its cross in the middle', () => {
    render(<TokenDetailsCard token={wolf} square={wolf.position} hp={null} mayMove onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Close details' }).className.split(/\s+/))
      .toEqual(expect.arrayContaining(['pointer-events-auto', 'size-10', 'pointer-coarse:size-11', 'inline-flex', 'items-center', 'justify-center']));
  });

  it('keeps the docked card’s close button big enough for a finger', () => {
    render(<TokenDetailsCard token={wolf} square={wolf.position} hp={null} mayMove onClose={vi.fn()} docked />);

    expect(screen.getByRole('button', { name: 'Close details' }).className.split(/\s+/))
      .toEqual(expect.arrayContaining(['touch-target', 'inline-flex', 'items-center', 'justify-center']));
  });

  // The compact layout's dock places it; elsewhere it is one row in the map's
  // bottom left corner, as wide as it needs.
  it('keeps the map’s bottom left corner unless docked, and the dock’s width when docked', () => {
    const { rerender } = render(<TokenDetailsCard token={wolf} square={wolf.position} hp={null} mayMove />);
    const corner = () => screen.getByText('Dire Wolf').closest('.absolute')!.className.split(/\s+/);
    expect(corner()).toEqual(expect.arrayContaining(['absolute', 'bottom-2', 'left-2', 'w-max', 'max-w-[calc(100%-1rem)]']));

    rerender(<TokenDetailsCard token={wolf} square={wolf.position} hp={null} mayMove docked />);
    const card = screen.getByText('Dire Wolf').closest('.glass-panel')!.className.split(/\s+/);
    expect(card).toEqual(expect.arrayContaining(['relative', 'w-full', 'sm:w-88']));
    expect(card).not.toEqual(expect.arrayContaining(['absolute']));
  });

  it('shows one line in the corner: hit points, Carried within it, and no square', () => {
    render(
      <TokenDetailsCard
        token={wolf}
        square={wolf.position}
        hp={{ current: 7, max: 12, temp: 0 }}
        mayMove
        above={<span>Carried 10 ft</span>}
      />,
    );

    const line = screen.getByText('HP').closest('div')!;
    expect(line).toHaveTextContent('HP 7 / 12');
    expect(line).toContainElement(screen.getByText('Carried 10 ft'));
    expect(screen.queryByText('(4, 19)')).toBeNull();

    // Docked, the square is shown under the name.
    cleanup();
    render(<TokenDetailsCard token={wolf} square={wolf.position} hp={null} mayMove docked />);
    expect(screen.getByText('(4, 19)')).toBeInTheDocument();
  });
});
