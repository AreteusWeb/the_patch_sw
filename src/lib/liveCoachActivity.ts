/**
 * Tiny cross-tree signal for "Voice & Video Live session is active".
 * Used so PWA update prompts can wait until Live ends (non-blocking defer).
 */

let active = false;
const listeners = new Set<() => void>();

export function setLiveCoachSessionActive(next: boolean): void {
  if (active === next) return;
  active = next;
  for (const listener of listeners) listener();
}

export function isLiveCoachSessionActive(): boolean {
  return active;
}

export function subscribeLiveCoachSessionActive(
  listener: () => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
