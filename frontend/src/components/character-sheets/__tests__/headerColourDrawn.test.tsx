/**
 * The header colour a player picks is drawn where the sheet uses it.
 *
 * The active tab and the Horror d100 header's middle stop and bottom
 * border were classes joined to the colour's name at runtime, such as
 * `border-${accent}`. Tailwind generates only class names written out in
 * full, so for most colours they drew nothing. The tab's underline is now the
 * colour itself and its label the theme's text colour, readable on a dark
 * theme's sheet; the Horror d100 header's classes are written out. The 5E
 * sheet and its editor fill the open tab in the sheet's accent instead.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FifthEditionCharacterView } from '../fifth-edition/FifthEditionCharacterView';
import { FifthEditionCharacterEditor } from '../fifth-edition/FifthEditionCharacterEditor';
import { FantasyD20CharacterEditor } from '../fantasy-d20/FantasyD20CharacterEditor';
import { fifthEditionCharacter } from '../fifth-edition/__tests__/fifthEditionFixture';
import { fantasyD20Character } from '../fantasy-d20/__tests__/fantasyD20Fixture';
import { COLOR_PRESETS as HORROR_D100_PRESETS } from '../horror-d100/colorPresets';
import { HorrorD100CharacterView } from '../horror-d100/HorrorD100CharacterView';
import { HorrorD100CharacterEditor } from '../horror-d100/HorrorD100CharacterEditor';
import { blankSkills, horrorD100Character } from '../horror-d100/__tests__/sheetFixture';
import { sheetAccent } from '@/utils/themeColor';
import { PRESET_THEMES } from '@/themes';

vi.mock('@/hooks/queries', () => ({ useServerConfigQuery: () => ({ data: undefined }) }));

const activeTab = () => screen.getByRole('tab', { name: /Stats & Skills/ });
const noop = () => Promise.resolve();

describe("the 5E sheet's open tab", () => {
  const accentOf = (hex: string) => sheetAccent(hex, PRESET_THEMES[0].colors.bgBase, PRESET_THEMES[0].colors.accent);
  const rootOf = (tab: HTMLElement) => tab.closest('[style*="--sheet-fill"]') as HTMLElement;

  it.each([
    ['the 5E sheet', (themeColor: string) => render(<FifthEditionCharacterView character={fifthEditionCharacter({ themeColor })} />), /^Overview$/],
    ['the 5E editor', (themeColor: string) => render(<FifthEditionCharacterEditor character={fifthEditionCharacter({ themeColor })} onSave={noop} onCancel={vi.fn()} />), /Stats & Skills/],
  ])('on %s is filled in the header colour, made readable on the page', (_name, show, name) => {
    show('Royal Blue');
    const tab = screen.getByRole('tab', { name });
    expect(tab).toHaveClass('bg-(--sheet-fill)', 'text-(--sheet-on-fill)');
    expect(rootOf(tab).style.getPropertyValue('--sheet-fill')).toBe(accentOf('#1d4ed8').fill);
    expect(rootOf(tab).style.getPropertyValue('--sheet-on-fill')).toBe(accentOf('#1d4ed8').onFill);
  });

  it('takes a custom colour', () => {
    render(<FifthEditionCharacterView character={fifthEditionCharacter({ themeColor: '#123456' })} />);
    const tab = screen.getByRole('tab', { name: /^Overview$/ });
    expect(rootOf(tab).style.getPropertyValue('--sheet-accent')).toBe(accentOf('#123456').accent);
  });

  it("takes the theme's accent without a colour of its own", () => {
    render(<FifthEditionCharacterView character={fifthEditionCharacter({ themeColor: undefined })} />);
    const tab = screen.getByRole('tab', { name: /^Overview$/ });
    expect(rootOf(tab).style.getPropertyValue('--sheet-fill')).toBe('rgb(var(--rgb-accent))');
    expect(rootOf(tab).style.getPropertyValue('--sheet-accent')).toBe(`rgb(${PRESET_THEMES[0].colors.accent})`);
  });

  it('stays without a colour in the editor until one is picked, and saves none', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FifthEditionCharacterEditor character={fifthEditionCharacter({ themeColor: undefined })} onSave={onSave} onCancel={vi.fn()} />);
    const tab = screen.getByRole('tab', { name: /Stats & Skills/ });
    expect(rootOf(tab).style.getPropertyValue('--sheet-fill')).toBe('rgb(var(--rgb-accent))');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].themeColor).toBeUndefined();
  });
});

describe('the active tab', () => {
  it.each([
    ['the Fantasy d20 editor', () => render(<FantasyD20CharacterEditor character={fantasyD20Character({ themeColor: 'Royal Blue' })} onSave={noop} onCancel={vi.fn()} />)],
  ])('on %s is underlined in the header colour', (_name, show) => {
    show();
    expect(activeTab()).toHaveStyle({ borderBottomColor: '#1d4ed8' });
    expect(activeTab()).toHaveClass('text-ink');
  });

});

// jsdom keeps any class name, generated or not, so the presets are checked
// for whole class names; the theme token test refuses a class joined at
// runtime anywhere.
describe('the Horror d100 header colours', () => {
  it.each(HORROR_D100_PRESETS.map((preset) => [preset.name, preset] as const))('%s has whole class names', (_name, preset) => {
    expect(preset.via).toMatch(/^via-[a-z]+-\d{2,3}$/);
    expect(preset.border).toMatch(/^border-[a-z]+-\d{2,3}$/);
  });
});

describe('the Horror d100 sheet', () => {
  const ticked = (themeColor: string) => {
    render(<HorrorD100CharacterView character={horrorD100Character({ themeColor, skills: blankSkills({ appraise: { value: 15, experienceCheck: true } }) })} />);
    screen.getAllByRole('tab', { name: /^Skills$/ }).forEach((tab) => fireEvent.click(tab));
    return screen.getAllByRole('img', { name: 'Experience check ticked' })[0];
  };

  it('underlines the open tab in a custom colour', () => {
    render(<HorrorD100CharacterView character={horrorD100Character({ themeColor: '#123456' })} />);
    expect(screen.getByRole('tab', { name: /^Overview$/ })).toHaveStyle({ borderBottomColor: '#123456' });
  });

  it('ticks a skill in a custom colour, with a tick that reads on it', () => {
    const mark = ticked('#ffeecc');
    expect(mark).toHaveStyle({ backgroundColor: '#ffeecc' });
    expect(mark.querySelector('svg')).toHaveClass('text-black');
  });

  it('ticks a skill in a preset colour with a white tick on a dark one', () => {
    const mark = ticked('Dark Forest');
    expect(mark).toHaveStyle({ backgroundColor: '#14532d' });
    expect(mark.querySelector('svg')).toHaveClass('text-white');
  });
});

// The header is the player's colour, not the theme's, so its Save button is
// drawn in fixed colours: in the theme's accent it could match the header.
describe('the header Save button', () => {
  it.each([
    ['5E', () => render(<FifthEditionCharacterEditor character={fifthEditionCharacter()} onSave={noop} onCancel={vi.fn()} />)],
    ['Fantasy d20', () => render(<FantasyD20CharacterEditor character={fantasyD20Character()} onSave={noop} onCancel={vi.fn()} />)],
    ['Horror d100', () => render(<HorrorD100CharacterEditor character={horrorD100Character()} onSave={noop} onCancel={vi.fn()} />)],
  ])('on %s does not take the theme accent', (_name, show) => {
    show();
    const save = screen.getByRole('button', { name: /^Save$/ });
    expect(save).not.toHaveClass('btn-primary');
    expect(save).toHaveClass('bg-white', 'text-black');
  });
});

// The Horror d100 editor's header text and boxes were always white, so on
// a pale custom colour the character's name could not be read.
describe('the Horror d100 editor header on a pale colour', () => {
  it('draws its text and boxes dark', () => {
    render(<HorrorD100CharacterEditor character={horrorD100Character({ themeColor: '#ffffff' })} onSave={noop} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('Character name')).toHaveClass('text-black');
    expect(screen.getByLabelText('Profession')).toHaveClass('text-black');
    expect(screen.getByLabelText('Profession')).not.toHaveClass('text-white');
  });
});
