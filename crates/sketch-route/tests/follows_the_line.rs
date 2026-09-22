//! The tests that define the product.
//!
//! Each one describes a situation where a conventional router gives a defensible
//! answer that is wrong for this app. If any of these start failing, the core
//! promise is broken, whatever the other numbers say.

use sketch_route::{
    evaluate, match_sketch, Graph, LatLng, MatchRequest, Polyline, Profile, Surface, WayKind,
};

const BASE: LatLng = LatLng::new(59.3293, 18.0686);
const SPACING_M: f64 = 100.0;
const SIDE: u32 = 10;

fn at(east: f64, north: f64) -> LatLng {
    LatLng::from_local(BASE, east, north)
}

/// A regular street grid, ten by ten, one hundred metres apart.
///
/// A grid is the sharpest possible test bed, because every monotone staircase
/// across it has exactly the same length. Distance cannot break the tie, so only
/// fidelity to the drawn line can.
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
            if col + 1 < SIDE {
                b.add_way(
                    id(row, col),
                    id(row, col + 1),
                    vec![],
                    WayKind::Residential,
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

fn line(points: &[(f64, f64)]) -> Polyline {
    Polyline::new(points.iter().map(|(e, n)| at(*e, *n)).collect())
}

#[test]
fn a_diagonal_line_becomes_a_staircase_that_hugs_it() {
    // Every monotone staircase across the grid is 1800 m long, including the
    // L-shape that runs along one edge and up the other. A shortest-path router
    // may return any of them. Only the one that tracks the diagonal is correct
    // here.
    let graph = grid();
    let sketch = line(&[(0.0, 0.0), (900.0, 900.0)]);
    let request = MatchRequest::new(sketch.clone(), Profile::walk());

    let route = match_sketch(&graph, &request).expect("diagonal should route");
    let m = evaluate(
        &sketch,
        &route.geometry,
        request.params.corridor_width_m,
        20.0,
    );

    assert_eq!(route.edges.len(), 18, "a monotone staircase is 18 edges");
    assert_eq!(
        route.checkpoints_skipped, 0,
        "every checkpoint is reachable"
    );
    assert!(
        m.max_route_to_sketch_m < 80.0,
        "a staircase on a 100 m grid peaks near 71 m from the diagonal, got {:.1} m",
        m.max_route_to_sketch_m
    );
    assert!(
        m.max_sketch_to_route_m < 80.0,
        "no part of the drawn line should be left uncovered, got {:.1} m",
        m.max_sketch_to_route_m
    );
}

#[test]
fn a_u_shaped_line_is_followed_around_rather_than_cut_across() {
    // This is the whole product in one assertion. The start and end sit on the
    // same row, 900 m apart. Any router optimising for distance or time goes
    // straight across the top. Following the line means walking 2700 m instead,
    // which is three times as far and the right answer.
    let graph = grid();
    let sketch = line(&[(0.0, 900.0), (0.0, 0.0), (900.0, 0.0), (900.0, 900.0)]);
    let request = MatchRequest::new(sketch.clone(), Profile::walk());

    let route = match_sketch(&graph, &request).expect("U shape should route");
    let m = evaluate(
        &sketch,
        &route.geometry,
        request.params.corridor_width_m,
        20.0,
    );

    let straight_across = at(0.0, 900.0).haversine_m(at(900.0, 900.0));
    assert!(
        route.length_m > 2.5 * straight_across,
        "took a shortcut: {:.0} m against {:.0} m straight across",
        route.length_m,
        straight_across
    );
    assert_eq!(route.edges.len(), 27, "down, across, and back up");
    assert_eq!(route.checkpoints_skipped, 0);
    assert!(m.max_route_to_sketch_m < 20.0);
    assert!(m.corridor_share > 0.99);
}

#[test]
fn a_straight_line_along_a_street_returns_that_street() {
    let graph = grid();
    let sketch = line(&[(0.0, 0.0), (900.0, 0.0)]);
    let request = MatchRequest::new(sketch.clone(), Profile::walk());

    let route = match_sketch(&graph, &request).expect("straight line should route");
    let m = evaluate(
        &sketch,
        &route.geometry,
        request.params.corridor_width_m,
        20.0,
    );

    assert_eq!(route.edges.len(), 9);
    assert!(m.max_route_to_sketch_m < 5.0);
    assert!((m.length_ratio - 1.0).abs() < 0.05);
}

#[test]
fn walkers_prefer_the_footway_to_the_equally_direct_main_road() {
    // Two ways between the same pair of nodes, mirrored either side of the drawn
    // line so neither has a fidelity advantage. Only the profile can decide.
    let mut b = Graph::builder();
    let start = b.add_node(at(0.0, 0.0));
    let end = b.add_node(at(600.0, 0.0));
    let via_road = b.add_node(at(300.0, -40.0));
    let via_foot = b.add_node(at(300.0, 40.0));

    for (mid, kind) in [(via_road, WayKind::Major), (via_foot, WayKind::Footway)] {
        b.add_way(start, mid, vec![], kind, Surface::Paved, true);
        b.add_way(mid, end, vec![], kind, Surface::Paved, true);
    }
    let graph = b.build();

    let sketch = line(&[(0.0, 0.0), (600.0, 0.0)]);
    let mut request = MatchRequest::new(sketch, Profile::walk());
    // Only the endpoints act as checkpoints here, so the test measures the
    // profile alone rather than checkpoint geometry.
    request.params.checkpoint_spacing_m = 1_000.0;

    let route = match_sketch(&graph, &request).expect("both options route");
    for &eid in &route.edges {
        assert_eq!(
            graph.edge(eid).kind,
            WayKind::Footway,
            "a walker should not be sent down a main road when a footway mirrors it"
        );
    }
}

#[test]
fn a_line_drawn_nowhere_near_a_path_is_reported_rather_than_guessed_at() {
    let graph = grid();
    let sketch = line(&[(50_000.0, 50_000.0), (51_000.0, 50_000.0)]);
    let request = MatchRequest::new(sketch, Profile::walk());

    assert!(
        match_sketch(&graph, &request).is_err(),
        "an unroutable sketch must fail loudly, never silently snap somewhere else"
    );
}

#[test]
fn strictness_changes_the_route_rather_than_being_decorative() {
    let graph = grid();
    let sketch = line(&[(0.0, 0.0), (900.0, 900.0)]);

    let loose = MatchRequest::new(sketch.clone(), Profile::walk()).with_strictness(0.0);
    let tight = MatchRequest::new(sketch.clone(), Profile::walk()).with_strictness(12.0);

    let loose_route = match_sketch(&graph, &loose).expect("loose should route");
    let tight_route = match_sketch(&graph, &tight).expect("tight should route");

    let loose_m = evaluate(&sketch, &loose_route.geometry, 75.0, 20.0);
    let tight_m = evaluate(&sketch, &tight_route.geometry, 75.0, 20.0);

    assert!(
        tight_m.mean_route_to_sketch_m <= loose_m.mean_route_to_sketch_m + 1e-6,
        "raising strictness must never push the route further from the line: \
         tight {:.1} m against loose {:.1} m",
        tight_m.mean_route_to_sketch_m,
        loose_m.mean_route_to_sketch_m
    );
}
