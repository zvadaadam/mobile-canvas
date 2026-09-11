import type { Screen } from '../../../shared/model';
import { maxRouteDestinations, observedHref, paramsForScreenRoute, routeParamNames } from '../../../shared/route-samples';

export type RouteExample = { href: string; from: string; file: string };
export function routeExamples(from: string, value: unknown): RouteExample[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxRouteDestinations).flatMap(item => {
    if (!item || typeof item.href !== 'string' || typeof item.file !== 'string' || item.file.length > 500) return [];
    const href = observedHref(item.href);
    return href ? [{ href, from, file: item.file }] : [];
  });
}

/** Stable ordering over the destinations actually rendered by the app. */
export function chooseRouteExample(screen: Screen, examples: RouteExample[]) {
  const { route, params, autoParams } = screen.props;
  if (autoParams === false || !route || typeof route !== 'object' || Array.isArray(route) || typeof route.fullPath !== 'string') return null;
  const supplied = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  const names = routeParamNames(route.fullPath);
  if (!names.some(name => supplied[name] === undefined)) return null;
  const sorted = [...examples].sort((a, b) => {
    const left = `${a.from}\n${a.href}\n${a.file}`, right = `${b.from}\n${b.href}\n${b.file}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  for (const example of sorted) {
    const found = paramsForScreenRoute(route, example.href);
    if (!found || names.some(name => supplied[name] !== undefined && JSON.stringify(supplied[name]) !== JSON.stringify(found[name]))) continue;
    return { ...screen.props, params: { ...found, ...supplied }, routeExample: example };
  }
  return null;
}
