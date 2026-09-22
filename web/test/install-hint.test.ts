// When the app asks to be installed, and when it stays quiet.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInstallHint, shouldShowInstallHint } from '../src/ui/install-hint';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

// jsdom implements neither `matchMedia` nor a writable `userAgent`, so these
// are defined outright rather than spied on. `vi.restoreAllMocks` does not undo
// a defineProperty, hence the explicit teardown below.
function pretend({ ua = IPHONE, standalone = false, touchPoints = 5 } = {}) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: touchPoints,
    configurable: true,
  });
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches: standalone, media: '(display-mode: standalone)' }),
    configurable: true,
  });
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
  Reflect.deleteProperty(navigator, 'userAgent');
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
});

describe('shouldShowInstallHint', () => {
  it('asks on iOS in a tab, where the edge-swipe gesture eats strokes', () => {
    pretend();
    expect(shouldShowInstallHint()).toBe(true);
  });

  it('stays quiet once the app is installed', () => {
    pretend({ standalone: true });
    expect(shouldShowInstallHint()).toBe(false);
  });

  it('stays quiet away from iOS, where there is nothing to fix', () => {
    pretend({ ua: DESKTOP, touchPoints: 0 });
    expect(shouldShowInstallHint()).toBe(false);
  });
});

describe('the hint', () => {
  it('names the two taps that actually install it', () => {
    pretend();
    const hint = createInstallHint()!;
    expect(hint.textContent).toContain('Add to Home Screen');
  });

  it('does not come back after it is dismissed', () => {
    pretend();
    const hint = createInstallHint()!;
    document.body.append(hint);
    hint.querySelector<HTMLButtonElement>('.dismiss')!.click();

    expect(document.querySelector('.install-hint')).toBeNull();
    expect(shouldShowInstallHint()).toBe(false);
    expect(createInstallHint()).toBeNull();
  });
});
