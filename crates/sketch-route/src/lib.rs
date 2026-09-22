//! Routing that follows a hand-drawn line.
//!
//! This crate exists to answer one question: given a line someone drew on a map
//! with their finger, what is the real route on the path network that looks most
//! like that line?
//!
//! It is explicitly *not* a shortest-path or fastest-path router. Where a normal
//! routing engine treats distance or time as the thing to minimise and the shape
//! of the result as a consequence, here the shape is the requirement and length
//! is a consequence. Any change that trades fidelity for speed is a regression,
//! however good the numbers look.
//!
//! # How a sketch becomes a route
//!
//! 1. [`polyline::Polyline::simplify`] thins the raw touch points.
//! 2. [`corridor::Corridor::build`] measures every edge against the sketch and
//!    throws away the ones far outside a band around it.
//! 3. [`corridor::checkpoints`] places ordered waypoints along the sketch.
//! 4. [`matcher::match_sketch`] runs A* over the surviving edges, where the
//!    search state carries checkpoint progress so the route cannot shortcut or
//!    double back.
//! 5. [`metrics::evaluate`] scores the result, which is how any change to the
//!    above is judged.
//!
//! # Example
//!
//! ```no_run
//! use sketch_route::{Graph, MatchRequest, Polyline, Profile, match_sketch};
//!
//! # fn demo(graph: &Graph, drawn: Polyline) {
//! let request = MatchRequest::new(drawn.simplify(8.0), Profile::walk())
//!     .with_strictness(4.0);
//!
//! match match_sketch(graph, &request) {
//!     Ok(route) => println!("{:.0} m, {} edges", route.length_m, route.edges.len()),
//!     Err(err) => eprintln!("could not follow the line: {err}"),
//! }
//! # }
//! ```

pub mod corridor;
pub mod cost;
pub mod geo;
pub mod geojson;
pub mod graph;
pub mod matcher;
pub mod metrics;
pub mod polyline;

pub use corridor::{checkpoints, Corridor};
pub use cost::{edge_cost, CostParams, Profile, ProfileKind};
pub use geo::LatLng;
pub use graph::{Edge, EdgeId, Graph, GraphBuilder, NodeId, Surface, WayKind};
pub use matcher::{match_sketch, MatchError, MatchRequest, MatchResult};
pub use metrics::{evaluate, Metrics};
pub use polyline::Polyline;
