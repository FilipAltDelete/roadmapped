//! The routable path network.
//!
//! Edges are directed. A two-way path becomes two edges, which keeps the search
//! loop simple and lets one-way restrictions arrive later without a redesign.
//!
//! The spatial index is a flat grid rather than an R-tree. Path networks are
//! close to uniformly dense at city scale, so a grid gives comparable lookups
//! with a fraction of the code and no dependency.

use std::collections::HashMap;

use crate::geo::LatLng;
use crate::polyline::Polyline;

pub type NodeId = u32;
pub type EdgeId = u32;

/// Coarse classification of a way, taken from OpenStreetMap tags at import time.
///
/// Deliberately small. The profile table in [`crate::cost`] has to stay readable,
/// and finer distinctions belong in the importer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WayKind {
    Trail,
    Path,
    Footway,
    Track,
    Steps,
    Cycleway,
    Residential,
    Secondary,
    Major,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Surface {
    Paved,
    Gravel,
    Ground,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct Edge {
    pub from: NodeId,
    pub to: NodeId,
    /// Full shape including both endpoints. Curvature matters here, because
    /// deviation from the sketch is measured against the real geometry.
    pub geometry: Vec<LatLng>,
    pub length_m: f64,
    pub kind: WayKind,
    pub surface: Surface,
}

/// Uniform grid over latitude and longitude, mapping a cell to the ids inside it.
struct GridIndex {
    origin: LatLng,
    cell_lat_deg: f64,
    cell_lng_deg: f64,
    cell_m: f64,
    cells: HashMap<(i32, i32), Vec<u32>>,
}

impl GridIndex {
    fn new(origin: LatLng, cell_m: f64) -> Self {
        let cell_lat_deg = cell_m / 111_320.0;
        let scale = origin.lat.to_radians().cos().abs().max(0.01);
        Self {
            origin,
            cell_lat_deg,
            cell_lng_deg: cell_m / (111_320.0 * scale),
            cell_m,
            cells: HashMap::new(),
        }
    }

    fn key(&self, p: LatLng) -> (i32, i32) {
        (
            ((p.lat - self.origin.lat) / self.cell_lat_deg).floor() as i32,
            ((p.lng - self.origin.lng) / self.cell_lng_deg).floor() as i32,
        )
    }

    fn insert(&mut self, p: LatLng, id: u32) {
        self.cells.entry(self.key(p)).or_default().push(id);
    }

    /// Ids in every cell overlapping a square of `radius_m` around `p`.
    ///
    /// Conservative. Callers filter by true distance afterwards.
    fn near(&self, p: LatLng, radius_m: f64) -> Vec<u32> {
        let reach = (radius_m / self.cell_m).ceil() as i32 + 1;
        let (ci, cj) = self.key(p);
        let mut out = Vec::new();
        for i in (ci - reach)..=(ci + reach) {
            for j in (cj - reach)..=(cj + reach) {
                if let Some(ids) = self.cells.get(&(i, j)) {
                    out.extend_from_slice(ids);
                }
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }
}

pub struct Graph {
    nodes: Vec<LatLng>,
    edges: Vec<Edge>,
    outgoing: Vec<Vec<EdgeId>>,
    node_index: GridIndex,
    edge_index: GridIndex,
}

impl Graph {
    pub fn builder() -> GraphBuilder {
        GraphBuilder::default()
    }

    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    pub fn node(&self, id: NodeId) -> LatLng {
        self.nodes[id as usize]
    }

    pub fn edge(&self, id: EdgeId) -> &Edge {
        &self.edges[id as usize]
    }

    pub fn outgoing(&self, id: NodeId) -> &[EdgeId] {
        &self.outgoing[id as usize]
    }

    /// Edge ids whose geometry passes within roughly `radius_m` of `p`.
    pub fn edges_near(&self, p: LatLng, radius_m: f64) -> Vec<EdgeId> {
        self.edge_index.near(p, radius_m)
    }

    /// Nearest node to `p`, provided it lies within `radius_m`.
    pub fn nearest_node_within(&self, p: LatLng, radius_m: f64) -> Option<NodeId> {
        let mut best: Option<(NodeId, f64)> = None;
        for id in self.node_index.near(p, radius_m) {
            let d = p.haversine_m(self.nodes[id as usize]);
            if d <= radius_m && best.map(|(_, bd)| d < bd).unwrap_or(true) {
                best = Some((id, d));
            }
        }
        best.map(|(id, _)| id)
    }
}

#[derive(Default)]
pub struct GraphBuilder {
    nodes: Vec<LatLng>,
    edges: Vec<Edge>,
}

impl GraphBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_node(&mut self, p: LatLng) -> NodeId {
        self.nodes.push(p);
        (self.nodes.len() - 1) as NodeId
    }

    /// Add a way between two nodes.
    ///
    /// `geometry` may be empty, in which case a straight line between the two
    /// nodes is used. When `bidirectional`, a reversed twin edge is added too.
    pub fn add_way(
        &mut self,
        from: NodeId,
        to: NodeId,
        geometry: Vec<LatLng>,
        kind: WayKind,
        surface: Surface,
        bidirectional: bool,
    ) {
        let geom = if geometry.len() >= 2 {
            geometry
        } else {
            vec![self.nodes[from as usize], self.nodes[to as usize]]
        };
        let length_m = Polyline::new(geom.clone()).length_m();

        self.edges.push(Edge {
            from,
            to,
            geometry: geom.clone(),
            length_m,
            kind,
            surface,
        });

        if bidirectional {
            let mut rev = geom;
            rev.reverse();
            self.edges.push(Edge {
                from: to,
                to: from,
                geometry: rev,
                length_m,
                kind,
                surface,
            });
        }
    }

    pub fn build(self) -> Graph {
        let origin = self.nodes.first().copied().unwrap_or(LatLng::new(0.0, 0.0));
        const CELL_M: f64 = 400.0;

        let mut outgoing = vec![Vec::new(); self.nodes.len()];
        for (i, e) in self.edges.iter().enumerate() {
            outgoing[e.from as usize].push(i as EdgeId);
        }

        let mut node_index = GridIndex::new(origin, CELL_M);
        for (i, p) in self.nodes.iter().enumerate() {
            node_index.insert(*p, i as u32);
        }

        let mut edge_index = GridIndex::new(origin, CELL_M);
        for (i, e) in self.edges.iter().enumerate() {
            let mut seen = Vec::new();
            for p in &e.geometry {
                let key = edge_index.key(*p);
                if seen.contains(&key) {
                    continue;
                }
                seen.push(key);
                edge_index.cells.entry(key).or_default().push(i as u32);
            }
        }

        Graph {
            nodes: self.nodes,
            edges: self.edges,
            outgoing,
            node_index,
            edge_index,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: LatLng = LatLng::new(59.3293, 18.0686);

    #[test]
    fn bidirectional_way_produces_two_edges_and_both_adjacencies() {
        let mut b = Graph::builder();
        let a = b.add_node(LatLng::from_local(BASE, 0.0, 0.0));
        let c = b.add_node(LatLng::from_local(BASE, 100.0, 0.0));
        b.add_way(a, c, vec![], WayKind::Footway, Surface::Paved, true);
        let g = b.build();

        assert_eq!(g.edge_count(), 2);
        assert_eq!(g.outgoing(a).len(), 1);
        assert_eq!(g.outgoing(c).len(), 1);
        assert!((g.edge(0).length_m - 100.0).abs() < 1.0);
    }

    #[test]
    fn nearest_node_respects_the_radius() {
        let mut b = Graph::builder();
        b.add_node(LatLng::from_local(BASE, 0.0, 0.0));
        b.add_node(LatLng::from_local(BASE, 5000.0, 0.0));
        let g = b.build();

        let probe = LatLng::from_local(BASE, 40.0, 0.0);
        assert_eq!(g.nearest_node_within(probe, 100.0), Some(0));
        assert_eq!(g.nearest_node_within(probe, 10.0), None);
    }
}
