//! Scoring how well a route follows the line that was drawn.
//!
//! This module is the referee for the whole project. "Looks better on this one
//! sketch" is not evidence. Any change to the cost function or the search has to
//! be justified against these numbers, run over the canonical sketch set.
//!
//! Both directions are measured on purpose. Route-to-sketch catches a route that
//! wanders off. Sketch-to-route catches a route that quietly skips a whole
//! section of the drawing, which the first measure alone would score as perfect.

use crate::polyline::Polyline;

#[derive(Debug, Clone, Copy, Default)]
pub struct Metrics {
    pub route_length_m: f64,
    pub sketch_length_m: f64,
    /// Route length over sketch length. Near 1.0 is good. Large means detours.
    pub length_ratio: f64,

    /// How far the route strays from the line.
    pub mean_route_to_sketch_m: f64,
    pub max_route_to_sketch_m: f64,

    /// How much of the line the route failed to cover.
    pub mean_sketch_to_route_m: f64,
    pub max_sketch_to_route_m: f64,

    /// Worst-case ordered deviation, respecting direction of travel.
    pub frechet_m: f64,

    /// Share of sampled route points lying inside the corridor, from 0.0 to 1.0.
    pub corridor_share: f64,
}

impl Metrics {
    /// One line, for printing a table across the canonical sketch set.
    pub fn summary(&self) -> String {
        format!(
            "len {:.0}m (x{:.2})  dev mean {:.0}m max {:.0}m  miss mean {:.0}m max {:.0}m  frechet {:.0}m  inside {:.0}%",
            self.route_length_m,
            self.length_ratio,
            self.mean_route_to_sketch_m,
            self.max_route_to_sketch_m,
            self.mean_sketch_to_route_m,
            self.max_sketch_to_route_m,
            self.frechet_m,
            self.corridor_share * 100.0,
        )
    }
}

/// Score `route` against `sketch`.
///
/// `sample_m` controls how finely both lines are walked. Smaller is more
/// accurate and slower. Twenty metres is a sensible default.
pub fn evaluate(
    sketch: &Polyline,
    route: &Polyline,
    corridor_width_m: f64,
    sample_m: f64,
) -> Metrics {
    if sketch.is_degenerate() || route.is_degenerate() {
        return Metrics::default();
    }

    let sketch_pts = sketch.resample(sample_m);
    let route_pts = route.resample(sample_m);

    let (mean_rs, max_rs, inside) = {
        let mut sum = 0.0;
        let mut worst: f64 = 0.0;
        let mut inside = 0usize;
        for p in &route_pts.points {
            let d = sketch.closest(*p).distance_m;
            sum += d;
            worst = worst.max(d);
            if d <= corridor_width_m {
                inside += 1;
            }
        }
        let n = route_pts.points.len().max(1) as f64;
        (sum / n, worst, inside as f64 / n)
    };

    let (mean_sr, max_sr) = {
        let mut sum = 0.0;
        let mut worst: f64 = 0.0;
        for p in &sketch_pts.points {
            let d = route.closest(*p).distance_m;
            sum += d;
            worst = worst.max(d);
        }
        let n = sketch_pts.points.len().max(1) as f64;
        (sum / n, worst)
    };

    let sketch_length_m = sketch.length_m();
    let route_length_m = route.length_m();

    Metrics {
        route_length_m,
        sketch_length_m,
        length_ratio: if sketch_length_m > 0.0 {
            route_length_m / sketch_length_m
        } else {
            0.0
        },
        mean_route_to_sketch_m: mean_rs,
        max_route_to_sketch_m: max_rs,
        mean_sketch_to_route_m: mean_sr,
        max_sketch_to_route_m: max_sr,
        frechet_m: discrete_frechet_m(&sketch_pts, &route_pts),
        corridor_share: inside,
    }
}

/// Discrete Frechet distance between two ordered point sequences, in metres.
///
/// The usual picture is a walker on each line, neither allowed to go backwards,
/// choosing their pace to keep the leash as short as possible. The result is the
/// shortest leash that works. Unlike a mean, it respects ordering, so a route
/// that covers the same ground in the wrong sequence scores badly.
///
/// Runs in O(n*m) time and O(m) space. Resample before calling on long lines.
pub fn discrete_frechet_m(a: &Polyline, b: &Polyline) -> f64 {
    let (n, m) = (a.points.len(), b.points.len());
    if n == 0 || m == 0 {
        return f64::INFINITY;
    }

    let mut prev = vec![0.0f64; m];
    let mut cur = vec![0.0f64; m];

    for i in 0..n {
        for j in 0..m {
            let d = a.points[i].haversine_m(b.points[j]);
            cur[j] = if i == 0 && j == 0 {
                d
            } else if i == 0 {
                cur[j - 1].max(d)
            } else if j == 0 {
                prev[j].max(d)
            } else {
                cur[j - 1].min(prev[j]).min(prev[j - 1]).max(d)
            };
        }
        std::mem::swap(&mut prev, &mut cur);
    }

    prev[m - 1]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geo::LatLng;

    const BASE: LatLng = LatLng::new(59.3293, 18.0686);

    fn local(pts: &[(f64, f64)]) -> Polyline {
        Polyline::new(
            pts.iter()
                .map(|(e, n)| LatLng::from_local(BASE, *e, *n))
                .collect(),
        )
    }

    #[test]
    fn identical_lines_score_zero() {
        let line = local(&[(0.0, 0.0), (500.0, 0.0), (500.0, 500.0)]);
        let m = evaluate(&line, &line, 75.0, 20.0);
        assert!(m.max_route_to_sketch_m < 1.0);
        assert!(m.frechet_m < 1.0);
        assert!((m.length_ratio - 1.0).abs() < 0.01);
        assert!(m.corridor_share > 0.99);
    }

    #[test]
    fn a_parallel_offset_route_reports_that_offset() {
        let sketch = local(&[(0.0, 0.0), (1000.0, 0.0)]);
        let route = local(&[(0.0, 40.0), (1000.0, 40.0)]);
        let m = evaluate(&sketch, &route, 75.0, 20.0);
        assert!((m.mean_route_to_sketch_m - 40.0).abs() < 2.0);
        assert!(
            m.corridor_share > 0.99,
            "40 m offset sits inside a 75 m corridor"
        );
    }

    #[test]
    fn skipping_half_the_sketch_is_invisible_one_way_and_obvious_the_other() {
        // A route that covers only the first half sits perfectly on the line,
        // so route-to-sketch looks flawless. Only sketch-to-route catches it.
        let sketch = local(&[(0.0, 0.0), (1000.0, 0.0)]);
        let route = local(&[(0.0, 0.0), (500.0, 0.0)]);
        let m = evaluate(&sketch, &route, 75.0, 20.0);
        assert!(m.max_route_to_sketch_m < 1.0);
        assert!(m.max_sketch_to_route_m > 400.0);
    }

    #[test]
    fn frechet_penalises_travelling_the_line_backwards() {
        let forward = local(&[(0.0, 0.0), (1000.0, 0.0)]);
        let backward = local(&[(1000.0, 0.0), (0.0, 0.0)]);
        assert!(discrete_frechet_m(&forward, &backward) > 900.0);
        assert!(discrete_frechet_m(&forward, &forward) < 1.0);
    }
}
