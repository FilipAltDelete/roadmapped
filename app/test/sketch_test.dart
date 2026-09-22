// Geometry the drawing depends on, tested without a device.


import 'package:flutter_test/flutter_test.dart';
import 'package:roadmapped/sketch.dart';

void main() {
  group('simplify', () {
    test('drops points that sit on a straight line', () {
      final line = [
        const Offset(0, 0),
        const Offset(10, 0.4),
        const Offset(20, -0.3),
        const Offset(30, 0),
      ];
      expect(simplify(line, 2).length, 2);
    });

    test('keeps a genuine corner', () {
      final corner = [
        const Offset(0, 0),
        const Offset(50, 0),
        const Offset(100, 0),
        const Offset(100, 80),
      ];
      expect(simplify(corner, 2).length, 3);
    });

    test('always keeps both ends', () {
      final pts = List.generate(40, (i) => Offset(i * 5, i * 5.0));
      final out = simplify(pts, 4);
      expect(out.first, pts.first);
      expect(out.last, pts.last);
    });

    test('leaves short strokes alone', () {
      final pts = [const Offset(0, 0), const Offset(5, 5)];
      expect(simplify(pts, 2), pts);
    });
  });

  group('isDeliberateStroke', () {
    test('rejects a tap, so a stray touch cannot wipe a drawn route', () {
      expect(isDeliberateStroke([const Offset(10, 10)]), isFalse);
      expect(
        isDeliberateStroke([const Offset(10, 10), const Offset(12, 11)]),
        isFalse,
      );
    });

    test('accepts a real drag', () {
      final drag = List.generate(20, (i) => Offset(i * 8, i * 3.0));
      expect(isDeliberateStroke(drag), isTrue);
    });
  });

  test('strokeBounds covers every point', () {
    final pts = [
      const Offset(10, 40),
      const Offset(-5, 90),
      const Offset(60, 12),
    ];
    final b = strokeBounds(pts)!;
    expect(b.left, -5);
    expect(b.top, 12);
    expect(b.right, 60);
    expect(b.bottom, 90);
    expect(strokeBounds(const []), isNull);
  });
}
