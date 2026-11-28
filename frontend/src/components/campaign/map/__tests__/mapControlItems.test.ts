import { it, expect } from 'vitest';
import { gridColorLabel, rulerColorLabel } from '../mapControlItems';

it('names the colours the rail shows', () => {
  expect([gridColorLabel('black'), gridColorLabel('white')]).toEqual(['Grid Color: Black', 'Grid Color: White']);
  expect([rulerColorLabel('amber'), rulerColorLabel('purple'), rulerColorLabel('black')])
    .toEqual(['Ruler color: Amber', 'Ruler color: Purple', 'Ruler color: Black']);
});
