//! Ordered sequences of points, used for both the drawn sketch and the produced route.

use crate::geo::{project_on_segment, LatLng};

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Polyline {
    pub points: Vec<LatLng>,
}

/// Result of locating a point against a polyline.
#[derive(Debug, Clone, Copy)]
pub struct Closest {
    /// Perpendicular distance to the polyline, in metres.
    pub distance_m: f64,
    /// How far along the polyline the closest point lies, in metres.
    ///
    /// This is the progress parameter the matcher uses to tell forward travel
    /// from backtracking.
    pub arc_m: f64,
    /// Index of the segment the closest point lies on.
    pub segment: usize,
}

impl Polyline {
    pub fn new(points: Vec<LatLng>) -> Self {
        Self { points }
    }

    pub fn len(&self) -> usize {
        self.points.len()
    }

    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    /// A polyline needs at least two points to have direction or length.
    pub fn is_degenerate(&self) -> bool {
        self.points.len() < 2
    }

    pub fn first(&self) -> Option<LatLng> {
        self.points.first().copied()
    }

    pub fn last(&self) -> Option<LatLng> {
        self.points.last().copied()
    }

    pub fn length_m(&self) -> f64 {
        self.points.windows(2).map(|w| w[0].haversine_m(w[1])).sum()
    }

    /// Closest point on this polyline to `p`.
    pub fn closest(&self, p: LatLng) -> Closest {
        match self.points.len() {
            0 => Closest {
                distance_m: f64::INFINITY,
                arc_m: 0.0,
                segment: 0,
            },
            1 => Closest {
                distance_m: p.haversine_m(self.points[0]),
                arc_m: 0.0,
                segment: 0,
            },
            _ => {
                let mut best = Closest {
                    distance_m: f64::INFINITY,
                    arc_m: 0.0,
                    segment: 0,
                };
                let mut acc = 0.0;
                for (i, w) in self.points.windows(2).enumerate() {
                    let seg_len = w[0].haversine_m(w[1]);
                    let (t, d) = project_on_segment(p, w[0], w[1]);
                    if d < best.distance_m {
                        best = Closest {
                            distance_m: d,
                            arc_m: acc + t * seg_len,
                            segment: i,
                        };
                    }
                    acc += seg_len;
                }
                best
            }
        }
    }

    /// Douglas-Peucker simplification.
    ///
    /// A finger produces far more points than the route needs. Thinning the
    /// sketch before matching cuts corridor construction cost without changing
    /// the shape in any way a user would notice.
    pub fn simplify(&self, tolerance_m: f64) -> Polyline {
        if self.points.len() < 3 || tolerance_m <= 0.0 {
            return self.clone();
        }
        let mut out = Vec::with_capacity(self.points.len());
        douglas_peucker(&self.points, tolerance_m, &mut out);
        Polyline::new(out)
    }

    /// Place a point every `spacing_m` along the line, always keeping both ends.
    ///
    /// Used to generate checkpoints and to sample evenly when scoring metrics.
    pub fn resample(&self, spacing_m: f64) -> Polyline {
        if self.points.len() < 2 || spacing_m <= 0.0 {
            return self.clone();
        }
        let mut out = vec![self.points[0]];
        let mut target = spacing_m;
        let mut acc = 0.0;

        for w in self.points.windows(2) {
            let (a, b) = (w[0], w[1]);
            let seg = a.haversine_m(b);
            if seg <= 1e-9 {
                continue;
            }
            let (bx, by) = b.to_local(a);
            while target <= acc + seg {
                let t = (target - acc) / seg;
                out.push(LatLng::from_local(a, bx * t, by * t));
                target += spacing_m;
            }
            acc += seg;
        }

        let last = self.points[self.points.len() - 1];
        let keep_last = out
            .last()
            .map(|p| p.haversine_m(last) > spacing_m * 0.25)
            .unwrap_or(true);
        if keep_last {
            out.push(last);
        } else {
            let n = out.len();
            out[n - 1] = last;
        }
        Polyline::new(out)
    }

    /// Append another line, dropping a duplicated join point.
    pub fn append(&mut self, other: &Polyline) {
        for p in &other.points {
            if self.points.last().map(|l| l.haversine_m(*p) < 1e-6) == Some(true) {
                continue;
            }
            self.points.push(*p);
        }
    }
}

fn douglas_peucker(points: &[LatLng], tolerance_m: f64, out: &mut Vec<LatLng>) {
    let n = points.len();
    if n < 2 {
        out.extend_from_slice(points);
        return;
    }
    let (first, last) = (points[0], points[n - 1]);

    let mut worst = 0.0;
    let mut worst_idx = 0;
    for (i, p) in points.iter().enumerate().take(n - 1).skip(1) {
        let d = crate::geo::point_segment_distance_m(*p, first, last);
        if d > worst {
            worst = d;
            worst_idx = i;
        }
    }

    if worst > tolerance_m {
        douglas_peucker(&points[..=worst_idx], tolerance_m, out);
        out.pop(); // the split point would otherwise appear twice
        douglas_peucker(&points[worst_idx..], tolerance_m, out);
    } else {
        out.push(first);
        out.push(last);
    }
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
    fn length_sums_segments() {
        let line = local(&[(0.0, 0.0), (300.0, 0.0), (300.0, 400.0)]);
        assert!((line.length_m() - 700.0).abs() < 2.0);
    }

    #[test]
    fn simplify_drops_collinear_noise_but_keeps_corners() {
        let line = local(&[
            (0.0, 0.0),
            (100.0, 1.0),
            (200.0, -1.0),
            (300.0, 0.0),
            (300.0, 300.0),
        ]);
        let simple = line.simplify(10.0);
        assert_eq!(simple.len(), 3, "expected start, corner, end");
    }

    #[test]
    fn resample_is_evenly_spaced_and_keeps_both_ends() {
        let line = local(&[(0.0, 0.0), (1000.0, 0.0)]);
        let sampled = line.resample(100.0);
        assert_eq!(sampled.len(), 11);
        assert!(sampled.first().unwrap().haversine_m(line.first().unwrap()) < 1.0);
        assert!(sampled.last().unwrap().haversine_m(line.last().unwrap()) < 1.0);
    }

    #[test]
    fn closest_reports_progress_along_the_line() {
        let line = local(&[(0.0, 0.0), (1000.0, 0.0)]);
        let probe = LatLng::from_local(BASE, 400.0, 50.0);
        let c = line.closest(probe);
        assert!((c.distance_m - 50.0).abs() < 1.0);
        assert!((c.arc_m - 400.0).abs() < 2.0);
    }
}
