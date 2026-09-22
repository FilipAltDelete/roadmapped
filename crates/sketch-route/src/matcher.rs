//! Corridor-constrained A*.
//!
//! The search state is a pair: which node you are standing on, and how many of
//! the ordered checkpoints along the sketch you have already collected. Carrying
//! checkpoint progress in the state is what makes the result follow the drawn
//! line rather than merely stay near it.
//!
//! Cost alone cannot do that. A route that cuts the corner off a U-bend is
//! shorter than one that goes around it, so any pure cost formulation prefers
//! the shortcut. Requiring the checkpoints to be collected in order removes the
//! shortcut from the search space instead of trying to out-price it.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::fmt;

use crate::corridor::{checkpoints, Corridor};
use crate::cost::{edge_cost, CostParams, Profile};
use crate::geo::LatLng;
use crate::graph::{EdgeId, Graph, NodeId};
use crate::polyline::Polyline;

#[derive(Debug, Clone)]
pub struct MatchRequest {
    pub sketch: Polyline,
    pub profile: Profile,
    pub params: CostParams,
}

impl MatchRequest {
    pub fn new(sketch: Polyline, profile: Profile) -> Self {
        Self {
            sketch,
            profile,
            params: CostParams::default(),
        }
    }

    pub fn with_strictness(mut self, strictness: f64) -> Self {
        self.params.strictness = strictness;
        self
    }
}

#[derive(Debug, Clone)]
pub struct MatchResult {
    pub edges: Vec<EdgeId>,
    pub geometry: Polyline,
    pub length_m: f64,
    /// Total search cost. Comparable only between runs with identical parameters.
    pub cost: f64,
    /// Checkpoints the search could not reach.
    ///
    /// Each one is a place where the route had to abandon the drawn line. This
    /// is the signal the user interface should surface as a gap rather than
    /// hide.
    pub checkpoints_skipped: usize,
    pub checkpoints_total: usize,
    /// How far the start of the line was moved to reach the network, in metres.
    ///
    /// Zero when the line already began on a path. Anything large is a
    /// compromise the user should be told about rather than left to notice.
    pub start_snap_m: f64,
    /// The same for the end of the line.
    pub goal_snap_m: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MatchError {
    /// Fewer than two points, so there is no line to follow.
    SketchTooShort,
    /// Nothing routable within `max_snap_m` of where the line begins.
    NoStartNode,
    /// Nothing routable within `max_snap_m` of where the line ends.
    NoGoalNode,
    /// The corridor is empty, usually because the sketch is nowhere near the graph.
    EmptyCorridor,
    /// Start and goal are both routable but nothing connects them inside the corridor.
    NoRoute,
}

impl fmt::Display for MatchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let msg = match self {
            Self::SketchTooShort => "sketch needs at least two points",
            Self::NoStartNode => "no routable path near the start of the line",
            Self::NoGoalNode => "no routable path near the end of the line",
            Self::EmptyCorridor => "no routable paths anywhere near the line",
            Self::NoRoute => "no connected route inside the corridor",
        };
        f.write_str(msg)
    }
}

impl std::error::Error for MatchError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct State {
    node: NodeId,
    /// Checkpoints collected so far, so `cp == total` means all are done.
    cp: u32,
}

struct Entry {
    f: f64,
    g: f64,
    state: State,
}

impl PartialEq for Entry {
    fn eq(&self, other: &Self) -> bool {
        self.f == other.f
    }
}
impl Eq for Entry {}
impl Ord for Entry {
    fn cmp(&self, other: &Self) -> Ordering {
        // Reversed, because BinaryHeap is a max-heap and this is a min search.
        other.f.partial_cmp(&self.f).unwrap_or(Ordering::Equal)
    }
}
impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Collect every checkpoint now within reach of `at`, starting from `from`.
fn advance(cps: &[LatLng], at: LatLng, from: u32, radius_m: f64) -> u32 {
    let mut i = from as usize;
    while i < cps.len() && at.haversine_m(cps[i]) <= radius_m {
        i += 1;
    }
    i as u32
}

/// Find the route that follows `sketch` most closely.
pub fn match_sketch(graph: &Graph, req: &MatchRequest) -> Result<MatchResult, MatchError> {
    let sketch = &req.sketch;
    if sketch.is_degenerate() {
        return Err(MatchError::SketchTooShort);
    }

    let params = req.params;

    // Snap the ends to the network before anything else.
    //
    // A finger does not land on a path. Refusing to route because a stroke
    // began in a field is not useful, so the ends move to the nearest node and
    // the distance travelled is reported back rather than hidden.
    let (start_node, start_snap_m) = graph
        .nearest_node(sketch.first().unwrap(), params.max_snap_m)
        .ok_or(MatchError::NoStartNode)?;
    let (goal_node, goal_snap_m) = graph
        .nearest_node(sketch.last().unwrap(), params.max_snap_m)
        .ok_or(MatchError::NoGoalNode)?;
    let goal_pos = graph.node(goal_node);

    // The line the search actually works against, extended to meet the network
    // at both ends. The corridor and the checkpoints are built from this, so
    // the leg between the drawing and the nearest path is inside the corridor
    // instead of being pruned away as an excursion.
    //
    // Scoring still happens against what the user drew, not against this, which
    // is what keeps a long snap visible in the metrics rather than explained
    // away by them.
    let routing_line = extend_to_network(
        sketch,
        graph.node(start_node),
        goal_pos,
        start_snap_m,
        goal_snap_m,
    );

    let corridor = Corridor::build(
        graph,
        &routing_line,
        params.corridor_width_m,
        params.prune_factor,
    );
    if corridor.edges_inside() == 0 {
        return Err(MatchError::EmptyCorridor);
    }

    let cps = checkpoints(&routing_line, params.checkpoint_spacing_m);
    let total = cps.len();

    // Straight-line distance to the goal.
    //
    // Admissible because every edge costs at least its own length, so no route
    // can finish for less than the remaining geodesic distance. A tighter
    // heuristic could chain through the remaining checkpoints, but that stops
    // being a lower bound as soon as skipping a checkpoint is allowed, so it is
    // deliberately not used here. The corridor prune is what bounds the search.
    let heuristic = |node: NodeId| graph.node(node).haversine_m(goal_pos);

    let start_state = State {
        node: start_node,
        cp: advance(&cps, graph.node(start_node), 0, params.checkpoint_radius_m),
    };

    let mut best_g: HashMap<State, f64> = HashMap::new();
    let mut came: HashMap<State, (State, Option<EdgeId>)> = HashMap::new();
    let mut open = BinaryHeap::new();

    best_g.insert(start_state, 0.0);
    open.push(Entry {
        f: heuristic(start_node),
        g: 0.0,
        state: start_state,
    });

    while let Some(Entry { g, state, .. }) = open.pop() {
        if g > *best_g.get(&state).unwrap_or(&f64::INFINITY) {
            continue; // stale heap entry
        }

        if state.node == goal_node && state.cp as usize >= total {
            return Ok(reconstruct(
                graph,
                &came,
                start_state,
                state,
                g,
                total,
                (start_snap_m, goal_snap_m),
            ));
        }

        // Give up on the next checkpoint and carry on.
        if (state.cp as usize) < total {
            let next = State {
                node: state.node,
                cp: state.cp + 1,
            };
            let tentative = g + params.checkpoint_skip_penalty_m;
            if tentative < *best_g.get(&next).unwrap_or(&f64::INFINITY) {
                best_g.insert(next, tentative);
                came.insert(next, (state, None));
                open.push(Entry {
                    f: tentative + heuristic(next.node),
                    g: tentative,
                    state: next,
                });
            }
        }

        for &eid in graph.outgoing(state.node) {
            let Some(deviation) = corridor.deviation_m(eid) else {
                continue; // pruned out of the corridor
            };
            let edge = graph.edge(eid);
            let Some(step) = edge_cost(edge, deviation, &params, &req.profile) else {
                continue; // not traversable under this profile
            };

            let next = State {
                node: edge.to,
                cp: advance(
                    &cps,
                    graph.node(edge.to),
                    state.cp,
                    params.checkpoint_radius_m,
                ),
            };
            let tentative = g + step;
            if tentative < *best_g.get(&next).unwrap_or(&f64::INFINITY) {
                best_g.insert(next, tentative);
                came.insert(next, (state, Some(eid)));
                open.push(Entry {
                    f: tentative + heuristic(next.node),
                    g: tentative,
                    state: next,
                });
            }
        }
    }

    Err(MatchError::NoRoute)
}

fn reconstruct(
    graph: &Graph,
    came: &HashMap<State, (State, Option<EdgeId>)>,
    start: State,
    goal: State,
    cost: f64,
    total: usize,
    snap: (f64, f64),
) -> MatchResult {
    let mut edges = Vec::new();
    let mut skipped = 0usize;
    let mut cursor = goal;

    while cursor != start {
        let Some(&(prev, via)) = came.get(&cursor) else {
            break;
        };
        match via {
            Some(eid) => edges.push(eid),
            None => skipped += 1,
        }
        cursor = prev;
    }
    edges.reverse();

    let mut geometry = Polyline::default();
    for &eid in &edges {
        geometry.append(&Polyline::new(graph.edge(eid).geometry.clone()));
    }

    let length_m = edges.iter().map(|&e| graph.edge(e).length_m).sum();

    MatchResult {
        edges,
        geometry,
        length_m,
        cost,
        checkpoints_skipped: skipped,
        checkpoints_total: total,
        start_snap_m: snap.0,
        goal_snap_m: snap.1,
    }
}

/// The drawn line with its ends pulled onto the network.
///
/// A snap shorter than a metre is left alone: the point is already on a node in
/// every sense that matters, and prepending a duplicate would only add a
/// zero-length segment for the corridor to measure against.
fn extend_to_network(
    sketch: &Polyline,
    start: LatLng,
    goal: LatLng,
    start_snap_m: f64,
    goal_snap_m: f64,
) -> Polyline {
    const NEGLIGIBLE_M: f64 = 1.0;
    if start_snap_m <= NEGLIGIBLE_M && goal_snap_m <= NEGLIGIBLE_M {
        return sketch.clone();
    }

    let mut points = Vec::with_capacity(sketch.len() + 2);
    if start_snap_m > NEGLIGIBLE_M {
        points.push(start);
    }
    points.extend_from_slice(&sketch.points);
    if goal_snap_m > NEGLIGIBLE_M {
        points.push(goal);
    }
    Polyline::new(points)
}
