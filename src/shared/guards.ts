export type GuardExpression = { atom: string } | { not: GuardExpression } | { and: GuardExpression[] } | { or: GuardExpression[] } | { value: boolean };
export interface GuardTransition {
  file: string; target: string; condition: string;
  change: { atom: string; value: boolean };
  before: Record<string, boolean>;
}
export function evaluateGuard(expression: GuardExpression, values: Record<string, boolean>): boolean {
  if ('atom' in expression) return values[expression.atom] === true;
  if ('value' in expression) return expression.value;
  if ('not' in expression) return !evaluateGuard(expression.not, values);
  if ('and' in expression) return expression.and.every(item => evaluateGuard(item, values));
  return expression.or.some(item => evaluateGuard(item, values));
}
