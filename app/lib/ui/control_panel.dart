/// The bottom panel.
///
/// Deliberately free of the map and of any plugin, so it can be widget tested
/// on a plain machine with no device attached.
library;

import 'package:flutter/material.dart';

import 'glass.dart';

class ControlPanel extends StatelessWidget {
  const ControlPanel({
    super.key,
    required this.drawing,
    required this.strictness,
    required this.pointCount,
    required this.onStrictnessChanged,
  });

  final bool drawing;
  final double strictness;
  final int pointCount;
  final ValueChanged<double> onStrictnessChanged;

  /// What the slider means at each end, in the user's terms rather than the
  /// cost function's.
  String get _strictnessWord {
    if (strictness <= 2) return 'Loose';
    if (strictness <= 5) return 'Balanced';
    if (strictness <= 9) return 'Close';
    return 'Exact';
  }

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 18),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                drawing ? Icons.gesture : Icons.map_outlined,
                size: 18,
                color: drawing ? Glass.accent : Glass.inkDim,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  drawing
                      ? 'Drawing. Drag to sketch a route.'
                      : 'Drag to move the map.',
                  style: const TextStyle(color: Glass.ink, fontSize: 14),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              const GlassLabel('Follow the line'),
              const Spacer(),
              GlassLabel(_strictnessWord, color: Glass.accent),
            ],
          ),
          SliderTheme(
            data: SliderThemeData(
              trackHeight: 3,
              activeTrackColor: Glass.accent,
              inactiveTrackColor: Glass.stroke,
              thumbColor: Glass.accent,
              overlayColor: Glass.accentSoft,
              thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 8),
              showValueIndicator: ShowValueIndicator.never,
            ),
            child: Slider(
              value: strictness,
              min: 0,
              max: 12,
              divisions: 12,
              onChanged: onStrictnessChanged,
            ),
          ),
          Text(
            pointCount > 0
                ? '$pointCount points. Matching is not wired up yet.'
                : 'No route drawn.',
            style: const TextStyle(color: Glass.inkDim, fontSize: 12),
          ),
        ],
      ),
    );
  }
}
