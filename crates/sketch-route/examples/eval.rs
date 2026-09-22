//! The evaluation harness.
//!
//! Run it before and after any change to the cost function or the search:
//!
//! ```text
//! cargo run --example eval
//! cargo run --example eval -- --geojson > /tmp/routes.geojson
//! ```
//!
//! Today it scores a synthetic grid, because there is no OSM importer yet. The
//! table it prints is the contract. When the importer lands in Phase 2, swap the
//! graph and the sketches for real ones and the harness keeps working unchanged.

use sketch_route::{
    evaluate, geojson, match_sketch, Graph, LatLng, MatchRequest, Metrics, Polyline, Profile,
    Surface, WayKind,
};

const BASE: LatLng = LatLng::new(59.3293, 18.0686);
const SPACING_M: f64 = 100.0;
const SIDE: u32 = 14;

fn at(east: f64, north: f64) -> LatLng {
    LatLng::from_local(BASE, east, north)
}

fn line(points: &[(f64, f64)]) -> Polyline {
    Polyline::new(points.iter().map(|(e, n)| at(*e, *n)).collect())
}

fn grid() -> Graph {
    let mut b = Graph::builder();
    for row in 0..SIDE {
        for col in 0..SIDE {
            b.add_node(at(col as f64 * SPACING_M, row as f64 * SPACING_M));
        }
    }
    let id = |row: u32, col: u32| row * SIDE + col;

    for row in 0..SIDE {
        for col in 0..SIDE {
            // Every third street is a bigger road, so profiles have something
            // to express a preference about.
            let kind = if row % 3 == 0 {
                WayKind::Secondary
            } else {
                WayKind::Residential
            };
            if col + 1 < SIDE {
                b.add_way(
                    id(row, col),
                    id(row, col + 1),
                    vec![],
                    kind,
                    Surface::Paved,
                    true,
                );
            }
            if row + 1 < SIDE {
                b.add_way(
                    id(row, col),
                    id(row + 1, col),
                    vec![],
                    WayKind::Residential,
                    Surface::Paved,
                    true,
                );
            }
        }
    }
    b.build()
}

/// Stand-in for the canonical sketch set described in the roadmap.
///
/// These are the shapes that break naive matchers. Replace with real drawn
/// sketches over a real extract as soon as the importer exists.
fn canonical_sketches() -> Vec<(&'static str, Polyline)> {
    vec![
        ("straight", line(&[(0.0, 0.0), (1300.0, 0.0)])),
        ("diagonal", line(&[(0.0, 0.0), (1300.0, 1300.0)])),
        (
            "u-bend",
            line(&[(0.0, 1300.0), (0.0, 0.0), (1300.0, 0.0), (1300.0, 1300.0)]),
        ),
        (
            "zigzag",
            line(&[
                (0.0, 0.0),
                (300.0, 600.0),
                (600.0, 0.0),
                (900.0, 600.0),
                (1200.0, 0.0),
            ]),
        ),
        (
            "out-and-back",
            line(&[(0.0, 400.0), (1200.0, 400.0), (1200.0, 800.0), (0.0, 800.0)]),
        ),
        (
            "arc",
            line(&[
                (0.0, 0.0),
                (200.0, 500.0),
                (650.0, 800.0),
                (1100.0, 500.0),
                (1300.0, 0.0),
            ]),
        ),
    ]
}

fn main() {
    let emit_geojson = std::env::args().any(|a| a == "--geojson");
    let graph = grid();
    let profile = Profile::walk();

    if !emit_geojson {
        println!(
            "graph: {} nodes, {} edges\n",
            graph.node_count(),
            graph.edge_count()
        );
        println!("{:<14} result", "sketch");
        println!("{}", "-".repeat(110));
    }

    let mut features: Vec<(String, Polyline)> = Vec::new();
    let mut scored: Vec<Metrics> = Vec::new();
    let mut failures = 0;

    for (name, sketch) in canonical_sketches() {
        let request = MatchRequest::new(sketch.clone(), profile);
        match match_sketch(&graph, &request) {
            Ok(route) => {
                let m = evaluate(
                    &sketch,
                    &route.geometry,
                    request.params.corridor_width_m,
                    20.0,
                );
                if !emit_geojson {
                    let skipped = if route.checkpoints_skipped > 0 {
                        format!(
                            "  GAPS {}/{}",
                            route.checkpoints_skipped, route.checkpoints_total
                        )
                    } else {
                        String::new()
                    };
                    println!("{:<14} {}{}", name, m.summary(), skipped);
                }
                features.push((format!("{name} sketch"), sketch));
                features.push((format!("{name} route"), route.geometry));
                scored.push(m);
            }
            Err(err) => {
                failures += 1;
                if !emit_geojson {
                    println!("{name:<14} FAILED: {err}");
                }
            }
        }
    }

    if emit_geojson {
        let refs: Vec<(&str, &Polyline)> = features.iter().map(|(n, l)| (n.as_str(), l)).collect();
        println!("{}", geojson::feature_collection(&refs));
        return;
    }

    if scored.is_empty() {
        println!("\nnothing scored");
        return;
    }

    let n = scored.len() as f64;
    let mean_dev = scored.iter().map(|m| m.mean_route_to_sketch_m).sum::<f64>() / n;
    let worst_dev = scored
        .iter()
        .map(|m| m.max_route_to_sketch_m)
        .fold(0.0f64, f64::max);
    let mean_ratio = scored.iter().map(|m| m.length_ratio).sum::<f64>() / n;
    let share = scored.iter().map(|m| m.corridor_share).sum::<f64>() / n;

    println!("{}", "-".repeat(110));
    println!(
        "overall        mean deviation {mean_dev:.1} m   worst {worst_dev:.1} m   \
         mean length ratio {mean_ratio:.2}   inside corridor {:.0}%   failures {failures}",
        share * 100.0
    );
    println!("\nCompare these four numbers before and after any change to cost or search.");
}
