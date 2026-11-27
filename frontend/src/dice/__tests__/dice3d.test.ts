// Ported for Mistwarden on 2026-11-27 from the author's earlier mistwarden-vtt (apps/client/test/dice-3d.test.ts), same author.
import { describe, expect, it } from 'vitest';
import { type DieKind, dieFaces, dot, len, restPose, rot, sub } from '../geometry';
import { MAX_ANIMATED_DICE, planRoll, poseAt, type RollTerm } from '../plan';

/** A dice term as the server's roll breakdown sends it. */
const dice = (sides: number, results: number[]): RollTerm => ({ type: 'dice', sides, results });

describe('the dice bodies', () => {
  const kinds: DieKind[] = [4, 6, 8, 10, 12, 20];

  it('have as many faces as sides', () => {
    expect(kinds.map((k) => dieFaces(k, 30).length)).toEqual(kinds);
  });

  it('have flat faces with a unit normal pointing outwards', () => {
    for (const kind of kinds) {
      for (const f of dieFaces(kind, 30)) {
        expect(len(f.n)).toBeCloseTo(1, 6);
        expect(dot(f.n, f.c)).toBeGreaterThan(0);
        for (const p of f.pts) expect(dot(sub(p, f.c), f.n)).toBeCloseTo(0, 6);
      }
    }
  });

  it('come to rest with the result face up and its number upright', () => {
    for (const kind of kinds) {
      for (const f of dieFaces(kind, 30)) {
        const pose = restPose(f);
        const turn = (v: [number, number, number]) => rot(rot(v, pose.axis, pose.ang), [0, 0, 1], pose.gz);
        expect(turn(f.n)[2]).toBeCloseTo(1, 6);
        const up = turn(f.v);
        expect(up[0]).toBeCloseTo(0, 6);
        expect(up[1]).toBeCloseTo(1, 6);
      }
    }
  });
});

describe('the roll plan', () => {
  it("ends on the server's result", () => {
    const plan = planRoll([dice(20, [17]), dice(6, [3, 6])], 'roll-1');
    expect(plan?.map((d) => [d.kind, d.labels[d.face]])).toEqual([[20, '17'], [6, '3'], [6, '6']]);
  });

  it('shows a d100 as a tens and a units die', () => {
    const show = (r: number) => planRoll([dice(100, [r])], 'x')?.map((d) => d.labels[d.face]);
    expect(show(73)).toEqual(['70', '3']);
    expect(show(100)).toEqual(['00', '0']);
    expect(show(5)).toEqual(['00', '5']);
  });

  it('is the same for the same roll on every device', () => {
    const terms = [dice(8, [2, 5, 8])];
    expect(planRoll(terms, 'abc')).toEqual(planRoll(terms, 'abc'));
    expect(planRoll(terms, 'abc')).not.toEqual(planRoll(terms, 'abd'));
  });

  it('animates nothing without dice it knows or over the limit', () => {
    expect(planRoll([{ type: 'modifier' }], 'x')).toBeNull();
    expect(planRoll([dice(7, [3])], 'x')).toBeNull();
    const many = Array.from({ length: MAX_ANIMATED_DICE + 1 }, () => 1);
    expect(planRoll([dice(6, many)], 'x')).toBeNull();
    expect(planRoll([dice(6, many.slice(1))], 'x')).toHaveLength(MAX_ANIMATED_DICE);
    // A d100 counts as two dice.
    expect(planRoll([dice(100, many.slice(0, 11))], 'x')).toBeNull();
  });

  it('lies still at its target at the end', () => {
    const [die] = planRoll([dice(6, [4])], 'x') ?? [];
    if (!die) throw new Error('no plan');
    expect(poseAt(die, 10_000)).toEqual({ x: die.to.x, y: die.to.y, z: 0, angle: 0, done: true });
    expect(poseAt(die, 0).done).toBe(false);
  });
});
