//! The corridor around the drawn line.
//!
//! Two jobs, both essential to making the search tractable:
//!
//! 1. **Pruning.** Any edge that strays far outside the corridor is removed from
//!    consideration entirely. On a city graph this is what turns an intractable
//!    search into an instant one, and it is also what makes the classic failure
//!    mode impossible: a shortcut that leaves the line cannot be chosen if the
//!    edges it would use are not in the graph the search sees.
//! 2. **Scoring.** Every surviving edge is measured against the sketch once, up
//!    front, so the hot loop in the matcher never recomputes geometry.

use crate::geo::LatLng;
use crate::graph::{EdgeId, Graph};
use crate::polyline::Polyline;

pub struct Corridor {
    pub width_m: f64,
    /// Mean deviation per edge, or infinity when the edge was pruned.
    deviation: Vec<f64>,
    inside: usize,
}

impl Corridor {
    /// Measure every edge against `sketch`.
    ///
    /// An edge is kept when *all* of its vertices lie within
    /// `width_m * prune_factor` of the sketch. Judging by the worst vertex
    /// rather than the mean stops a long edge from sneaking in because it
    /// happens to start and end near the line while bulging far away in the
    /// middle.
    pub fn build(graph: &Graph, sketch: &Polyline, width_m: f64, prune_factor: f64) -> Corridor {
        let cutoff = width_m * prune_factor;
        let mut deviation = vec![f64::INFINITY; graph.edge_count()];
        let mut inside = 0;

        for (id, slot) in deviation.iter_mut().enumerate() {
            let edge = graph.edge(id as EdgeId);
            let mut sum = 0.0;
            let mut worst: f64 = 0.0;
            let mut count = 0.0;

            for p in &edge.geometry {
                let d = sketch.closest(*p).distance_m;
                sum += d;
                count += 1.0;
                if d > worst {
                    worst = d;
                }
            }

            if count > 0.0 && worst <= cutoff {
                *slot = sum / count;
                inside += 1;
            }
        }

        Corridor {
            width_m,
            deviation,
            inside,
        }
    }

    /// Mean deviation of an edge from the sketch, or `None` when pruned.
    pub fn deviation_m(&self, id: EdgeId) -> Option<f64> {
        let d = self.deviation[id as usize];
        d.is_finite().then_some(d)
    }

    pub fn contains(&self, id: EdgeId) -> bool {
        self.deviation[id as usize].is_finite()
    }

    /// How many edges survived pruning. Useful for spotting a corridor that is
    /// so tight nothing can route through it.
    pub fn edges_inside(&self) -> usize {
        self.inside
    }
}

/// Ordered waypoints along the sketch.
///
/// The matcher requires these to be passed in sequence, which is what stops a
/// route from reversing direction or cutting the corner off a U-bend. Cost
/// alone does not prevent either, because a shortcut is by definition cheaper.
pub fn checkpoints(sketch: &Polyline, spacing_m: f64) -> Vec<LatLng> {
    if sketch.is_degenerate() {
        return sketch.points.clone();
    }
    sketch.resample(spacing_m).points
}
