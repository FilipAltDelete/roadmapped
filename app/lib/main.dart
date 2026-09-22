/// Roadmapped.
///
/// Draw a line on the map with your finger and the app finds the real route
/// that follows that line most closely. Not the fastest route, not the
/// shortest. The one shaped like what you drew.
///
/// This screen owns the drawing interaction. The matching engine it will call
/// lives in `crates/sketch-route` and is not wired up yet.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import 'sketch.dart';
import 'ui/control_panel.dart';
import 'ui/glass.dart';

/// A dark basemap, so the drawn line and the eventual route are the brightest
/// things on screen. Free and keyless, which matters because this app has no
/// backend and is not going to grow one just to serve tiles.
const _styleUrl =
    'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const _sketchSource = 'sketch-source';
const _sketchHaloLayer = 'sketch-halo';
const _sketchLineLayer = 'sketch-line';

void main() => runApp(const RoadmappedApp());

class RoadmappedApp extends StatelessWidget {
  const RoadmappedApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Roadmapped',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0B0D10),
        colorScheme: const ColorScheme.dark(
          primary: Glass.accent,
          surface: Color(0xFF0B0D10),
        ),
        fontFamily: 'Roboto',
      ),
      home: const MapScreen(),
    );
  }
}

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  MapLibreMapController? _controller;
  bool _styleReady = false;

  /// Explicit mode rather than an inferred gesture.
  ///
  /// A drag over a map has to mean either pan or draw, never both. Guessing
  /// from pressure or timing feels clever and fails constantly, so the user
  /// says which they mean and the map's own gestures are switched off while
  /// drawing.
  bool _drawing = false;

  double _strictness = 4;

  /// The stroke in progress, in logical screen pixels.
  ///
  /// Held in screen space so it can render at sixty frames per second without
  /// touching the platform channel. It is converted to geographic coordinates
  /// once, when the finger lifts.
  List<Offset> _stroke = const [];

  /// The committed route, in geographic coordinates, anchored to the map.
  List<LatLng> _route = const [];

  bool _converting = false;

  bool get _hasRoute => _route.length > 1;

  Future<void> _onStyleLoaded() async {
    final c = _controller;
    if (c == null) return;

    await c.addSource(
      _sketchSource,
      const GeojsonSourceProperties(data: _emptyFeatureCollection),
    );
    // Two layers, so the line reads against both pale streets and dark parks:
    // a wide soft halo underneath, a crisp stroke on top.
    await c.addLineLayer(
      _sketchSource,
      _sketchHaloLayer,
      const LineLayerProperties(
        lineColor: '#FF4B4B',
        lineWidth: 14.0,
        lineOpacity: 0.22,
        lineCap: 'round',
        lineJoin: 'round',
      ),
    );
    await c.addLineLayer(
      _sketchSource,
      _sketchLineLayer,
      const LineLayerProperties(
        lineColor: '#FF4B4B',
        lineWidth: 4.0,
        lineCap: 'round',
        lineJoin: 'round',
      ),
    );

    if (mounted) setState(() => _styleReady = true);
  }

  void _appendPoint(Offset p) {
    // Thin as we capture. A finger emits far more points than the shape needs.
    const minSpacing = 2.0;
    if (_stroke.isNotEmpty && (p - _stroke.last).distance < minSpacing) return;
    setState(() => _stroke = [..._stroke, p]);
  }

  void _startStroke(Offset p) {
    // A new stroke replaces the old route rather than extending it. Appending
    // would join the two with a straight segment the user never drew, which is
    // both wrong and invisible until the route comes back looking absurd.
    setState(() {
      _stroke = [p];
      _route = const [];
    });
    _clearMapLine();
  }

  Future<void> _endStroke() async {
    final raw = _stroke;
    if (!isDeliberateStroke(raw)) {
      setState(() => _stroke = const []);
      return;
    }

    final c = _controller;
    if (c == null) return;

    setState(() => _converting = true);

    // Thin before converting. Each surviving point is one platform channel
    // round trip, so an unthinned stroke turns this into a visible stall.
    final thinned = simplify(raw, 3.0);

    // The plugin's projection works in device pixels, while Flutter hands us
    // logical ones. Without this the line lands somewhere the user never drew,
    // by a factor of the screen's pixel ratio.
    final ratio = MediaQuery.devicePixelRatioOf(context);

    List<LatLng> converted;
    try {
      converted = [
        for (final p in thinned)
          await c.toLatLng(math.Point<double>(p.dx * ratio, p.dy * ratio)),
      ];
    } catch (error) {
      // A failed conversion must not strand the interface mid-stroke with a
      // spinner that never stops and a line that never appears.
      if (!mounted) return;
      setState(() {
        _stroke = const [];
        _converting = false;
      });
      _showError('Could not place that line on the map.');
      return;
    }

    if (!mounted) return;
    setState(() {
      _route = converted;
      _stroke = const [];
      _converting = false;
    });
    await _pushMapLine(converted);
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: const Color(0xFF1A1D22),
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 240),
      ),
    );
  }

  Future<void> _pushMapLine(List<LatLng> points) async {
    final c = _controller;
    if (c == null || !_styleReady) return;
    await c.setGeoJsonSource(_sketchSource, {
      'type': 'FeatureCollection',
      'features': [
        {
          'type': 'Feature',
          'properties': const <String, Object?>{},
          'geometry': {
            'type': 'LineString',
            'coordinates': [
              for (final p in points) [p.longitude, p.latitude],
            ],
          },
        },
      ],
    });
  }

  Future<void> _clearMapLine() async {
    final c = _controller;
    if (c == null || !_styleReady) return;
    await c.setGeoJsonSource(_sketchSource, _emptyFeatureCollection);
  }

  void _clearAll() {
    setState(() {
      _stroke = const [];
      _route = const [];
    });
    _clearMapLine();
  }

  @override
  Widget build(BuildContext context) {
    final padding = MediaQuery.paddingOf(context);
    final pointCount = _stroke.isNotEmpty ? _stroke.length : _route.length;

    return Scaffold(
      body: Stack(
        children: [
          MapLibreMap(
            styleString: _styleUrl,
            initialCameraPosition: const CameraPosition(
              target: LatLng(59.3293, 18.0686),
              zoom: 13,
            ),
            onMapCreated: (c) => _controller = c,
            onStyleLoadedCallback: _onStyleLoaded,
            // The map must not pan while a line is being drawn.
            scrollGesturesEnabled: !_drawing,
            rotateGesturesEnabled: !_drawing,
            tiltGesturesEnabled: !_drawing,
            zoomGesturesEnabled: !_drawing,
            compassEnabled: false,
            attributionButtonPosition: AttributionButtonPosition.topLeft,
          ),

          // Capture layer. Transparent to touches unless drawing, so the map
          // receives gestures normally the rest of the time.
          Positioned.fill(
            child: IgnorePointer(
              ignoring: !_drawing,
              child: GestureDetector(
                key: const ValueKey('draw-surface'),
                behavior: HitTestBehavior.opaque,
                onPanStart: (d) => _startStroke(d.localPosition),
                onPanUpdate: (d) => _appendPoint(d.localPosition),
                onPanEnd: (_) => _endStroke(),
                child: CustomPaint(
                  painter: _StrokePainter(_stroke),
                  size: Size.infinite,
                ),
              ),
            ),
          ),

          Positioned(
            top: padding.top + 12,
            left: 16,
            child: _TitlePill(converting: _converting),
          ),

          Positioned(
            right: 16,
            bottom: padding.bottom + 210,
            child: Column(
              children: [
                GlassButton(
                  icon: _drawing ? Icons.check : Icons.gesture,
                  tooltip: _drawing ? 'Done drawing' : 'Draw a route',
                  active: _drawing,
                  size: 60,
                  onPressed: () => setState(() => _drawing = !_drawing),
                ),
                const SizedBox(height: 12),
                GlassButton(
                  icon: Icons.delete_outline,
                  tooltip: 'Clear',
                  onPressed: _hasRoute || _stroke.isNotEmpty ? _clearAll : null,
                ),
              ],
            ),
          ),

          Positioned(
            left: 16,
            right: 16,
            bottom: padding.bottom + 16,
            child: ControlPanel(
              drawing: _drawing,
              strictness: _strictness,
              pointCount: pointCount,
              onStrictnessChanged: (v) => setState(() => _strictness = v),
            ),
          ),
        ],
      ),
    );
  }
}

const _emptyFeatureCollection = <String, Object?>{
  'type': 'FeatureCollection',
  'features': <Object?>[],
};

class _TitlePill extends StatelessWidget {
  const _TitlePill({required this.converting});

  final bool converting;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      radius: 18,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'Roadmapped',
            style: TextStyle(
              color: Glass.ink,
              fontSize: 15,
              fontWeight: FontWeight.w600,
              letterSpacing: -0.2,
            ),
          ),
          if (converting) ...[
            const SizedBox(width: 10),
            const SizedBox(
              width: 12,
              height: 12,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Glass.accent,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Renders the stroke in progress.
///
/// Only the live stroke. Once the finger lifts, the line is handed to the map
/// so it pans and zooms with the terrain instead of floating over it.
class _StrokePainter extends CustomPainter {
  const _StrokePainter(this.points);

  final List<Offset> points;

  @override
  void paint(Canvas canvas, Size size) {
    if (points.length < 2) return;

    final path = Path()..moveTo(points.first.dx, points.first.dy);
    for (final p in points.skip(1)) {
      path.lineTo(p.dx, p.dy);
    }

    canvas
      ..drawPath(
        path,
        Paint()
          ..color = Glass.accent.withValues(alpha: 0.22)
          ..strokeWidth = 14
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..style = PaintingStyle.stroke,
      )
      ..drawPath(
        path,
        Paint()
          ..color = Glass.accent
          ..strokeWidth = 4
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..style = PaintingStyle.stroke,
      );
  }

  @override
  bool shouldRepaint(_StrokePainter old) => old.points.length != points.length;
}
