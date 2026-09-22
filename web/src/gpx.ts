/**
 * GPX export.
 *
 * On the native plan this was insurance: when the seven-day signature expired
 * at a trailhead, the exported file was the only way the route survived. A web
 * app does not expire, so the insurance argument is gone and the other reason
 * remains, which was always the stronger one. This is the bridge into OsmAnd,
 * Organic Maps, Komoot and Gaia, and into a watch. A route that cannot leave
 * the app is a route that only works where the app works.
 *
 * GPX 1.1, written by hand. The format is a handful of elements and a dependency
 * here would buy nothing.
 */

import type { LatLng } from './wasm';

/** XML text escaping. Route names come from the user and reach a file. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface GpxOptions {
  name: string;
  /** Written into the file so a route can be told apart from a later redraw. */
  createdAt?: Date;
}

/**
 * A GPX track from a matched route.
 *
 * Six decimal places is about ten centimetres, which is far finer than anything
 * a finger and a path network can express, and keeps the file small enough to
 * pass through a share sheet without complaint.
 */
export function toGpx(points: readonly LatLng[], options: GpxOptions): string {
  const name = escapeXml(options.name);
  const time = (options.createdAt ?? new Date()).toISOString();
  const trkpts = points
    .map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}" />`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Roadmapped" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
    <time>${time}</time>
  </metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** A filename safe on every platform the file might land on. */
export function gpxFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'route'}.gpx`;
}

/**
 * Hand the file to the operating system.
 *
 * On iOS the share sheet is what puts the route into OsmAnd, so it is tried
 * first and a download is the fallback. `canShare` has to be asked about the
 * actual file: Safari advertises `share` but refuses file payloads in some
 * configurations, and finding that out by having the call reject would lose the
 * export.
 */
export async function shareGpx(gpx: string, name: string): Promise<'shared' | 'downloaded'> {
  const filename = gpxFilename(name);
  const file = new File([gpx], filename, { type: 'application/gpx+xml' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (error) {
      // A user who dismisses the sheet has not asked for a download instead.
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      // Anything else means sharing is unavailable in practice; fall through.
    }
  }

  const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    // Revoking immediately can cancel the download on some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return 'downloaded';
}
