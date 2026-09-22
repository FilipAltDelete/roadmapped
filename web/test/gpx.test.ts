// GPX export, which is how a route leaves this app for OsmAnd or a watch.

import { describe, expect, it } from 'vitest';
import { gpxFilename, toGpx } from '../src/gpx';

const route = [
  { lat: 59.3293, lng: 18.0686 },
  { lat: 59.3303, lng: 18.0696 },
];

describe('toGpx', () => {
  it('writes lat and lon in the order GPX expects', () => {
    const gpx = toGpx(route, { name: 'Test', createdAt: new Date('2026-09-22T10:00:00Z') });
    expect(gpx).toContain('<trkpt lat="59.329300" lon="18.068600" />');
  });

  it('declares GPX 1.1 with the namespace readers require', () => {
    const gpx = toGpx(route, { name: 'Test' });
    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx).toContain('version="1.1"');
  });

  it('parses as well-formed XML', () => {
    const doc = new DOMParser().parseFromString(toGpx(route, { name: 'Test' }), 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelectorAll('trkpt')).toHaveLength(2);
  });

  it('escapes a name that would otherwise break the file', () => {
    // Route names come from the user and end up inside XML text.
    const gpx = toGpx(route, { name: 'Ben & Jerry <hike>' });
    expect(gpx).toContain('Ben &amp; Jerry &lt;hike&gt;');
    expect(new DOMParser().parseFromString(gpx, 'application/xml').querySelector('parsererror'))
      .toBeNull();
  });
});

describe('gpxFilename', () => {
  it('slugs a name into something every filesystem accepts', () => {
    expect(gpxFilename('Roadmapped 2026-09-22')).toBe('roadmapped-2026-09-22.gpx');
    expect(gpxFilename('Skogen / Norr — långtur!')).toBe('skogen-norr-l-ngtur.gpx');
  });

  it('falls back rather than producing a dotfile', () => {
    expect(gpxFilename('!!!')).toBe('route.gpx');
    expect(gpxFilename('')).toBe('route.gpx');
  });
});
