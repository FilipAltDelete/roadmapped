// The bottom panel, tested in isolation.
//
// The map screen itself needs a platform view and cannot run here, which is
// exactly why the panel is a separate widget that knows nothing about maps.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:roadmapped/ui/control_panel.dart';

void main() {
  Future<void> pumpPanel(
    WidgetTester tester, {
    bool drawing = false,
    double strictness = 4,
    int pointCount = 0,
    ValueChanged<double>? onStrictnessChanged,
  }) {
    return tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ControlPanel(
            drawing: drawing,
            strictness: strictness,
            pointCount: pointCount,
            onStrictnessChanged: onStrictnessChanged ?? (_) {},
          ),
        ),
      ),
    );
  }

  testWidgets('explains that dragging moves the map when not drawing',
      (tester) async {
    await pumpPanel(tester);
    expect(find.text('Drag to move the map.'), findsOneWidget);
    expect(find.text('No route drawn.'), findsOneWidget);
  });

  testWidgets('explains that dragging sketches while drawing', (tester) async {
    await pumpPanel(tester, drawing: true);
    expect(find.text('Drawing. Drag to sketch a route.'), findsOneWidget);
  });

  testWidgets('reports the captured point count', (tester) async {
    await pumpPanel(tester, pointCount: 142);
    expect(find.textContaining('142 points'), findsOneWidget);
    expect(find.text('No route drawn.'), findsNothing);
  });

  testWidgets('names the strictness setting rather than showing a number',
      (tester) async {
    // A bare number means nothing to someone drawing a walk.
    for (final (value, word) in const [
      (0.0, 'LOOSE'),
      (4.0, 'BALANCED'),
      (8.0, 'CLOSE'),
      (12.0, 'EXACT'),
    ]) {
      await pumpPanel(tester, strictness: value);
      expect(find.text(word), findsOneWidget, reason: 'at $value');
    }
  });

  testWidgets('strictness spans shortest-path to hugging the line',
      (tester) async {
    await pumpPanel(tester);
    final slider = tester.widget<Slider>(find.byType(Slider));
    expect(slider.min, 0.0);
    expect(slider.max, 12.0);
  });

  testWidgets('reports strictness changes', (tester) async {
    double? seen;
    await pumpPanel(tester, onStrictnessChanged: (v) => seen = v);
    await tester.tapAt(tester.getCenter(find.byType(Slider)));
    await tester.pumpAndSettle();
    expect(seen, isNotNull);
  });
}
