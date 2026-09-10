// This module is isolated with the frame. The original app never imports it.
export interface PagerStep {
  index: number; count: number; key: string; routeKey: string;
  pager: { file: string; setter: string; fields: string[]; refs: string[]; shared: string[] };
}
let step: PagerStep | undefined;
let navigate: ((index: number) => void) | undefined;
export function setPagerPreview(value: PagerStep | undefined, callback: (index: number) => void) { step = value; navigate = callback; }
export function pagerInitial<T>(initial: T, file: string, binding: string): T {
  if (step?.pager.file !== file) return initial;
  const index = step.index;
  if (step.pager.setter === binding) return Object.fromEntries(step.pager.fields.map((key: string) => [key, index])) as T;
  if (step.pager.refs.includes(binding) || step.pager.shared.includes(binding)) return step.index as T;
  return initial;
}
export function navigatePager(index: number, file: string): boolean {
  if (step?.pager.file !== file) return false;
  if (Number.isInteger(index) && index >= 0 && index < step.count && index !== step.index) navigate?.(index);
  // A pinned step never advances its local page, including invalid/repeated clicks.
  return true;
}
