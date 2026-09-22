// The bottom panel, tested in isolation.
//
// The map screen itself needs a WebGL context and cannot run here, which is
// exactly why the panel is a separate module that knows nothing about maps.
// Ported from the Flutter client's `widget_test.dart`.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlPanel, statusLine, strictnessWord, type PanelState } from '../src/ui/controls';

function state(overrides: Partial<PanelState> = {}): PanelState {
  return {
    drawing: false,
    strictness: 4,
    profile: 'walk',
    pointCount: 0,
    busy: false,
    route: null,
    error: null,
    ...overrides,
  };
}

function mount(overrides: Partial<PanelState> = {}) {
  const callbacks = {
    onStrictnessChange: vi.fn(),
    onProfileChange: vi.fn(),
    onExport: vi.fn(),
  };
  const panel = new ControlPanel(state(overrides), callbacks);
  document.body.append(panel.element);
  return { panel, callbacks };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the hint', () => {
  it('explains that dragging moves the map when not drawing', () => {
    const { panel } = mount();
    expect(panel.element.querySelector('.panel-hint')!.textContent).toBe(
      'Drag to move the map.',
    );
  });

  it('explains that dragging sketches while drawing', () => {
    const { panel } = mount({ drawing: true });
    expect(panel.element.querySelector('.panel-hint')!.textContent).toBe(
      'Drawing. Drag to sketch a route.',
    );
  });
});

describe('strictness', () => {
  it('is named rather than shown as a number', () => {
    // A bare number means nothing to someone drawing a walk.
    expect(strictnessWord(0)).toBe('Loose');
    expect(strictnessWord(4)).toBe('Balanced');
    expect(strictnessWord(8)).toBe('Close');
    expect(strictnessWord(12)).toBe('Exact');
  });

  it('spans shortest-path to hugging the line', () => {
    const { panel } = mount();
    const slider = panel.element.querySelector<HTMLInputElement>('.slider')!;
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('12');
  });

  it('reports changes', () => {
    const { panel, callbacks } = mount();
    const slider = panel.element.querySelector<HTMLInputElement>('.slider')!;
    slider.value = '9';
    slider.dispatchEvent(new Event('input'));
    expect(callbacks.onStrictnessChange).toHaveBeenCalledWith(9);
  });
});

describe('the status line', () => {
  it('says nothing is drawn when nothing is', () => {
    expect(statusLine(state())).toBe('No route drawn.');
  });

  it('reports the captured point count mid-sketch', () => {
    expect(statusLine(state({ pointCount: 142 }))).toBe('142 points.');
  });

  it('reports how well the route followed the line', () => {
    const line = statusLine(
      state({
        route: { lengthM: 2900, meanDeviationM: 25, corridorShare: 0.99, checkpointsSkipped: 0, snapM: 0 },
      }),
    );
    expect(line).toBe('2.9 km · 25 m off the line · 99% on it');
  });

  it('surfaces gaps rather than hiding them', () => {
    const line = statusLine(
      state({
        route: { lengthM: 800, meanDeviationM: 40, corridorShare: 0.8, checkpointsSkipped: 2, snapM: 0 },
      }),
    );
    expect(line).toContain('2 gaps');
  });

  it('stays quiet about a snap short enough to be ordinary', () => {
    // A finger never lands exactly on a path. Reporting every few metres of it
    // would be noise, not honesty.
    const line = statusLine(
      state({
        route: { lengthM: 1000, meanDeviationM: 10, corridorShare: 1, checkpointsSkipped: 0, snapM: 12 },
      }),
    );
    expect(line).not.toContain('to reach a path');
  });

  it('says so when an end was moved far enough to matter', () => {
    const line = statusLine(
      state({
        route: { lengthM: 1000, meanDeviationM: 10, corridorShare: 1, checkpointsSkipped: 0, snapM: 340 },
      }),
    );
    expect(line).toContain('340 m to reach a path');
  });

  it('prefers an error over everything else', () => {
    expect(statusLine(state({ error: 'No paths near that line.', busy: true }))).toBe(
      'No paths near that line.',
    );
  });
});

describe('export', () => {
  it('is disabled until there is a route to export', () => {
    const { panel } = mount();
    expect(panel.element.querySelector<HTMLButtonElement>('.export')!.disabled).toBe(true);
  });

  it('is enabled once a route exists', () => {
    const { panel } = mount({
      route: { lengthM: 1000, meanDeviationM: 10, corridorShare: 1, checkpointsSkipped: 0, snapM: 0 },
    });
    expect(panel.element.querySelector<HTMLButtonElement>('.export')!.disabled).toBe(false);
  });
});

describe('profiles', () => {
  it('marks the active one and reports a change', () => {
    const { panel, callbacks } = mount({ profile: 'hike' });
    const buttons = panel.element.querySelectorAll<HTMLButtonElement>('.profile');
    const active = [...buttons].filter((b) => b.classList.contains('active'));
    expect(active).toHaveLength(1);
    expect(active[0].dataset.profile).toBe('hike');

    panel.element.querySelector<HTMLButtonElement>('[data-profile="gravel"]')!.click();
    expect(callbacks.onProfileChange).toHaveBeenCalledWith('gravel');
  });
});
