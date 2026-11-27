/**
 * The Overview lists saves and skills in a fixed order, whatever order a
 * stored sheet holds them in, and shows darkvision where the sheet has it.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FifthEditionCharacterView } from '../FifthEditionCharacterView';
import { FIFTH_EDITION_SHEET, fifthEditionCharacter } from './fifthEditionFixture';

const reversed = (record: unknown) => Object.fromEntries(Object.entries(record as object).reverse());

describe('the Overview', () => {
  it('lists the saving throws Str to Cha', () => {
    render(<FifthEditionCharacterView character={fifthEditionCharacter({ savingThrows: reversed(FIFTH_EDITION_SHEET.savingThrows) })} />);
    const line = screen.getByText('Saving Throws').parentElement!.textContent!;
    expect([...line.matchAll(/(Str|Dex|Con|Int|Wis|Cha) [+-]\d/g)].map((m) => m[1])).toEqual(['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha']);
  });

  it('lists the skills alphabetically, down one column and then the next', () => {
    const { container } = render(<FifthEditionCharacterView character={fifthEditionCharacter({ skills: reversed(FIFTH_EDITION_SHEET.skills) })} />);
    const names = [...container.querySelectorAll('.grid-cols-\\[16px_1fr_auto\\]')]
      .map((row) => row.children[1]?.textContent ?? '')
      .filter(Boolean);
    expect(names[0]).toBe('Acrobatics');
    expect(names).toEqual([...names].sort());
    expect(names).toHaveLength(18);
  });

  it('shows darkvision in the header and the senses when the sheet has it', () => {
    render(<FifthEditionCharacterView character={fifthEditionCharacter({ darkvisionFeet: 60 })} />);
    expect(screen.getByText('Darkvision').nextElementSibling?.textContent).toBe('60 ft');
    expect(screen.getByText('Senses').parentElement!.textContent).toContain('darkvision 60 ft., passive Perception');
  });

  it('leaves darkvision out without it', () => {
    render(<FifthEditionCharacterView character={fifthEditionCharacter({ darkvisionFeet: 0 })} />);
    expect(screen.queryByText('Darkvision')).toBeNull();
    expect(screen.getByText('Senses').parentElement!.textContent).not.toContain('darkvision');
  });
});
