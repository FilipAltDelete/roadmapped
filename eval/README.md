# Evaluation set

The referee for the whole project. A change to the cost function or the search is
an improvement only if these numbers say so.

```sh
make eval      # the table
make geojson   # the same routes, viewable at geojson.io
```

## Today

`crates/sketch-route/examples/eval.rs` scores six synthetic shapes over a
generated street grid. A grid is a deliberately hard test bed, because every
staircase across it has identical length. Distance cannot break the tie, so only
fidelity to the drawn line can.

The shapes exist to break naive matchers:

| Sketch | What it catches |
| --- | --- |
| straight | Baseline. Anything other than a perfect score is a bug. |
| diagonal | Staircase quality. A shortest-path router picks an L instead. |
| u-bend | Shortcutting. The endpoints are close, the line is not. |
| zigzag | Corner cutting at sharp reversals. |
| out-and-back | Whether the route survives near-overlapping outbound and return legs. |
| arc | Smooth curvature against a square grid. |

## What replaces it

Ten real sketches drawn by hand over a real extract, listed in Phase 0 of the
roadmap: urban grid, river loop, forest trail, a line crossing a lake,
self-crossing loop, out-and-back, long straight road, dense city centre, coastal
path, hilly park.

Store each as GeoJSON in `eval/sketches/` once the importer exists. The harness
keeps its shape, only the graph and the sketches change.

## Reading the table

| Column | Meaning |
| --- | --- |
| `len` and ratio | Route length, and how it compares to the drawn line. Near 1.00 is good. |
| `dev` | How far the route strays from the line. |
| `miss` | How much of the line the route failed to cover. |
| `frechet` | Worst ordered deviation, sensitive to direction of travel. |
| `inside` | Share of the route within the corridor. |

Both `dev` and `miss` matter. A route covering only half the sketch scores a
perfect `dev` and a terrible `miss`, which is the trap of measuring one
direction only.
