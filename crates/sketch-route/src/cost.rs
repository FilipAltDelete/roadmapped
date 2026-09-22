//! What it costs to use an edge.
//!
//! The shape of the function is:
//!
//! ```text
//! cost = length * profile_multiplier * (1 + strictness * deviation / corridor_width)
//! ```
//!
//! Every factor is at least 1.0, so cost is never below true geometric length.
//! That is not an accident. It is the property that keeps the A* heuristic in
//! [`crate::matcher`] admissible, and therefore the search optimal.
//!
//! It is also why profile preferences are written as penalties on what you want
//! to avoid, never as bonuses on what you want. A bonus below 1.0 would let cost
//! drop under length and quietly break the guarantee.

use crate::graph::{Edge, Surface, WayKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileKind {
    Walk,
    Hike,
    Run,
    Gravel,
    Road,
}

#[derive(Debug, Clone, Copy)]
pub struct Profile {
    pub kind: ProfileKind,
}

impl Profile {
    pub const fn new(kind: ProfileKind) -> Self {
        Self { kind }
    }

    pub const fn walk() -> Self {
        Self::new(ProfileKind::Walk)
    }
    pub const fn hike() -> Self {
        Self::new(ProfileKind::Hike)
    }
    pub const fn run() -> Self {
        Self::new(ProfileKind::Run)
    }
    pub const fn gravel() -> Self {
        Self::new(ProfileKind::Gravel)
    }
    pub const fn road() -> Self {
        Self::new(ProfileKind::Road)
    }

    /// Multiplier for this edge, always at least 1.0, or `None` when the edge is
    /// not traversable under this profile.
    pub fn multiplier(&self, edge: &Edge) -> Option<f64> {
        use ProfileKind as P;
        use WayKind as W;

        let base = match self.kind {
            P::Walk | P::Run => match edge.kind {
                W::Footway | W::Path | W::Cycleway => 1.0,
                W::Trail | W::Track => 1.1,
                W::Steps => 1.4,
                W::Residential => 1.2,
                W::Secondary => 2.5,
                W::Major => 6.0,
                W::Unknown => 1.5,
            },
            P::Hike => match edge.kind {
                W::Trail | W::Path => 1.0,
                W::Track | W::Footway => 1.1,
                W::Steps => 1.2,
                W::Cycleway => 1.4,
                W::Residential => 2.0,
                W::Secondary => 5.0,
                W::Major => 10.0,
                W::Unknown => 1.5,
            },
            P::Gravel => match edge.kind {
                W::Track | W::Path | W::Cycleway => 1.0,
                W::Trail => 1.3,
                W::Residential => 1.2,
                W::Secondary => 2.0,
                W::Major => 6.0,
                W::Footway => 2.5,
                W::Unknown => 1.5,
                W::Steps => return None,
            },
            P::Road => match edge.kind {
                W::Cycleway | W::Residential => 1.0,
                W::Secondary => 1.2,
                W::Major => 2.0,
                W::Footway => 3.0,
                W::Path => 4.0,
                W::Unknown => 2.0,
                W::Trail | W::Track | W::Steps => return None,
            },
        };

        let surface = match (self.kind, edge.surface) {
            (P::Road, Surface::Ground) => 4.0,
            (P::Road, Surface::Gravel) => 2.0,
            (P::Gravel, Surface::Ground) => 1.2,
            _ => 1.0,
        };

        Some(base * surface)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct CostParams {
    /// Half-width of the band the route should stay inside, in metres.
    pub corridor_width_m: f64,
    /// How hard to punish leaving the line. This is the user-facing slider.
    ///
    /// At 0 the matcher degenerates into a shortest-path router inside the
    /// corridor, which is exactly what this project exists not to be. Higher
    /// values hug the line at the cost of longer, less natural routes.
    pub strictness: f64,
    /// Edges further than `corridor_width_m * prune_factor` from the sketch are
    /// discarded before the search starts.
    pub prune_factor: f64,
    /// Spacing of the ordered checkpoints along the sketch.
    pub checkpoint_spacing_m: f64,
    /// How near a node must come to count as reaching a checkpoint.
    pub checkpoint_radius_m: f64,
    /// How far the ends of the line may be moved to reach the network.
    ///
    /// A finger does not land on a path, and refusing to route because the
    /// stroke began in a field is not useful behaviour. The endpoints snap to
    /// the nearest node and the distance is reported, so the interface can say
    /// the line was moved rather than pretending it was not.
    ///
    /// The cap is what keeps that honest: past it there is no sensible nearest
    /// path and the failure is the right answer.
    pub max_snap_m: f64,
    /// Cost of giving up on a checkpoint.
    ///
    /// Without this, a checkpoint that lands in a lake or behind a fence makes
    /// the whole sketch unroutable. With it, the search pays a heavy price and
    /// carries on, which is the behaviour a user expects.
    pub checkpoint_skip_penalty_m: f64,
}

impl Default for CostParams {
    fn default() -> Self {
        Self {
            corridor_width_m: 75.0,
            strictness: 4.0,
            prune_factor: 3.0,
            checkpoint_spacing_m: 150.0,
            checkpoint_radius_m: 120.0,
            max_snap_m: 2_000.0,
            checkpoint_skip_penalty_m: 2_000.0,
        }
    }
}

/// Cost of traversing `edge`, given its precomputed mean deviation.
///
/// `None` means the profile cannot use this edge at all.
pub fn edge_cost(
    edge: &Edge,
    deviation_m: f64,
    params: &CostParams,
    profile: &Profile,
) -> Option<f64> {
    let multiplier = profile.multiplier(edge)?;
    let width = params.corridor_width_m.max(1.0);
    let deviation_term = 1.0 + params.strictness.max(0.0) * (deviation_m / width);
    Some(edge.length_m * multiplier * deviation_term)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geo::LatLng;

    fn edge(kind: WayKind, surface: Surface, length_m: f64) -> Edge {
        Edge {
            from: 0,
            to: 1,
            geometry: vec![LatLng::new(0.0, 0.0), LatLng::new(0.0, 0.0)],
            length_m,
            kind,
            surface,
        }
    }

    #[test]
    fn cost_never_falls_below_length() {
        // The admissibility guarantee the A* heuristic depends on.
        let params = CostParams::default();
        let kinds = [
            WayKind::Trail,
            WayKind::Path,
            WayKind::Footway,
            WayKind::Track,
            WayKind::Steps,
            WayKind::Cycleway,
            WayKind::Residential,
            WayKind::Secondary,
            WayKind::Major,
            WayKind::Unknown,
        ];
        let profiles = [
            Profile::walk(),
            Profile::hike(),
            Profile::run(),
            Profile::gravel(),
            Profile::road(),
        ];

        for profile in profiles {
            for kind in kinds {
                let e = edge(kind, Surface::Unknown, 100.0);
                if let Some(c) = edge_cost(&e, 0.0, &params, &profile) {
                    assert!(
                        c >= e.length_m,
                        "{kind:?} under {:?} cost {c}",
                        profile.kind
                    );
                }
            }
        }
    }

    #[test]
    fn deviation_raises_cost_in_proportion_to_strictness() {
        let e = edge(WayKind::Footway, Surface::Paved, 100.0);
        let params = CostParams {
            strictness: 4.0,
            corridor_width_m: 75.0,
            ..Default::default()
        };

        let on_line = edge_cost(&e, 0.0, &params, &Profile::walk()).unwrap();
        let off_line = edge_cost(&e, 75.0, &params, &Profile::walk()).unwrap();
        assert!((on_line - 100.0).abs() < 1e-9);
        assert!((off_line - 500.0).abs() < 1e-9);
    }

    #[test]
    fn road_bikes_refuse_trails_and_walkers_do_not() {
        let trail = edge(WayKind::Trail, Surface::Ground, 100.0);
        assert!(Profile::road().multiplier(&trail).is_none());
        assert!(Profile::walk().multiplier(&trail).is_some());
    }

    #[test]
    fn hiking_punishes_major_roads_far_harder_than_trails() {
        let trail = edge(WayKind::Trail, Surface::Ground, 100.0);
        let major = edge(WayKind::Major, Surface::Paved, 100.0);
        let hike = Profile::hike();
        assert!(hike.multiplier(&major).unwrap() > 5.0 * hike.multiplier(&trail).unwrap());
    }
}
