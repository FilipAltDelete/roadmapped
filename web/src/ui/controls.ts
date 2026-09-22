/**
 * The bottom panel.
 *
 * Deliberately free of the map and of the matcher, so it can be tested in a
 * plain DOM with no WebGL context and no WebAssembly. That separation is
 * inherited from the Flutter client, where the same panel was the only part of
 * the interface a widget test could reach, and it is worth keeping for the same
 * reason.
 */

import type { ProfileName } from '../wasm';

export interface RouteSummary {
  lengthM: number;
  meanDeviationM: number;
  corridorShare: number;
  checkpointsSkipped: number;
  /** The larger of the two distances the ends were moved to reach the network. */
  snapM: number;
}

export interface PanelState {
  drawing: boolean;
  strictness: number;
  profile: ProfileName;
  pointCount: number;
  busy: boolean;
  route: RouteSummary | null;
  error: string | null;
}

export interface PanelCallbacks {
  onStrictnessChange(value: number): void;
  onProfileChange(value: ProfileName): void;
  onExport(): void;
}

export const PROFILE_LABELS: ReadonlyArray<readonly [ProfileName, string]> = [
  ['walk', 'Walk'],
  ['hike', 'Hike'],
  ['run', 'Run'],
  ['gravel', 'Gravel'],
  ['road', 'Road'],
];

/**
 * What the slider means at each end, in the user's terms rather than the cost
 * function's. A bare number means nothing to someone drawing a walk.
 */
export function strictnessWord(strictness: number): string {
  if (strictness <= 2) return 'Loose';
  if (strictness <= 5) return 'Balanced';
  if (strictness <= 9) return 'Close';
  return 'Exact';
}

/** Below this, the ends landed near enough that moving them is not news. */
export const SNAP_WORTH_MENTIONING_M = 25;

export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

/**
 * The line under the slider.
 *
 * When a route exists this reports how well it followed the line, because that
 * is the only quality this app claims. Length comes first because it is what a
 * user asks for, deviation second because it is what the app promises.
 */
export function statusLine(state: PanelState): string {
  if (state.error) return state.error;
  if (state.busy) return 'Following the line...';
  if (state.route) {
    const { lengthM, meanDeviationM, corridorShare, checkpointsSkipped, snapM } = state.route;
    const parts = [
      formatDistance(lengthM),
      `${Math.round(meanDeviationM)} m off the line`,
      `${Math.round(corridorShare * 100)}% on it`,
    ];
    if (checkpointsSkipped > 0) {
      parts.push(`${checkpointsSkipped} gap${checkpointsSkipped === 1 ? '' : 's'}`);
    }
    // A short snap is the ordinary business of a finger not landing on a path
    // and is not worth saying. A long one changed where the route begins, and
    // saying so is the difference between a compromise and a surprise.
    if (snapM >= SNAP_WORTH_MENTIONING_M) {
      parts.push(`${Math.round(snapM)} m to reach a path`);
    }
    return parts.join(' · ');
  }
  if (state.pointCount > 0) return `${state.pointCount} points.`;
  return 'No route drawn.';
}

export class ControlPanel {
  readonly element: HTMLElement;
  #hint: HTMLElement;
  #word: HTMLElement;
  #slider: HTMLInputElement;
  #status: HTMLElement;
  #export: HTMLButtonElement;
  #profiles: HTMLElement;
  #state: PanelState;

  constructor(initial: PanelState, callbacks: PanelCallbacks) {
    this.#state = initial;

    this.element = document.createElement('div');
    this.element.className = 'panel glass';

    this.#hint = document.createElement('p');
    this.#hint.className = 'panel-hint';

    this.#profiles = document.createElement('div');
    this.#profiles.className = 'profiles';
    this.#profiles.setAttribute('role', 'radiogroup');
    this.#profiles.setAttribute('aria-label', 'Route profile');
    for (const [value, label] of PROFILE_LABELS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'profile';
      button.dataset.profile = value;
      button.textContent = label;
      button.setAttribute('role', 'radio');
      button.addEventListener('click', () => callbacks.onProfileChange(value));
      this.#profiles.append(button);
    }

    const labelRow = document.createElement('div');
    labelRow.className = 'label-row';
    const caption = document.createElement('span');
    caption.className = 'caption';
    caption.textContent = 'Follow the line';
    this.#word = document.createElement('span');
    this.#word.className = 'caption accent';
    labelRow.append(caption, this.#word);

    this.#slider = document.createElement('input');
    this.#slider.type = 'range';
    this.#slider.min = '0';
    this.#slider.max = '12';
    this.#slider.step = '1';
    this.#slider.className = 'slider';
    this.#slider.setAttribute('aria-label', 'Follow the line');
    this.#slider.addEventListener('input', () =>
      callbacks.onStrictnessChange(Number(this.#slider.value)),
    );

    const footer = document.createElement('div');
    footer.className = 'footer-row';
    this.#status = document.createElement('p');
    this.#status.className = 'status';
    this.#export = document.createElement('button');
    this.#export.type = 'button';
    this.#export.className = 'export';
    this.#export.textContent = 'GPX';
    this.#export.title = 'Export this route as GPX';
    this.#export.addEventListener('click', () => callbacks.onExport());
    footer.append(this.#status, this.#export);

    this.element.append(this.#hint, this.#profiles, labelRow, this.#slider, footer);
    this.update(initial);
  }

  update(state: PanelState): void {
    this.#state = state;

    this.#hint.textContent = state.drawing
      ? 'Drawing. Drag to sketch a route.'
      : 'Drag to move the map.';
    this.#hint.classList.toggle('drawing', state.drawing);

    this.#word.textContent = strictnessWord(state.strictness).toUpperCase();
    this.#slider.value = String(state.strictness);

    for (const button of this.#profiles.querySelectorAll<HTMLButtonElement>('.profile')) {
      const active = button.dataset.profile === state.profile;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    }

    this.#status.textContent = statusLine(state);
    this.#status.classList.toggle('error', state.error !== null);
    this.#export.disabled = state.route === null;
  }

  get state(): PanelState {
    return this.#state;
  }
}
