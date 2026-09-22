/**
 * The nudge to install to the home screen.
 *
 * More than a nicety on iOS. In a Safari tab the app loses three things it
 * depends on: the edge-swipe back gesture eats strokes that start near the left
 * edge, the address bar resizes the viewport under a finger that is mid-line,
 * and the origin gets a smaller storage allowance that is likelier to be
 * evicted. Standalone mode fixes all three, and the only way into it on iOS is
 * the user tapping Share and then Add to Home Screen, because Safari has no
 * install prompt to call.
 *
 * So this exists to say so, once, and then get out of the way.
 */

const DISMISSED_KEY = 'roadmapped.install-hint.dismissed';

/** Already installed, or launched from the home screen. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // Safari's own non-standard flag, which is the only one it sets on iOS.
    ('standalone' in navigator && navigator.standalone === true)
  );
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, and is told apart by having a touchscreen.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    // Private browsing can throw on access. Showing the hint again is a far
    // smaller problem than failing to start.
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    /* nothing to do; the hint reappears next launch */
  }
}

export function shouldShowInstallHint(): boolean {
  return isIos() && !isStandalone() && !wasDismissed();
}

/** The hint element, or null when there is nothing worth saying. */
export function createInstallHint(): HTMLElement | null {
  if (!shouldShowInstallHint()) return null;

  const hint = document.createElement('div');
  hint.className = 'install-hint glass';

  const text = document.createElement('p');
  text.innerHTML =
    'Add to Home Screen for full-screen drawing. <span>Share &rarr; Add to Home Screen</span>';

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => {
    remember();
    hint.remove();
  });

  hint.append(text, dismiss);
  return hint;
}
