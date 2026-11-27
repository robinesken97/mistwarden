// Ported for Mistwarden on 2026-11-27 from the author's earlier mistwarden-vtt (apps/client/src/dice), same author.
// Dice bodies as face lists, dependency-free: d4 to d20. Each face knows its center,
// its normal and its own 2D axis frame for the label.
// Shared basis for the 3D view (three.js) and the CSS fallback.

export type Vec = [number, number, number];
export type DieKind = 4 | 6 | 8 | 10 | 12 | 20;

export interface Face {
  /** Corners in winding order. */
  pts: Vec[];
  c: Vec;
  n: Vec;
  /** Axes in the face plane; `v` points up for the number. */
  u: Vec;
  v: Vec;
  /** Corners in the face's axis frame. */
  loc: [number, number][];
  /** Distance of the farthest corner from the center. */
  R: number;
}

const PHI = (1 + Math.sqrt(5)) / 2;

export const sub = (a: Vec, b: Vec): Vec => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const add = (a: Vec, b: Vec): Vec => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const mul = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec, b: Vec): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec): number => Math.sqrt(dot(a, a));
export const norm = (a: Vec): Vec => mul(a, 1 / len(a));

/** Rotates `v` about the unit axis `k` by angle `a` (Rodrigues). */
export function rot(v: Vec, k: Vec, a: number): Vec {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = dot(k, v) * (1 - c);
  const x = cross(k, v);
  return [
    v[0] * c + x[0] * s + k[0] * d,
    v[1] * c + x[1] * s + k[1] * d,
    v[2] * c + x[2] * s + k[2] * d,
  ];
}

/** Rotation (axis, angle) that maps the unit vector `n` onto +z. */
export function toZ(n: Vec): { axis: Vec; ang: number } {
  const z: Vec = [0, 0, 1];
  const ax = cross(n, z);
  const s = len(ax);
  return {
    axis: s < 1e-6 ? [1, 0, 0] : mul(ax, 1 / s),
    ang: Math.acos(Math.max(-1, Math.min(1, dot(n, z)))),
  };
}

const SIGNS = [-1, 1];

/** Corners farthest along `n`: one face of a convex body. */
function faceTowards(verts: Vec[], n: Vec): Vec[] {
  const far = Math.max(...verts.map((p) => dot(p, n)));
  return verts.filter((p) => dot(p, n) > far - 1e-6);
}

/** Corner lists of the faces; face i carries the number i + 1 (d10: i). */
function faceSets(kind: DieKind): Vec[][] {
  if (kind === 4) {
    const verts: Vec[] = [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
    ];
    return verts.map((p) => faceTowards(verts, mul(p, -1)));
  }
  if (kind === 6) {
    const verts = SIGNS.flatMap((x) =>
      SIGNS.flatMap((y) => SIGNS.map((z): Vec => [x, y, z])),
    );
    const normals: Vec[] = [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [-1, 0, 0],
      [0, 0, -1],
    ];
    return normals.map((n) => faceTowards(verts, n));
  }
  if (kind === 8) {
    const verts: Vec[] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    return SIGNS.flatMap((x) =>
      SIGNS.flatMap((y) => SIGNS.map((z) => faceTowards(verts, [x, y, z]))),
    );
  }
  if (kind === 10) {
    // Pentagonal trapezohedron: two apexes with a zigzag ring of ten corners in between.
    // With this ring height the four corners of each kite lie in one plane.
    const cos36 = Math.cos(Math.PI / 5);
    const h = (1 - cos36) / (1 + cos36);
    const ring = Array.from({ length: 10 }, (_, k): Vec => {
      const a = (k * Math.PI) / 5;
      return [Math.cos(a), Math.sin(a), k % 2 === 0 ? h : -h];
    });
    const at = (k: number) => ring[(k + 10) % 10] as Vec;
    return Array.from({ length: 10 }, (_, i): Vec[] => {
      // Odd faces on top (around a low ring corner), even faces below (around a high one).
      const top = i % 2 === 1;
      const apex: Vec = [0, 0, top ? 1 : -1];
      return [apex, at(i - 1), at(i), at(i + 1)];
    });
  }
  if (kind === 12) {
    const verts: Vec[] = [
      ...SIGNS.flatMap((x) =>
        SIGNS.flatMap((y) => SIGNS.map((z): Vec => [x, y, z])),
      ),
      ...SIGNS.flatMap((a) =>
        SIGNS.flatMap((b): Vec[] => [
          [0, a / PHI, b * PHI],
          [a / PHI, b * PHI, 0],
          [b * PHI, 0, a / PHI],
        ]),
      ),
    ];
    // The faces are perpendicular to the corners of an icosahedron: (0, ±φ, ±1) and cyclic permutations.
    const normals = SIGNS.flatMap((a) =>
      SIGNS.flatMap((b): Vec[] => [
        [0, a * PHI, b],
        [b, 0, a * PHI],
        [a * PHI, b, 0],
      ]),
    );
    return normals.map((n) => faceTowards(verts, n));
  }
  const verts = SIGNS.flatMap((a) =>
    SIGNS.flatMap((b): Vec[] => [
      [0, a, b * PHI],
      [a, b * PHI, 0],
      [b * PHI, 0, a],
    ]),
  );
  const near = (p: Vec, q: Vec) => Math.abs(len(sub(p, q)) - 2) < 1e-6;
  const sets: Vec[][] = [];
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++)
      for (let k = j + 1; k < 12; k++) {
        const [a, b, c] = [verts[i] as Vec, verts[j] as Vec, verts[k] as Vec];
        if (near(a, b) && near(b, c) && near(a, c)) sets.push([a, b, c]);
      }
  return sets;
}

/** Faces of a die; `scale` is the half diameter in pixels. */
export function dieFaces(kind: DieKind, scale: number): Face[] {
  const sets = faceSets(kind);
  // Bring all bodies to the same circumradius so they look equally large.
  const radius = Math.max(...sets.flat().map(len));
  return sets.map((set): Face => {
    const pts = set.map((p) => mul(p, scale / radius));
    const c = mul(pts.reduce(add, [0, 0, 0] as Vec), 1 / pts.length);
    // Normal from the corners (on the d10 the center does not point exactly along the normal).
    let n = norm(
      cross(
        sub(pts[1] as Vec, pts[0] as Vec),
        sub(pts[2] as Vec, pts[0] as Vec),
      ),
    );
    if (dot(n, c) < 0) n = mul(n, -1);
    const u0 = norm(sub(pts[0] as Vec, c));
    const v0 = cross(n, u0);
    const ang = (p: Vec) => {
      const d = sub(p, c);
      return Math.atan2(dot(d, v0), dot(d, u0));
    };
    pts.sort((a, b) => ang(a) - ang(b));
    // Number upright: for triangles and kites 'up' points to the first corner
    // (on the d10 the apex), otherwise to the middle of the first edge.
    let u: Vec;
    let v: Vec;
    if (pts.length === 3 || kind === 10) {
      const apex = kind === 10 ? (set[0] as Vec) : (pts[0] as Vec);
      const top = kind === 10 ? mul(apex, scale / radius) : apex;
      v = norm(sub(top, c));
      // Keep perpendicular to the normal in case the corner is not exactly in the plane.
      v = norm(sub(v, mul(n, dot(v, n))));
      u = cross(v, n);
    } else {
      u = norm(sub(mul(add(pts[0] as Vec, pts[1] as Vec), 0.5), c));
      v = cross(n, u);
    }
    const loc = pts.map((p): [number, number] => {
      const d = sub(p, c);
      return [dot(d, u), dot(d, v)];
    });
    const R = Math.max(...loc.map((l) => Math.hypot(l[0], l[1])));
    return { pts, c, n, u, v, loc, R };
  });
}

/**
 * Rest pose: face `face` points to +z (toward the viewer), the number is upright.
 * Rotate about `axis`/`ang` first, then about z by `gz`.
 */
export function restPose(face: Face): { axis: Vec; ang: number; gz: number } {
  const f = toZ(face.n);
  const v1 = rot(face.v, f.axis, f.ang);
  return { ...f, gz: Math.PI / 2 - Math.atan2(v1[1], v1[0]) };
}
