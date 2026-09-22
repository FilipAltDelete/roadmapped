//! Minimal GeoJSON output, for eyeballing results on a map.
//!
//! Hand-rolled rather than pulled from a crate, because this library is
//! cross-compiled to WebAssembly and every dependency is a build risk. The
//! output is only ever consumed by debugging tools, so it stays small.

use crate::polyline::Polyline;

fn line_string(name: &str, line: &Polyline) -> String {
    let coords: Vec<String> = line
        .points
        .iter()
        .map(|p| format!("[{:.7},{:.7}]", p.lng, p.lat))
        .collect();
    format!(
        r#"{{"type":"Feature","properties":{{"name":"{}"}},"geometry":{{"type":"LineString","coordinates":[{}]}}}}"#,
        name.replace('"', "'"),
        coords.join(",")
    )
}

/// Wrap named lines into a FeatureCollection.
///
/// Paste the result into geojson.io to see the sketch and the route together.
pub fn feature_collection(lines: &[(&str, &Polyline)]) -> String {
    let features: Vec<String> = lines
        .iter()
        .filter(|(_, l)| !l.is_empty())
        .map(|(name, l)| line_string(name, l))
        .collect();
    format!(
        r#"{{"type":"FeatureCollection","features":[{}]}}"#,
        features.join(",")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geo::LatLng;

    #[test]
    fn writes_lng_lat_order() {
        let line = Polyline::new(vec![LatLng::new(59.3293, 18.0686)]);
        let out = feature_collection(&[("sketch", &line)]);
        assert!(out.contains("[18.0686000,59.3293000]"));
        assert!(out.contains(r#""name":"sketch""#));
    }
}
