//! Geodesic primitives.
//!
//! Distances use a spherical earth. That is accurate to roughly half a percent,
//! which is far inside the tolerance of corridor work measured in tens of metres.
//!
//! For anything local, points are projected onto a tangent plane centred on a
//! nearby origin. Over a few kilometres the distortion is negligible and it lets
//! the geometry run in plain 2D.

/// IUGG mean earth radius.
pub const EARTH_RADIUS_M: f64 = 6_371_008.8;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LatLng {
    pub lat: f64,
    pub lng: f64,
}

impl LatLng {
    pub const fn new(lat: f64, lng: f64) -> Self {
        Self { lat, lng }
    }

    /// Great-circle distance in metres.
    pub fn haversine_m(self, other: LatLng) -> f64 {
        let lat1 = self.lat.to_radians();
        let lat2 = other.lat.to_radians();
        let dlat = lat2 - lat1;
        let dlng = (other.lng - self.lng).to_radians();
        let a = (dlat * 0.5).sin().powi(2) + lat1.cos() * lat2.cos() * (dlng * 0.5).sin().powi(2);
        2.0 * EARTH_RADIUS_M * a.sqrt().clamp(0.0, 1.0).asin()
    }

    /// Project onto a tangent plane centred on `origin`, as (east, north) metres.
    pub fn to_local(self, origin: LatLng) -> (f64, f64) {
        let scale = origin.lat.to_radians().cos();
        let east = (self.lng - origin.lng).to_radians() * EARTH_RADIUS_M * scale;
        let north = (self.lat - origin.lat).to_radians() * EARTH_RADIUS_M;
        (east, north)
    }

    /// Inverse of [`LatLng::to_local`].
    pub fn from_local(origin: LatLng, east: f64, north: f64) -> LatLng {
        let scale = origin.lat.to_radians().cos().max(1e-12);
        LatLng {
            lat: origin.lat + (north / EARTH_RADIUS_M).to_degrees(),
            lng: origin.lng + (east / (EARTH_RADIUS_M * scale)).to_degrees(),
        }
    }
}

/// Closest point on segment `a`-`b` to `p`.
///
/// Returns the position along the segment as a fraction in `0..=1`, and the
/// distance in metres.
pub fn project_on_segment(p: LatLng, a: LatLng, b: LatLng) -> (f64, f64) {
    let (px, py) = p.to_local(a);
    let (bx, by) = b.to_local(a);
    let len2 = bx * bx + by * by;
    if len2 <= 1e-12 {
        return (0.0, p.haversine_m(a));
    }
    let t = ((px * bx + py * by) / len2).clamp(0.0, 1.0);
    let (cx, cy) = (bx * t, by * t);
    let d = ((px - cx).powi(2) + (py - cy).powi(2)).sqrt();
    (t, d)
}

/// Perpendicular distance from `p` to segment `a`-`b`, in metres.
pub fn point_segment_distance_m(p: LatLng, a: LatLng, b: LatLng) -> f64 {
    project_on_segment(p, a, b).1
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: LatLng = LatLng::new(59.3293, 18.0686);

    #[test]
    fn haversine_matches_local_projection_at_short_range() {
        let p = LatLng::from_local(BASE, 300.0, 400.0);
        let d = BASE.haversine_m(p);
        assert!((d - 500.0).abs() < 1.0, "expected about 500 m, got {d}");
    }

    #[test]
    fn local_round_trip_is_stable() {
        let p = LatLng::from_local(BASE, 1234.0, -567.0);
        let (e, n) = p.to_local(BASE);
        assert!((e - 1234.0).abs() < 0.5);
        assert!((n + 567.0).abs() < 0.5);
    }

    #[test]
    fn distance_to_segment_clamps_to_endpoints() {
        let a = LatLng::from_local(BASE, 0.0, 0.0);
        let b = LatLng::from_local(BASE, 100.0, 0.0);
        let beyond = LatLng::from_local(BASE, 200.0, 0.0);
        assert!((point_segment_distance_m(beyond, a, b) - 100.0).abs() < 1.0);

        let above = LatLng::from_local(BASE, 50.0, 30.0);
        assert!((point_segment_distance_m(above, a, b) - 30.0).abs() < 1.0);
    }
}
