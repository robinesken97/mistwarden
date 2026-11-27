// Added for Mistwarden on 2026-11-27.
// ============================================
// The look of a token with no picture: a dark disc with a white symbol for
// its creature type or class (utils/tokenIcons.ts), ringed in the colour of
// its disposition. The map draws each symbol from a picture of the disc and
// symbol made once (a sprite) and kept for every token that shows it; the
// ring is drawn over it, in the token's own colour.
// ============================================

import { useEffect, useMemo, useState } from 'react';
import type { Token } from '@/types';
import { isTokenIcon, statBlockIcon, type TokenIcon } from '@/utils/tokenIcons';

/** Each symbol's file as the build serves it, by name. */
const ICON_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('../../../../assets/token-icons/*.svg', { eager: true, query: '?url', import: 'default' }))
    .map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.svg'.length), url as string]),
);

export function tokenIconUrl(icon: TokenIcon): string {
  return ICON_URLS[icon];
}

/**
 * The symbol a token is drawn with: its own, the creature type its stat block
 * gives, its character's class (`classIcons`, from the roster), or a person.
 * A player is sent the first two worked out, as `icon`.
 */
export function tokenIcon(
  token: Pick<Token, 'icon' | 'statBlock' | 'characterId'>,
  classIcons: Readonly<Record<string, TokenIcon>>,
): TokenIcon {
  return (isTokenIcon(token.icon) ? token.icon : null)
    ?? statBlockIcon(token.statBlock)
    ?? (token.characterId ? classIcons[token.characterId] : undefined)
    ?? 'person';
}

/** The disc's dark centre and edge, as the approved look has them. */
export const SYMBOL_DISC_CENTRE = '#3b3752';
export const SYMBOL_DISC_EDGE = '#15141c';
/** How much of the disc's width the symbol takes. */
const SYMBOL_SHARE = 0.66;
/** A sprite's side in pixels: sharp on a token about 120 screen pixels wide at twice the pixel density. */
const SPRITE_PX = 256;

/** The sprites made so far, null while one is loading or after it failed. */
const sprites = new Map<TokenIcon, HTMLCanvasElement | null>();
/** Bumped as each sprite is made, so a map drawing them draws again. */
let made = 0;
const listeners = new Set<() => void>();

function makeSprite(icon: TokenIcon): void {
  if (sprites.has(icon)) return;
  sprites.set(icon, null);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SPRITE_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const r = SPRITE_PX / 2;
    const disc = ctx.createRadialGradient(r, r * 0.8, 0, r, r, r);
    disc.addColorStop(0, SYMBOL_DISC_CENTRE);
    disc.addColorStop(1, SYMBOL_DISC_EDGE);
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.fill();
    const side = SPRITE_PX * SYMBOL_SHARE;
    ctx.drawImage(img, r - side / 2, r - side / 2, side, side);
    sprites.set(icon, canvas);
    made++;
    for (const listener of listeners) listener();
  };
  // Left null: the token keeps its lettered circle.
  img.onerror = () => console.error('[MapCanvas] Token symbol could not be loaded:', icon);
  img.src = tokenIconUrl(icon);
}

/**
 * The sprites for `icons`, made on first use and kept for the page's life:
 * at most 27, each 256 pixels square. A symbol not made yet is missing from
 * the map, and its token is drawn as a lettered circle meanwhile.
 */
export function useTokenSymbolSprites(icons: readonly TokenIcon[]): ReadonlyMap<TokenIcon, HTMLCanvasElement> {
  const [version, setVersion] = useState(made);
  const wanted = [...new Set(icons)].sort().join(',');
  useEffect(() => {
    const listener = () => setVersion(made);
    listeners.add(listener);
    for (const icon of wanted.split(',')) if (isTokenIcon(icon)) makeSprite(icon);
    return () => { listeners.delete(listener); };
  }, [wanted]);
  return useMemo(() => {
    const ready = new Map<TokenIcon, HTMLCanvasElement>();
    for (const [icon, sprite] of sprites) if (sprite) ready.set(icon, sprite);
    return ready;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is bumped as a sprite is made; the sprites are module state
  }, [version]);
}
