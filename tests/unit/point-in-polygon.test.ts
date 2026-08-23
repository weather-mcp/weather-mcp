/**
 * Unit tests for point-in-polygon geometry used by CAP alert-area matching.
 * All expected answers below are hand-computed from the geometry, not
 * derived by running the implementation.
 */

import { describe, it, expect } from 'vitest';
import { pointInRing, pointInAnyRing } from '../../src/utils/pointInPolygon.js';

// Simple 10x10 square, corners at (0,0), (0,10), (10,10), (10,0) in [lat, lon].
// Edges: bottom lat=0 (lon 0->10), right lon=10 (lat 0->10),
//        top lat=10 (lon 10->0), left lon=0 (lat 10->0).
const SQUARE: Array<[number, number]> = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
];

// Square with a rectangular notch bitten out of the top edge (lat=10)
// between lon 4 and lon 6, indented down to lat=6. The notch cavity
// (lat 6-10, lon 4-6) sits inside the ring's bounding box but is outside
// the polygon itself — the case a bbox-only or naive check gets wrong.
const NOTCHED_SQUARE: Array<[number, number]> = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 6],
  [6, 6],
  [6, 4],
  [10, 4],
  [10, 0],
];

// Staircase/L-shape: full width (lon 0-10) for lat 0-5, narrowing to
// lon 0-5 for lat 5-10. Edge P3->P4 = (5,5)->(10,5) is a vertical edge
// (lon=5 constant) spanning lat 5-10.
const STAIRCASE: Array<[number, number]> = [
  [0, 0],
  [0, 10],
  [5, 10],
  [5, 5],
  [10, 5],
  [10, 0],
];

describe('pointInRing', () => {
  it('returns true for a point inside a convex ring', () => {
    // Arrange: center of the 10x10 square is unambiguously interior.
    // Act
    const result = pointInRing(5, 5, SQUARE);
    // Assert
    expect(result).toBe(true);
  });

  it('returns false for a point outside a convex ring', () => {
    // Arrange: (20, 20) is well outside the square's bounding box.
    // Act
    const result = pointInRing(20, 20, SQUARE);
    // Assert
    expect(result).toBe(false);
  });

  it('returns true for a point exactly on an edge', () => {
    // Arrange: (0, 5) is the midpoint of the bottom edge (lat=0, lon 0->10).
    // Act
    const result = pointInRing(0, 5, SQUARE);
    // Assert
    expect(result).toBe(true);
  });

  it('returns true for a point exactly on a vertex', () => {
    // Arrange: (0, 0) is a ring vertex.
    // Act
    const result = pointInRing(0, 0, SQUARE);
    // Assert
    expect(result).toBe(true);
  });

  it('returns false for a point in the notch of a concave ring', () => {
    // Arrange: (8, 5) sits inside the notch cavity (lat 6-10, lon 4-6):
    // within the ring's overall bounding box (lat 0-10, lon 0-10) but
    // outside the actual polygon area, which excludes the notch.
    // Act
    const result = pointInRing(8, 5, NOTCHED_SQUARE);
    // Assert
    expect(result).toBe(false);
  });

  it('returns true for a point in the body of a concave ring, away from the notch', () => {
    // Arrange: (8, 1) is in the polygon body (lon < 4, so not in the notch).
    // Act
    const result = pointInRing(8, 1, NOTCHED_SQUARE);
    // Assert
    expect(result).toBe(true);
  });

  it('resolves a point whose longitude matches a vertical edge without double-counting', () => {
    // Arrange: STAIRCASE has a vertical edge (5,5)->(10,5) at lon=5.
    // Test point (2, 5): lat=2 is below that edge's lat range (5-10), so
    // it is not on the edge itself, but lon=5 exactly matches the edge's
    // constant longitude — this is the classic ray-casting trap for a
    // naive implementation (divide-by-zero or double count on a vertical
    // edge). Hand trace: only the edge (5,10)->(5,5) [lat=5, lon 10->5]
    // crosses the ray at lon=5 with a lat-threshold of 5, and 2 < 5, so
    // there is exactly one crossing -> inside.
    // Act
    const result = pointInRing(2, 5, STAIRCASE);
    // Assert
    expect(result).toBe(true);
  });

  it('returns false for a ring with fewer than 3 distinct points: empty', () => {
    // Arrange / Act
    const result = pointInRing(0, 0, []);
    // Assert
    expect(result).toBe(false);
  });

  it('returns false for a ring with fewer than 3 distinct points: one point', () => {
    // Arrange / Act
    const result = pointInRing(0, 0, [[0, 0]]);
    // Assert
    expect(result).toBe(false);
  });

  it('returns false for a ring with fewer than 3 distinct points: two points', () => {
    // Arrange / Act
    const result = pointInRing(0, 0, [
      [0, 0],
      [1, 1],
    ]);
    // Assert
    expect(result).toBe(false);
  });

  it('returns false for a ring of three identical points', () => {
    // Arrange / Act
    const result = pointInRing(0, 0, [
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    // Assert
    expect(result).toBe(false);
  });

  it('never throws on a degenerate ring', () => {
    // Arrange / Act / Assert
    expect(() => pointInRing(1, 1, [])).not.toThrow();
    expect(() => pointInRing(1, 1, [[1, 1]])).not.toThrow();
  });
});

describe('pointInAnyRing', () => {
  it('returns true when only the second ring contains the point', () => {
    // Arrange: a ring far away that cannot contain (5,5), then SQUARE which does.
    const farRing: Array<[number, number]> = [
      [50, 50],
      [50, 60],
      [60, 60],
      [60, 50],
    ];
    // Act
    const result = pointInAnyRing(5, 5, [farRing, SQUARE]);
    // Assert
    expect(result).toBe(true);
  });

  it('returns false for an empty rings array', () => {
    // Arrange / Act
    const result = pointInAnyRing(5, 5, []);
    // Assert
    expect(result).toBe(false);
  });

  it('returns false when the point is outside every ring', () => {
    // Arrange / Act
    const result = pointInAnyRing(100, 100, [SQUARE, NOTCHED_SQUARE, STAIRCASE]);
    // Assert
    expect(result).toBe(false);
  });

  it('never throws on degenerate rings mixed with valid ones', () => {
    // Arrange / Act / Assert
    expect(() =>
      pointInAnyRing(5, 5, [
        [],
        [[0, 0]],
        [
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        SQUARE,
      ])
    ).not.toThrow();
  });
});
