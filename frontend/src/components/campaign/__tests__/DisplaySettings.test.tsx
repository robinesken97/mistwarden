// Added for Mistwarden on 2026-11-27.
/**
 * The desk header's "Display on this device" button opens this device's fog
 * and dice choices in a small panel, which Escape or a press outside closes.
 */
import { it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DisplaySettingsButton } from '../DisplaySettings';

it('opens the fog and dice choices, and closes on Escape and on a press outside', () => {
  render(<DisplaySettingsButton />);
  const button = screen.getByRole('button', { name: 'Display on this device' });
  expect(button).toHaveAttribute('aria-expanded', 'false');

  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  const panel = screen.getByRole('group', { name: 'Display on this device' });
  expect(screen.getByRole('combobox', { name: 'Fog' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Dice animation' })).toBeInTheDocument();

  fireEvent.pointerDown(panel);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button).toHaveFocus();

  fireEvent.click(button);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('group', { name: 'Display on this device' })).toBeNull();
});
