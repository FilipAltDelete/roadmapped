//! The WebAssembly seam over [`sketch_route`].
//!
//! This crate exists so the browser can call the matcher. It holds every unsafe
//! line and every layout decision in the project, so that `sketch-route` itself
//! stays a plain Rust library that knows nothing about where it runs. The same
//! separation that would let a Swift client reuse the engine through UniFFI is
//! what lets a browser reuse it through this.
//!
//! # The ABI
//!
//! Everything crossing the boundary is an `f64`, passed through buffers the
//! caller allocates with [`alloc_f64`]. There is no bindgen and no generated
//! glue: a boundary this narrow is cheaper to write by hand than to depend on a
//! version-locked code generator for. `web/src/wasm.ts` is the other half and
//! the two must be read together.
//!
//! `f64` buffers rather than byte buffers is not a style choice. JavaScript can
//! only build a `Float64Array` over WebAssembly memory at an eight-byte aligned
//! offset, and allocating as `Vec<f64>` is what guarantees that.
//!
//! # Lifetimes across the boundary
//!
//! A [`Graph`] is expensive to build and is reused across many matches, so it
//! stays in Rust and the caller holds an opaque handle. Everything else is
//! copied in and out. Handles are indices into a thread-local registry, which is
//! sound here because a WebAssembly instance is single-threaded; each Web Worker
//! gets its own instance and therefore its own registry.

use std::cell::RefCell;

use sketch_route::{
    evaluate, match_sketch, Graph, LatLng, MatchError, MatchRequest, Polyline, Profile,
    ProfileKind, Surface, WayKind,
};

// ---------------------------------------------------------------------------
// Result buffer layout
// ---------------------------------------------------------------------------

/// Slots before the geometry begins. Keep in step with `RESULT` in `wasm.ts`.
const RESULT_HEADER_F64: usize = 16;

const SLOT_TOTAL_F64: usize = 0;
const SLOT_STATUS: usize = 1;
const SLOT_LENGTH_M: usize = 2;
const SLOT_COST: usize = 3;
const SLOT_CHECKPOINTS_SKIPPED: usize = 4;
const SLOT_CHECKPOINTS_TOTAL: usize = 5;
const SLOT_MEAN_DEV_M: usize = 6;
const SLOT_MAX_DEV_M: usize = 7;
const SLOT_MEAN_MISS_M: usize = 8;
const SLOT_MAX_MISS_M: usize = 9;
const SLOT_FRECHET_M: usize = 10;
const SLOT_CORRIDOR_SHARE: usize = 11;
const SLOT_LENGTH_RATIO: usize = 12;
const SLOT_POINT_COUNT: usize = 13;
const SLOT_START_SNAP_M: usize = 14;
const SLOT_GOAL_SNAP_M: usize = 15;

/// Status codes. Zero is success; the rest mirror [`MatchError`].
const STATUS_OK: f64 = 0.0;
const STATUS_SKETCH_TOO_SHORT: f64 = 1.0;
const STATUS_NO_START_NODE: f64 = 2.0;
const STATUS_NO_GOAL_NODE: f64 = 3.0;
const STATUS_EMPTY_CORRIDOR: f64 = 4.0;
const STATUS_NO_ROUTE: f64 = 5.0;
const STATUS_BAD_HANDLE: f64 = 6.0;

fn status_of(err: &MatchError) -> f64 {
    match err {
        MatchError::SketchTooShort => STATUS_SKETCH_TOO_SHORT,
        MatchError::NoStartNode => STATUS_NO_START_NODE,
        MatchError::NoGoalNode => STATUS_NO_GOAL_NODE,
        MatchError::EmptyCorridor => STATUS_EMPTY_CORRIDOR,
        MatchError::NoRoute => STATUS_NO_ROUTE,
    }
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/// Allocate `count` f64 slots and hand ownership to the caller.
///
/// The caller must return the pointer to [`dealloc_f64`], passing the same
/// count, or the memory leaks for the life of the instance.
#[no_mangle]
pub extern "C" fn alloc_f64(count: usize) -> *mut f64 {
    let mut buf = Vec::<f64>::with_capacity(count);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Release a buffer from [`alloc_f64`].
///
/// # Safety
///
/// `ptr` must have come from [`alloc_f64`] with the same `count`, and must not
/// have been freed already.
#[no_mangle]
pub unsafe extern "C" fn dealloc_f64(ptr: *mut f64, count: usize) {
    if ptr.is_null() {
        return;
    }
    drop(Vec::from_raw_parts(ptr, 0, count));
}

/// Release a result buffer from [`match_sketch_ffi`].
///
/// The length is recovered from slot zero, so the caller does not have to track
/// it. A null pointer is ignored, which makes the JavaScript `finally` block
/// that calls this unconditional.
///
/// # Safety
///
/// `ptr` must be a result buffer this module returned and not yet freed.
#[no_mangle]
pub unsafe extern "C" fn result_free(ptr: *mut f64) {
    if ptr.is_null() {
        return;
    }
    let total = *ptr as usize;
    drop(Vec::from_raw_parts(ptr, 0, total));
}

fn into_raw(buf: Vec<f64>) -> *mut f64 {
    let mut buf = buf;
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// A result carrying nothing but a status code.
fn failure(status: f64) -> *mut f64 {
    let mut out = vec![0.0f64; RESULT_HEADER_F64];
    out[SLOT_TOTAL_F64] = RESULT_HEADER_F64 as f64;
    out[SLOT_STATUS] = status;
    into_raw(out)
}

// ---------------------------------------------------------------------------
// Graph registry
// ---------------------------------------------------------------------------

thread_local! {
    /// Slots are never compacted, so a handle stays valid until it is freed and
    /// a freed handle is never silently reused by a different graph.
    static GRAPHS: RefCell<Vec<Option<Graph>>> = const { RefCell::new(Vec::new()) };
}

fn store(graph: Graph) -> u32 {
    GRAPHS.with(|g| {
        let mut g = g.borrow_mut();
        g.push(Some(graph));
        (g.len() - 1) as u32
    })
}

/// Run `f` against the graph behind `handle`, or return `None` if it is stale.
fn with_graph<T>(handle: u32, f: impl FnOnce(&Graph) -> T) -> Option<T> {
    GRAPHS.with(|g| {
        let g = g.borrow();
        g.get(handle as usize).and_then(|s| s.as_ref()).map(f)
    })
}

// ---------------------------------------------------------------------------
// Graph lifecycle
// ---------------------------------------------------------------------------

/// Build the synthetic street grid and return a handle to it.
///
/// This is the same grid `examples/eval.rs` scores against, centred wherever the
/// caller asks instead of at a fixed origin, so a sketch drawn anywhere on the
/// map has something to match against.
///
/// It is scaffolding, and it is the honest state of the project: there is no
/// OSM importer yet, so there is no real path network to route on. When the
/// importer lands, a `graph_from_packed` entry point joins this one and the rest
/// of the ABI does not change.
#[no_mangle]
pub extern "C" fn graph_demo_grid(lat: f64, lng: f64, spacing_m: f64, side: u32) -> u32 {
    let side = side.clamp(2, 200);
    let spacing_m = if spacing_m > 0.0 { spacing_m } else { 100.0 };

    // Centre the grid on the requested point rather than starting there, so the
    // caller's viewport centre lands in the middle of the network.
    let origin = LatLng::new(lat, lng);
    let half = (side - 1) as f64 * spacing_m * 0.5;
    let at = |east: f64, north: f64| LatLng::from_local(origin, east - half, north - half);

    let mut b = Graph::builder();
    for row in 0..side {
        for col in 0..side {
            b.add_node(at(col as f64 * spacing_m, row as f64 * spacing_m));
        }
    }
    let id = |row: u32, col: u32| row * side + col;

    for row in 0..side {
        for col in 0..side {
            // Every third street is bigger, so profiles have something to
            // express a preference about.
            let kind = if row % 3 == 0 {
                WayKind::Secondary
            } else {
                WayKind::Residential
            };
            if col + 1 < side {
                b.add_way(
                    id(row, col),
                    id(row, col + 1),
                    vec![],
                    kind,
                    Surface::Paved,
                    true,
                );
            }
            if row + 1 < side {
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

    store(b.build())
}

/// Drop a graph. The handle is invalid afterwards.
#[no_mangle]
pub extern "C" fn graph_free(handle: u32) {
    GRAPHS.with(|g| {
        if let Some(slot) = g.borrow_mut().get_mut(handle as usize) {
            *slot = None;
        }
    });
}

#[no_mangle]
pub extern "C" fn graph_node_count(handle: u32) -> u32 {
    with_graph(handle, |g| g.node_count() as u32).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn graph_edge_count(handle: u32) -> u32 {
    with_graph(handle, |g| g.edge_count() as u32).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

fn profile_from(code: u32) -> Profile {
    Profile::new(match code {
        1 => ProfileKind::Hike,
        2 => ProfileKind::Run,
        3 => ProfileKind::Gravel,
        4 => ProfileKind::Road,
        _ => ProfileKind::Walk,
    })
}

/// Match a drawn sketch against a graph.
///
/// `sketch_ptr` points at `point_count` pairs of `[lat, lng]`. The return value
/// is a freshly allocated result buffer the caller owns and must release with
/// [`result_free`]; its layout is the `SLOT_*` constants above.
///
/// The sketch is simplified here rather than in the client. The tolerance is in
/// metres, which only makes sense once the stroke is in geographic coordinates,
/// and doing it on this side means the TypeScript client and any future native
/// one get identical thinning.
///
/// # Safety
///
/// `sketch_ptr` must point at `point_count * 2` readable f64 values.
#[no_mangle]
pub unsafe extern "C" fn match_sketch_ffi(
    handle: u32,
    sketch_ptr: *const f64,
    point_count: usize,
    profile_code: u32,
    strictness: f64,
    corridor_width_m: f64,
    simplify_tolerance_m: f64,
) -> *mut f64 {
    if sketch_ptr.is_null() || point_count < 2 {
        return failure(STATUS_SKETCH_TOO_SHORT);
    }

    let raw = std::slice::from_raw_parts(sketch_ptr, point_count * 2);
    let drawn = Polyline::new(
        raw.chunks_exact(2)
            .map(|p| LatLng::new(p[0], p[1]))
            .collect(),
    );
    let sketch = if simplify_tolerance_m > 0.0 {
        drawn.simplify(simplify_tolerance_m)
    } else {
        drawn
    };

    let mut request = MatchRequest::new(sketch.clone(), profile_from(profile_code));
    request.params.strictness = strictness.max(0.0);
    if corridor_width_m > 0.0 {
        request.params.corridor_width_m = corridor_width_m;
    }

    let outcome = with_graph(handle, |graph| match_sketch(graph, &request));
    let Some(outcome) = outcome else {
        return failure(STATUS_BAD_HANDLE);
    };
    let route = match outcome {
        Ok(route) => route,
        Err(err) => return failure(status_of(&err)),
    };

    let metrics = evaluate(
        &sketch,
        &route.geometry,
        request.params.corridor_width_m,
        20.0,
    );

    let points = &route.geometry.points;
    let total = RESULT_HEADER_F64 + points.len() * 2;
    let mut out = vec![0.0f64; total];

    out[SLOT_TOTAL_F64] = total as f64;
    out[SLOT_STATUS] = STATUS_OK;
    out[SLOT_LENGTH_M] = route.length_m;
    out[SLOT_COST] = route.cost;
    out[SLOT_CHECKPOINTS_SKIPPED] = route.checkpoints_skipped as f64;
    out[SLOT_CHECKPOINTS_TOTAL] = route.checkpoints_total as f64;
    out[SLOT_MEAN_DEV_M] = metrics.mean_route_to_sketch_m;
    out[SLOT_MAX_DEV_M] = metrics.max_route_to_sketch_m;
    out[SLOT_MEAN_MISS_M] = metrics.mean_sketch_to_route_m;
    out[SLOT_MAX_MISS_M] = metrics.max_sketch_to_route_m;
    out[SLOT_FRECHET_M] = metrics.frechet_m;
    out[SLOT_CORRIDOR_SHARE] = metrics.corridor_share;
    out[SLOT_LENGTH_RATIO] = metrics.length_ratio;
    out[SLOT_POINT_COUNT] = points.len() as f64;
    out[SLOT_START_SNAP_M] = route.start_snap_m;
    out[SLOT_GOAL_SNAP_M] = route.goal_snap_m;

    for (i, p) in points.iter().enumerate() {
        out[RESULT_HEADER_F64 + i * 2] = p.lat;
        out[RESULT_HEADER_F64 + i * 2 + 1] = p.lng;
    }

    into_raw(out)
}
