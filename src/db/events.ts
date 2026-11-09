/**
 * A deliberately tiny event bus.
 *
 * SQLite is the source of truth and Zustand stores are mirrors of it. When a
 * repository writes, it emits here; screens subscribe and re-read. That is the whole
 * cache-invalidation story, and it is why the app does not need a query library.
 */

export type DbEvent =
  | 'phrases:changed'
  | 'reviews:changed'
  | 'session:changed'
  | 'gamification:changed'
  | 'dictionary:changed'
  | 'book:changed'
  | 'media:changed'
  | 'challenges:changed'
  | 'settings:changed'
  | 'ai:changed';

type Listener = () => void;

const listeners = new Map<DbEvent, Set<Listener>>();

export function on(event: DbEvent, listener: Listener): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}

/** Subscribe to several events with one unsubscribe. */
export function onAny(events: readonly DbEvent[], listener: Listener): () => void {
  const offs = events.map((event) => on(event, listener));
  return () => offs.forEach((off) => off());
}

export function emit(...events: readonly DbEvent[]): void {
  for (const event of events) {
    const set = listeners.get(event);
    if (!set) continue;
    // Copy first: a listener may unsubscribe itself while we iterate.
    for (const listener of [...set]) {
      try {
        listener();
      } catch (error) {
        console.warn(`[db] listener for "${event}" threw`, error);
      }
    }
  }
}
