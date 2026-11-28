// ============================================
// The wide layout's map rail: one column of cells on the map's right edge,
// or two balanced columns where one does not fit the map's height.
//
// Cells are 40 px with a mouse and 44 on a touch screen, 4 apart, with 4 of
// padding; a line between groups adds 1 px and one more gap. The rule
// (layout spec): one column, unless its height plus 16 px is more than the
// map is tall. Then the tools go in the inner column and the view and the
// GM's layers in the outer one.
// ============================================

export const RAIL_GAP = 4;
export const RAIL_PADDING = 4;
/** A line between groups: 1 px, and the gap after it. */
export const RAIL_DIVIDER = 1 + RAIL_GAP;
/** The room kept above and below the rail on the map. */
export const RAIL_MARGIN = 16;

/** One column's height: `groups` are the cells in each group, empty groups left out. */
export function railColumnHeight(groups: readonly number[], cell: number): number {
  const filled = groups.filter((n) => n > 0);
  const cells = filled.reduce((sum, n) => sum + n, 0);
  if (cells === 0) return 0;
  return cells * cell + (cells - 1) * RAIL_GAP + (filled.length - 1) * RAIL_DIVIDER + 2 * RAIL_PADDING;
}

/** Whether the rail goes to two columns on a map `mapHeight` tall. */
export function railTwoColumns(groups: readonly number[], cell: number, mapHeight: number): boolean {
  return mapHeight > 0 && railColumnHeight(groups, cell) + RAIL_MARGIN > mapHeight;
}

/** The rail's width with `columns` columns, its 1 px border included. */
export function railWidth(columns: 1 | 2, cell: number): number {
  return columns * cell + (columns - 1) * RAIL_GAP + 2 * RAIL_PADDING + 2;
}
