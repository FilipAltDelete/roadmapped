/// Frosted glass surfaces.
///
/// The map is the content; every control floats above it. Panels are
/// translucent so the map stays legible underneath, which matters when a route
/// runs behind the bottom panel.
library;

import 'dart:ui';

import 'package:flutter/material.dart';

/// Palette. Tuned against a dark basemap, where mid greys disappear and only
/// near-black and near-white read reliably.
abstract final class Glass {
  static const accent = Color(0xFFFF4B4B);
  static const accentSoft = Color(0x33FF4B4B);
  static const ink = Color(0xFFF2F4F7);
  static const inkDim = Color(0xFF9BA3AE);

  static const fill = Color(0x14FFFFFF);
  static const fillStrong = Color(0x24FFFFFF);
  static const stroke = Color(0x26FFFFFF);
  static const shadow = Color(0x66000000);

  static const radius = 26.0;
  static const blur = 24.0;
}

/// A blurred, translucent panel.
class GlassPanel extends StatelessWidget {
  const GlassPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.radius = Glass.radius,
    this.strong = false,
  });

  final Widget child;
  final EdgeInsets padding;
  final double radius;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: Glass.blur, sigmaY: Glass.blur),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: strong ? Glass.fillStrong : Glass.fill,
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(color: Glass.stroke),
          ),
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

/// A round glass button, for controls that sit directly on the map.
class GlassButton extends StatelessWidget {
  const GlassButton({
    super.key,
    required this.icon,
    required this.onPressed,
    this.tooltip,
    this.active = false,
    this.size = 52,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final String? tooltip;
  final bool active;
  final double size;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;

    final button = ClipOval(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: Glass.blur, sigmaY: Glass.blur),
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: active ? Glass.accent : Glass.fill,
            border: Border.all(
              color: active ? Glass.accent : Glass.stroke,
            ),
            boxShadow: active
                ? const [
                    BoxShadow(
                      color: Glass.accentSoft,
                      blurRadius: 18,
                      spreadRadius: 2,
                    ),
                  ]
                : null,
          ),
          child: Material(
            color: Colors.transparent,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onPressed,
              child: Icon(
                icon,
                size: size * 0.42,
                color: active
                    ? Colors.white
                    : enabled
                        ? Glass.ink
                        : Glass.inkDim.withValues(alpha: 0.4),
              ),
            ),
          ),
        ),
      ),
    );

    return tooltip == null
        ? button
        : Tooltip(message: tooltip!, child: button);
  }
}

/// Small uppercase caption used for labels inside panels.
class GlassLabel extends StatelessWidget {
  const GlassLabel(this.text, {super.key, this.color});

  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: TextStyle(
        color: color ?? Glass.inkDim,
        fontSize: 11,
        letterSpacing: 1.1,
        fontWeight: FontWeight.w600,
      ),
    );
  }
}
