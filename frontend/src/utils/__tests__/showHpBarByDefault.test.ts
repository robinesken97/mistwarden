import { describe, it, expect } from 'vitest';
import { showHpBarByDefault } from '../tokenFlags';

describe('showHpBarByDefault', () => {
  it('shows the HP of friendly and neutral NPCs, not of enemies or monsters without a side', () => {
    expect(showHpBarByDefault('friendly')).toBe(true);
    expect(showHpBarByDefault('neutral')).toBe(true);
    expect(showHpBarByDefault('hostile')).toBe(false);
    expect(showHpBarByDefault(null)).toBe(false);
    expect(showHpBarByDefault(undefined)).toBe(false);
  });
});
