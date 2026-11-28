// Reaching the map's rail cards in a test: the GM tools card and its tabs,
// and the segmented radio groups the cards are made of.
import { fireEvent, screen, within } from '@testing-library/react';

export type GmTab = 'Fog' | 'Walls' | 'Lights';

/** The GM tools card's tab list, or null while the card is away. */
export const gmTabs = () => screen.queryByRole('tablist', { name: 'GM tools' });

/** The GM tools card (while it is open). */
export const gmCard = () => screen.getByRole('region', { name: 'GM tools' });

/** Open the GM tools card if it is away (the rail's GM tools), then the tab ("Walls" also finds "Walls (3)"). */
export function openGmTab(tab: GmTab) {
  if (!gmTabs()) fireEvent.click(screen.getByRole('button', { name: 'GM tools' }));
  fireEvent.click(within(screen.getByRole('tablist', { name: 'GM tools' })).getByRole('tab', { name: new RegExp(`^${tab}( \\(\\d+\\))?$`) }));
}

/** The radio named `name` in the radio group named `group`, within `scope` (a card) where several cards have that group. */
export const radio = (group: string, name: string | RegExp, scope: HTMLElement = document.body) =>
  within(within(scope).getByRole('radiogroup', { name: group })).getByRole('radio', { name });

/** Press the radio named `name` in the group named `group`. */
export const choose = (group: string, name: string | RegExp, scope?: HTMLElement) => fireEvent.click(radio(group, name, scope));

/** Open a GM tab and press its Mode: Walls' Draw … Brush, Fog's Reveal | Hide, Lights' Place | Select. */
export function gmMode(tab: GmTab, mode: string) {
  openGmTab(tab);
  choose('Mode', mode, gmCard());
}
