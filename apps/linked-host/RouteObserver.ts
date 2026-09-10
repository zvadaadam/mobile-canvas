import { maxRouteDestinations, observedHref, type RouteDestination } from './route-samples';

// One module instance per isolated frame runtime. Observing a render never invokes
// a press handler; notifications run after React finishes the current render.
const found = new Map<string, RouteDestination>();
const listeners = new Set<() => void>();
let snapshot: RouteDestination[] = [];
let scheduled = false;
export const getRouteDestinations = () => snapshot;
export function subscribeRouteDestinations(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function observeHref<T>(value: T, file: string): T {
  const href = observedHref(value);
  if (href && !found.has(href) && found.size < maxRouteDestinations) {
    found.set(href, { href, file });
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        snapshot = [...found.values()];
        for (const listener of listeners) listener();
      }, 0);
    }
  }
  return value;
}
export function observePress<T>(handler: T, destination: () => unknown, file: string): T {
  try { observeHref(destination(), file); } catch { /* A destination may require state that doesn't exist until interaction. */ }
  return handler;
}

const outputs = new Map<string, 'empty' | 'output'>();
const outputListeners = new Set<() => void>();
let outputSnapshot: Record<string, 'empty' | 'output'> = {};
let outputScheduled = false;
export const getRouteOutputs = () => outputSnapshot;
export function subscribeRouteOutputs(listener: () => void) {
  outputListeners.add(listener);
  return () => { outputListeners.delete(listener); };
}
export function observeRouteOutput<T>(value: T, file: string): T {
  const status = value == null || typeof value === 'boolean' ? 'empty' : 'output';
  if (outputs.get(file) !== status) {
    outputs.set(file, status);
    if (!outputScheduled) {
      outputScheduled = true;
      setTimeout(() => {
        outputScheduled = false; outputSnapshot = Object.fromEntries(outputs);
        for (const listener of outputListeners) listener();
      }, 0);
    }
  }
  return value;
}
