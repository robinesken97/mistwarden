/**
 * The area of effect, and the look, an SRD spell's own words give it.
 *
 * Open5e's v1 spells carry no area at all, and v2's shape fields are on 49
 * of the 319 SRD 5.1 spells, with no line among them and some plainly wrong
 * (Flaming Sphere a 20-foot sphere where its text says 5-foot diameter;
 * Reverse Gravity's height given as its radius). So the seed reads the
 * spell's range and description instead. A wrong area is worse than none:
 * anything the phrases below do not name clearly is left without one, and
 * the GM sets it by hand.
 */

import { AREA_ELEMENTS, AREA_LIMITS, type AreaElement, type AreaShape } from '../validators/areaLimits';

export interface SpellArea {
  shape: AreaShape;
  /** A sphere's or cylinder's radius, a cone's or line's length, a cube's side, in feet. */
  sizeFt: number;
  /** A line's width; absent for every other shape. */
  widthFt?: number;
}

type Rule = {
  pattern: RegExp;
  area: (m: RegExpExecArray) => SpellArea | null;
  /** Words just before the match that make it something other than the spell's area. */
  unless?: RegExp;
};

const n = (s: string) => parseInt(s, 10);

/**
 * The phrases the SRD uses for an area, most particular first: where two
 * start at the same place (a cylinder's "N-foot-radius, M-foot-high"), the
 * earlier rule wins. Otherwise the phrase that comes first in the text does.
 */
const RULES: Rule[] = [
  // "a line 100 feet long and 5 feet wide" (Lightning Bolt)
  { pattern: /\bline (?:of [a-z ]+ )?(\d+) feet long and (\d+) feet wide/gi, area: (m) => ({ shape: 'line', sizeFt: n(m[1]), widthFt: n(m[2]) }) },
  // "a 5-foot-wide, 60-foot-long line" (Sunbeam)
  { pattern: /\b(\d+)-foot-wide, (\d+)-foot-long line/gi, area: (m) => ({ shape: 'line', sizeFt: n(m[2]), widthFt: n(m[1]) }) },
  // "a 10-foot-radius, 40-foot-high cylinder": the radius, never the height
  { pattern: /\b(\d+)-foot[- ]radius,? (\d+)-foot[- ](?:high|tall) cylinder/gi, area: (m) => ({ shape: 'cylinder', sizeFt: n(m[1]) }) },
  // "a 20-foot-tall cylinder with a 40-foot radius" (Sleet Storm)
  { pattern: /\b(\d+)-foot[- ](?:high|tall) cylinder with a (\d+)-foot radius/gi, area: (m) => ({ shape: 'cylinder', sizeFt: n(m[2]) }) },
  { pattern: /\b(\d+)-foot cone\b/gi, area: (m) => ({ shape: 'cone', sizeFt: n(m[1]) }) },
  // A cube the spell fills, not one an object or image must fit inside
  // ("no larger than a", "contained within a single"), nor a portion of a
  // target (Disintegrate).
  { pattern: /\b(\d+)-foot[- ]cube\b(?! portion)/g, area: (m) => ({ shape: 'cube', sizeFt: n(m[1]) }), unless: /(?:larger than an?|fits?(?: entirely)? (?:inside|in|within) an?|contained within an?|single|[Aa]ny) $/ },
  // "a 20-foot square" of ground (Entangle, Grease), drawn as a cube from above.
  { pattern: /\b(\d+)-foot square\b/g, area: (m) => ({ shape: 'cube', sizeFt: n(m[1]) }), unless: /\blarger than an? $/i },
  { pattern: /\b(\d+)-foot-diameter sphere/gi, area: (m) => ({ shape: 'sphere', sizeFt: n(m[1]) / 2 }) },
  // "a 20-foot-radius sphere", "in a 30-foot radius", "a 100-foot-radius
  // circle", but not the light a flame or a lit object sheds.
  { pattern: /\b(\d+)-foot[- ]radius\b/gi, area: (m) => ({ shape: 'sphere', sizeFt: n(m[1]) }), unless: /\blight in an? $/i },
];

/**
 * The text with Open5e's stray soft hyphens taken out: Shatter's
 * "10-\u00ad--foot-\u00ad--radius sphere" reads as "10-foot-radius sphere".
 */
const plain = (text: string) => text.replace(/\u00ad/g, '').replace(/-{2,}/g, '-');

/** Whether the map can draw it: whole feet within the AoE tool's limits. */
function placeable(area: SpellArea): boolean {
  const whole = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  return whole(area.sizeFt, AREA_LIMITS.minSizeFt, AREA_LIMITS.maxSizeFt)
    && (area.widthFt === undefined || whole(area.widthFt, AREA_LIMITS.minWidthFt, AREA_LIMITS.maxWidthFt));
}

/**
 * The area a spell's range and description name, or null. The range comes
 * first, so a range written as "Self (15-foot cone)" is read too.
 */
export function spellAreaFromText(range: string | null | undefined, description: string | null | undefined): SpellArea | null {
  const text = plain(`${range ?? ''}\n${description ?? ''}`);
  let best: { index: number; order: number; area: SpellArea } | null = null;
  RULES.forEach((rule, order) => {
    for (const m of text.matchAll(rule.pattern)) {
      const index = m.index ?? 0;
      if (best && (index > best.index || (index === best.index && order >= best.order))) break;
      if (rule.unless?.test(text.slice(Math.max(0, index - 40), index))) continue;
      const area = rule.area(m as RegExpExecArray);
      if (area && placeable(area)) {
        best = { index, order, area };
        break;
      }
    }
  });
  return (best as { area: SpellArea } | null)?.area ?? null;
}

/** The damage types an area can look like; bludgeoning, piercing and slashing have no look. */
const ELEMENT_OF_DAMAGE = new Set<string>(AREA_ELEMENTS.filter((e) => e !== 'none' && e !== 'water'));

/**
 * The look a spell's damage gives its area: the one element-like damage type
 * its description rolls dice for ("8d6 fire damage") or deals ("takes fire
 * damage equal to"), or none when it rolls
 * for none or for two (Flame Strike's fire and radiant). A damage type
 * named without dice ("immune to thunder damage") does not count.
 */
export function spellElementFromText(description: string | null | undefined): AreaElement {
  const types = new Set<string>();
  for (const m of plain(description ?? '').matchAll(/(?:\b\d+d ?\d+(?: \+ \d+)?|\btakes) ([a-z]+) damage/gi)) {
    const type = m[1].toLowerCase();
    if (ELEMENT_OF_DAMAGE.has(type)) types.add(type);
  }
  return types.size === 1 ? ([...types][0] as AreaElement) : 'none';
}
