// Added for Mistwarden on 2026-11-27.
/**
 * The desk header's "Display on this device" button opens this device's fog
 * and dice choices in a small panel, which Escape or a press outside closes.
 */
import { it, expect, vi } from 'vitest';
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
  expect(screen.getByRole('checkbox', { name: 'Lights follow while dragging' })).toBeChecked();

  fireEvent.pointerDown(panel);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button).toHaveFocus();

  fireEvent.click(button);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('group', { name: 'Display on this device' })).toBeNull();
});

it('keeps whether carried lights follow a drag on this device', () => {
  window.localStorage.clear();
  render(<DisplaySettingsButton />);
  fireEvent.click(screen.getByRole('button', { name: 'Display on this device' }));
  const follow = screen.getByRole('checkbox', { name: 'Lights follow while dragging' });
  expect(follow).toBeChecked();
  fireEvent.click(follow);
  expect(window.localStorage.getItem('mistwarden.lightsFollowDrag')).toBe('off');
  fireEvent.click(follow);
  expect(window.localStorage.getItem('mistwarden.lightsFollowDrag')).toBe('on');
});

it('keeps the token names choice on this device, on the token pointed at or tapped until changed', () => {
  window.localStorage.clear();
  const heard = vi.fn();
  window.addEventListener('mistwarden:tokennames', heard);
  render(<DisplaySettingsButton />);
  fireEvent.click(screen.getByRole('button', { name: 'Display on this device' }));
  const names = screen.getByRole('combobox', { name: 'Token names' });
  expect(names).toHaveValue('hover');
  fireEvent.change(names, { target: { value: 'always' } });
  expect(window.localStorage.getItem('mistwarden.tokenNames')).toBe('always');
  expect(heard).toHaveBeenCalledTimes(1);
  window.removeEventListener('mistwarden:tokennames', heard);
});
