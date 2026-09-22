/**
 * Persistence, because a backgrounded tab is not guaranteed to come back.
 *
 * iOS reclaims memory from Safari aggressively. A web app left in the
 * background can be discarded outright, and what the user returns to is a fresh
 * page load rather than the state they left. On a phone in a pocket, mid-walk,
 * that is not an edge case.
 *
 * So nothing lives only in memory. The sketch, the route and the camera are
 * written on every change, and the app restores them on load. This is the web
 * equivalent of the SQLite store the roadmap always planned for, arriving
 * earlier than planned because the platform demands it rather than because the
 * feature list does.
 *
 * Every call degrades to a no-op rather than throwing. IndexedDB is unavailable
 * in some private-browsing configurations, and losing persistence must never
 * mean losing the app.
 */

import type { LatLng, ProfileName } from './wasm';

const DB_NAME = 'roadmapped';
const DB_VERSION = 1;
const STORE = 'session';
const CURRENT = 'current';

export interface Session {
  sketch: LatLng[];
  route: LatLng[];
  profile: ProfileName;
  strictness: number;
  camera: { centre: LatLng; zoom: number };
  savedAt: number;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function saveSession(session: Omit<Session, 'savedAt'>): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...session, savedAt: Date.now() }, CURRENT);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function loadSession(): Promise<Session | null> {
  const db = await open();
  if (!db) return null;
  try {
    return await new Promise<Session | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(CURRENT);
      request.onsuccess = () => resolve((request.result as Session | undefined) ?? null);
      request.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function clearSession(): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(CURRENT);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

/**
 * Ask the browser not to evict this origin.
 *
 * Granted silently on an installed web app more often than in a tab, which is
 * one of the reasons the app asks to be added to the home screen. A refusal is
 * not an error; it only means eviction stays possible, which the code above
 * already assumes.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
