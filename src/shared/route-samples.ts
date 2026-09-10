/** Concrete destinations observed while the app renders, never invented records. */
export type RouteDestination = { href: string; file: string };
export const maxRouteDestinations = 256;
export type RouteParams = Record<string, string | string[]>;

export function observedHref(value: unknown): string | null {
  let href: string;
  if (typeof value === 'string') href = value;
  else if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { pathname, params } = value as { pathname?: unknown; params?: unknown };
    if (typeof pathname !== 'string') return null;
    const values: RouteParams = Object.create(null);
    if (params && typeof params === 'object' && !Array.isArray(params)) {
      for (const [key, item] of Object.entries(params)) {
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') values[key] = String(item);
        else if (Array.isArray(item) && item.every(value => typeof value === 'string' || typeof value === 'number')) values[key] = item.map(String);
      }
    }
    const consumed = new Set<string>();
    href = pathname.replace(/\[(\.\.\.)?([^\]]+)\]/g, (match, catchAll, key) => {
      const value = values[key];
      if (value === undefined) return match;
      consumed.add(key);
      const parts = Array.isArray(value) ? value : [value];
      return catchAll ? parts.map(encodeURIComponent).join('/') : encodeURIComponent(parts[0]);
    });
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (!consumed.has(key))
      for (const part of Array.isArray(value) ? value : [value]) query.append(key, part);
    if (query.size) href += (href.includes('?') ? '&' : '?') + query.toString();
  } else return null;
  // Only concrete local routes, not external links or unresolved placeholders.
  if (!href.startsWith('/') || href.startsWith('//') || href.length > 2000 || /[\[\]\\\u0000-\u001f]/.test(href)) return null;
  return href;
}

/** Match every path segment and decode each parameter exactly once. */
export function paramsForRoute(pattern: string, href: string): RouteParams | null {
  if (!observedHref(href)) return null;
  const [rawPath, rawQuery = ''] = href.split('#')[0].split('?');
  const groups = (value: string) => value.split('/').filter(part => /^\(.*\)$/.test(part));
  if (!groups(rawPath).every(group => groups(pattern).includes(group))) return null;
  const segments = (value: string) => value.split('/').filter(part => part && !/^\(.*\)$/.test(part));
  const expected = segments(pattern), actual = segments(rawPath);
  const params: RouteParams = Object.create(null);
  let index = 0;
  try {
    for (const segment of expected) {
      const dynamic = /^\[(\.\.\.)?([^\]]+)\]$/.exec(segment);
      if (dynamic) {
        if (index >= actual.length) return null;
        if (dynamic[1]) { params[dynamic[2]] = actual.slice(index).map(decodeURIComponent); index = actual.length; }
        else params[dynamic[2]] = decodeURIComponent(actual[index++]);
      } else if (actual[index++] !== segment) return null;
    }
    if (index !== actual.length) return null;
    for (const [key] of new URLSearchParams(rawQuery)) if (!(key in params)) {
      const values = new URLSearchParams(rawQuery).getAll(key);
      params[key] = values.length === 1 ? values[0] : values;
    }
  } catch { return null; }
  return { ...params };
}

export const routeParamNames = (pattern: string) => [...pattern.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)].map(match => match[1]);

/** Shared contexts resolve to the same source-backed canvas frame. */
export function paramsForScreenRoute(route: unknown, href: string): RouteParams | null {
  if (!route || typeof route !== 'object' || Array.isArray(route)) return null;
  const value = route as { fullPath?: unknown; contexts?: unknown };
  const patterns = [value.fullPath, ...(Array.isArray(value.contexts) ? value.contexts.map(context => context?.fullPath) : [])];
  for (const pattern of patterns) if (typeof pattern === 'string') {
    const params = paramsForRoute(pattern, href);
    if (params) return params;
  }
  return null;
}
