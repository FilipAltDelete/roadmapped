// Geometry the drawing depends on, tested without a browser.
//
// Ported from the Flutter client's `sketch_test.dart`. The cases are the same
// because the behaviour they pin down is the same, and a stroke that thinned
// correctly under a thumb on Android has to keep thinning correctly here.

import { describe, expect, it } from 'vitest';
import { isDeliberateStroke, simplify, strokeBounds, toPathData } from '../src/sketch';

const at = (x: number, y: number) => ({ x, y });

describe('simplify', () => {
  it('drops points that sit on a straight line', () => {
    const line = [at(0, 0), at(10, 0.4), at(20, -0.3), at(30, 0)];
    expect(simplify(line, 2)).toHaveLength(2);
  });

  it('keeps a genuine corner', () => {
    const corner = [at(0, 0), at(50, 0), at(100, 0), at(100, 80)];
    expect(simplify(corner, 2)).toHaveLength(3);
  });

  it('always keeps both ends', () => {
    const points = Array.from({ length: 40 }, (_, i) => at(i * 5, i * 5));
    const out = simplify(points, 4);
    expect(out[0]).toEqual(points[0]);
    expect(out[out.length - 1]).toEqual(points[points.length - 1]);
  });

  it('leaves short strokes alone', () => {
    const points = [at(0, 0), at(5, 5)];
    expect(simplify(points, 2)).toEqual(points);
  });
});

describe('isDeliberateStroke', () => {
  it('rejects a tap, so a stray touch cannot wipe a drawn route', () => {
    expect(isDeliberateStroke([at(10, 10)])).toBe(false);
    expect(isDeliberateStroke([at(10, 10), at(12, 11)])).toBe(false);
  });

  it('accepts a real drag', () => {
    const drag = Array.from({ length: 20 }, (_, i) => at(i * 8, i * 3));
    expect(isDeliberateStroke(drag)).toBe(true);
  });
});

describe('strokeBounds', () => {
  it('covers every point', () => {
    const b = strokeBounds([at(10, 40), at(-5, 90), at(60, 12)])!;
    expect(b).toEqual({ left: -5, top: 12, right: 60, bottom: 90 });
  });

  it('is null when there is nothing', () => {
    expect(strokeBounds([])).toBeNull();
  });
});

describe('toPathData', () => {
  it('is empty below two points, so the live path renders nothing', () => {
    expect(toPathData([])).toBe('');
    expect(toPathData([at(1, 2)])).toBe('');
  });

  it('moves once and then lines', () => {
    expect(toPathData([at(1, 2), at(3, 4)])).toBe('M 1.0 2.0 L 3.0 4.0');
  });
});
