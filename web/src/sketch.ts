/**
 * Screen-space geometry for the drawn sketch.
 *
 * Kept free of the DOM and of the map so it can be unit tested without a
 * browser. Everything here works in CSS pixels; conversion to latitude and
 * longitude happens once, at the end of a stroke.
 *
 * This is a port of the Flutter client's `sketch.dart`, and the tests came with
 * it. The thinning here is a cheap first pass in pixel space: the thinning that
 * decides route quality is done in metres, inside the Rust engine, where a
 * tolerance has a meaning that survives a change of zoom level.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Thin a freehand stroke with the Douglas-Peucker algorithm.
 *
 * A finger emits hundreds of points for a shape that needs tens. Thinning here
 * keeps the live path element small enough to re-render at sixty frames per
 * second while the finger is still moving.
 */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length < 3 || tolerance <= 0) return [...points];
  const out: Point[] = [];
  douglasPeucker(points, 0, points.length - 1, tolerance, out);
  out.push(points[points.length - 1]);
  return out;
}

function douglasPeucker(
  pts: readonly Point[],
  first: number,
  last: number,
  tolerance: number,
  out: Point[],
): void {
  let worst = 0;
  let worstIndex = 0;

  for (let i = first + 1; i < last; i++) {
    const d = distanceToSegment(pts[i], pts[first], pts[last]);
    if (d > worst) {
      worst = d;
      worstIndex = i;
    }
  }

  if (worst > tolerance) {
    douglasPeucker(pts, first, worstIndex, tolerance, out);
    douglasPeucker(pts, worstIndex, last, tolerance, out);
  } else {
    out.push(pts[first]);
  }
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);

  const t = Math.min(
    1,
    Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared),
  );
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Total length of a stroke in pixels. */
export function strokeLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * Whether a stroke is long enough to be a deliberate line rather than a tap.
 *
 * Without this, every stray touch on the map would wipe a drawn route.
 */
export function isDeliberateStroke(points: readonly Point[]): boolean {
  return points.length >= 3 && strokeLength(points) >= 24;
}

/** Smallest rectangle containing the stroke, or null when there is nothing. */
export function strokeBounds(points: readonly Point[]): Bounds | null {
  if (points.length === 0) return null;
  let left = points[0].x;
  let right = points[0].x;
  let top = points[0].y;
  let bottom = points[0].y;
  for (const p of points) {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  }
  return { left, top, right, bottom };
}

/** An SVG path `d` attribute for a stroke, or empty when there is nothing to draw. */
export function toPathData(points: readonly Point[]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
  }
  return d;
}
