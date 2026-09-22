/**
 * Saying what went wrong, on the map itself.
 *
 * A map that fails to render is black, and black looks identical to a dark
 * basemap over open water. Without this, every rendering failure reaches the
 * user as "it's all black" and reaches the developer as a guess. MapLibre
 * reports its failures through an `error` event that is easy to leave
 * unhandled, and leaving it unhandled is what turns a one-line diagnosis into
 * an afternoon.
 */

export interface BannerContent {
  title: string;
  detail: string;
}

/** Whether this browser can give MapLibre the context it needs. */
export function hasWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl'),
    );
  } catch {
    // Some hardened configurations throw rather than returning null.
    return false;
  }
}

/**
 * Show a problem, replacing any previous one.
 *
 * Deliberately not dismissible: unlike the install hint, this is not advice.
 */
export function showBanner(root: HTMLElement, content: BannerContent): void {
  root.querySelector('.banner')?.remove();

  const banner = document.createElement('div');
  banner.className = 'banner glass';

  const title = document.createElement('p');
  title.className = 'banner-title';
  title.textContent = content.title;

  const detail = document.createElement('p');
  detail.className = 'banner-detail';
  detail.textContent = content.detail;

  banner.append(title, detail);
  root.append(banner);
}

export function clearBanner(root: HTMLElement): void {
  root.querySelector('.banner')?.remove();
}
