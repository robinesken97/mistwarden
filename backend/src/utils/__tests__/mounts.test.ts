/**
 * A rider coupled to a mount (utils/mounts.ts): who moves with whom, the
 * group kept whole at the map's edge, and the couplings a write lets go.
 */

import type { Token } from '../../websocket/shared';
import { coupledIds, moveCoupled, untangleMounts, uncouple, mount, mountRefusal } from '../mounts';
import { cellCentre, cellOnMap } from '../tokenCentre';

function token(id: string, extra: Partial<Token> = {}): Token {
  return {
    id, name: id, imageUrl: '', position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, layer: 'token',
    visible: true, controlledBy: null, rotation: 0, conditions: [], metadata: {}, ...extra,
  };
}

const MAP = { width: 10, height: 10, gridSize: 50, gridType: 'square', gridOffsetX: 0, gridOffsetY: 0 };
const horse = token('horse', { position: { x: 2, y: 2 }, size: { width: 2, height: 2 } });
const rider = token('rider', { position: { x: 3, y: 3 }, mountedOn: 'horse' });
const squire = token('squire', { position: { x: 2, y: 2 }, mountedOn: 'horse' });
const goblin = token('goblin', { position: { x: 7, y: 7 } });

describe('coupledIds', () => {
  it('is the mount and all its riders from either end', () => {
    expect(coupledIds([horse, rider, squire, goblin], 'rider')).toEqual(['horse', 'rider', 'squire']);
    expect(coupledIds([horse, rider, squire, goblin], 'horse')).toEqual(['horse', 'rider', 'squire']);
  });
  it('is the token alone when it rides nothing, or its mount is gone', () => {
    expect(coupledIds([horse, goblin], 'goblin')).toEqual(['goblin']);
    expect(coupledIds([rider, goblin], 'rider')).toEqual(['rider']);
  });
});

describe('moveCoupled', () => {
  it('moves the mount and every rider by the dragged token\'s step, the dragged first', () => {
    const { tokens, moved } = moveCoupled([horse, rider, squire, goblin], 'rider', { x: 5, y: 4 }, MAP);
    expect(moved.map((t) => t.id)).toEqual(['rider', 'horse', 'squire']);
    const at = Object.fromEntries(tokens.map((t) => [t.id, t.position]));
    expect(at).toEqual({ horse: { x: 4, y: 3 }, rider: { x: 5, y: 4 }, squire: { x: 4, y: 3 }, goblin: { x: 7, y: 7 } });
  });
  it('stops the group as a whole at the edge, keeping each rider\'s place on the mount', () => {
    // The rider asked for the last column; the horse beneath it is two wide.
    const { tokens } = moveCoupled([horse, rider], 'rider', { x: 9, y: 0 }, MAP);
    const at = Object.fromEntries(tokens.map((t) => [t.id, t.position]));
    expect(at).toEqual({ horse: { x: 8, y: 0 }, rider: { x: 9, y: 1 } });
  });
  it('on a hex map keeps every rider the same step from its mount, on a hex on the map', () => {
    const HEX = { ...MAP, gridType: 'hexPointy' };
    const pony = token('pony', { position: { x: 4, y: 4 } });
    const onPony = token('onPony', { position: { x: 4, y: 4 }, mountedOn: 'pony' });
    const beside = token('beside', { position: { x: 5, y: 4 }, mountedOn: 'pony' });
    // One row up: stored x stays, but the row shifts by half a hex.
    const { tokens } = moveCoupled([pony, onPony, beside], 'pony', { x: 4, y: 5 }, HEX);
    const at = Object.fromEntries(tokens.map((t) => [t.id, t.position]));
    expect(at.pony).toEqual({ x: 4, y: 5 });
    expect(at.onPony).toEqual({ x: 4, y: 5 });
    const step = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const pa = cellCentre(a, HEX);
      const pb = cellCentre(b, HEX);
      return [pb.x - pa.x, pb.y - pa.y];
    };
    expect(step(at.pony, at.beside)).toEqual(step(pony.position, beside.position));
    // Off the map's edge, the mount stops on the nearest hex.
    const edge = moveCoupled([pony, onPony], 'pony', { x: 30, y: 5 }, HEX);
    for (const t of edge.tokens) expect(cellOnMap(t.position, HEX)).toBe(true);
  });
  it('moves a token that rides nothing on its own', () => {
    const { moved } = moveCoupled([horse, goblin], 'goblin', { x: 9, y: 9 }, MAP);
    expect(moved).toEqual([{ ...goblin, position: { x: 9, y: 9 } }]);
  });
});

describe('untangleMounts', () => {
  it('lets go of a mount that is gone, on the other plane, the rider itself or itself riding', () => {
    const lost = token('lost', { mountedOn: 'nobody' });
    const self = token('self', { mountedOn: 'self' });
    const ghost = token('ghost', { layer: 'spirit' });
    const crossed = token('crossed', { mountedOn: 'ghost' });
    const onRider = token('onRider', { mountedOn: 'rider' });
    const kept = untangleMounts([horse, rider, lost, self, ghost, crossed, onRider]);
    expect(Object.fromEntries(kept.map((t) => [t.id, t.mountedOn ?? null]))).toEqual({
      horse: null, rider: 'horse', lost: null, self: null, ghost: null, crossed: null, onRider: null,
    });
  });
});

describe('uncouple, mount and mountRefusal', () => {
  it('uncouple lets go of both a rider\'s mount and a mount\'s riders', () => {
    expect(uncouple([horse, rider, squire], 'horse').map((t) => t.mountedOn ?? null)).toEqual([null, null, null]);
    expect(uncouple([horse, rider, squire], 'rider').map((t) => t.mountedOn ?? null)).toEqual([null, null, 'horse']);
  });
  it('mount puts the rider on the mount\'s square, drawn after it and its riders', () => {
    const next = mount([goblin, horse, squire, token('foot')], 'goblin', 'horse');
    expect(next.map((t) => t.id)).toEqual(['horse', 'squire', 'goblin', 'foot']);
    expect(next[2]).toMatchObject({ mountedOn: 'horse', position: { x: 2, y: 2 } });
  });
  it('mountRefusal allows one level only, on one plane', () => {
    expect(mountRefusal([horse, goblin], goblin, horse)).toBeNull();
    expect(mountRefusal([horse], goblin, undefined)).toMatch(/another token/);
    expect(mountRefusal([goblin], goblin, goblin)).toMatch(/itself/);
    expect(mountRefusal([horse, rider], goblin, rider)).toMatch(/itself riding/);
    expect(mountRefusal([horse, rider], horse, goblin)).toMatch(/carrying riders/);
    expect(mountRefusal([], goblin, token('ghost', { layer: 'spirit' }))).toMatch(/same plane/);
  });
});
