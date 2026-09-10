type Transition = { file: string; target: string; change: { atom: string; value: boolean }; before: Record<string, boolean> };
let transitions: Transition[] = [];
let report: ((value: unknown) => void) | undefined;
let navigate: ((key: string) => void) | undefined;
const previousSignals = new Map<string, Record<string, unknown[]>>();
const previous = new Map<string, Record<string, boolean>>();
export function setGuardPreview(value: Transition[] = [], callback: (key: string) => void, onObserve?: (value: unknown) => void) { transitions = value; navigate = callback; report = onObserve; }
export function resetGuardPreview() { previous.clear(); previousSignals.clear(); }
export function observeGuardValues(file: string, values: Record<string, boolean>, signals: Record<string, unknown[]> = {}) {
  const before = previous.get(file);
  const oldSignals = previousSignals.get(file);
  previousSignals.set(file, signals);
  previous.set(file, values);
  if (JSON.stringify(before) !== JSON.stringify(values) || JSON.stringify(oldSignals) !== JSON.stringify(signals)) setTimeout(() => report?.({ file, values, signals }), 0);
  if (!before) return; // Mounting an otherwise inaccessible frame is not navigation.
  const candidates = transitions.filter(edge => edge.file === file && edge.change.atom in before && (before[edge.change.atom] !== values[edge.change.atom] || oldSignals && JSON.stringify(oldSignals[edge.change.atom]) !== JSON.stringify(signals[edge.change.atom])) && values[edge.change.atom] === edge.change.value);
  // Frame eligibility supplies the assumptions needed to inspect a protected
  // page offline. Unchanged observed values distinguish other branches.
  const score = (edge: Transition) => Object.entries(edge.before).filter(([key, value]) => key !== edge.change.atom && key in before && before[key] !== value).length;
  candidates.sort((a, b) => score(a) - score(b));
  const best = candidates[0];
  if (!best || candidates.some(edge => score(edge) === score(best) && edge.target !== best.target)) return;
  setTimeout(() => navigate?.(best.target), 0);
}
