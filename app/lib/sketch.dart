/// Screen-space geometry for the drawn sketch.
///
/// Kept free of Flutter widgets and of the map so it can be unit tested without
/// a device. Everything here works in screen pixels; conversion to latitude and
/// longitude happens once, at the end of a stroke.
library;

import 'dart:math' as math;
import 'dart:ui' show Offset;

/// Thin a freehand stroke with the Douglas-Peucker algorithm.
///
/// A finger emits hundreds of points for a shape that needs tens. Thinning
/// matters here for a specific reason: every surviving point costs one platform
/// channel round trip when screen coordinates are converted to geographic ones,
/// so an unthinned stroke turns a cheap conversion into a visible stall.
List<Offset> simplify(List<Offset> points, double tolerance) {
  if (points.length < 3 || tolerance <= 0) return List.of(points);
  final out = <Offset>[];
  _douglasPeucker(points, 0, points.length - 1, tolerance, out);
  out.add(points.last);
  return out;
}

void _douglasPeucker(
  List<Offset> pts,
  int first,
  int last,
  double tolerance,
  List<Offset> out,
) {
  var worst = 0.0;
  var worstIndex = 0;

  for (var i = first + 1; i < last; i++) {
    final d = _distanceToSegment(pts[i], pts[first], pts[last]);
    if (d > worst) {
      worst = d;
      worstIndex = i;
    }
  }

  if (worst > tolerance) {
    _douglasPeucker(pts, first, worstIndex, tolerance, out);
    _douglasPeucker(pts, worstIndex, last, tolerance, out);
  } else {
    out.add(pts[first]);
  }
}

double _distanceToSegment(Offset p, Offset a, Offset b) {
  final dx = b.dx - a.dx;
  final dy = b.dy - a.dy;
  final lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 1e-12) return (p - a).distance;

  final t = (((p.dx - a.dx) * dx + (p.dy - a.dy) * dy) / lengthSquared)
      .clamp(0.0, 1.0);
  return (p - Offset(a.dx + dx * t, a.dy + dy * t)).distance;
}

/// Total length of a stroke in pixels.
double strokeLength(List<Offset> points) {
  var total = 0.0;
  for (var i = 1; i < points.length; i++) {
    total += (points[i] - points[i - 1]).distance;
  }
  return total;
}

/// Whether a stroke is long enough to be a deliberate line rather than a tap.
///
/// Without this, every stray tap on the map would clear the drawn route.
bool isDeliberateStroke(List<Offset> points) =>
    points.length >= 3 && strokeLength(points) >= 24.0;

/// Smallest rectangle containing the stroke, or null when there is nothing.
math.Rectangle<double>? strokeBounds(List<Offset> points) {
  if (points.isEmpty) return null;
  var minX = points.first.dx, maxX = points.first.dx;
  var minY = points.first.dy, maxY = points.first.dy;
  for (final p in points) {
    minX = math.min(minX, p.dx);
    maxX = math.max(maxX, p.dx);
    minY = math.min(minY, p.dy);
    maxY = math.max(maxY, p.dy);
  }
  return math.Rectangle<double>(minX, minY, maxX - minX, maxY - minY);
}
