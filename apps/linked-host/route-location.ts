export function routeLocation(pattern: string, params: Record<string, string | string[]> = {}) {
  const consumed = new Set<string>();
  const path = pattern.replace(/\[(\.\.\.)?([^\]]+)\]/g, (placeholder, catchAll, key) => {
    const value = params[key];
    if (value === undefined) return placeholder;
    consumed.add(key);
    const values = Array.isArray(value) ? value : [value];
    return catchAll ? values.map(encodeURIComponent).join('/') : encodeURIComponent(values[0]);
  });
  const location = new URL(path, 'expo-canvas-linked://preview');
  for (const [key, value] of Object.entries(params)) if (!consumed.has(key))
    for (const item of Array.isArray(value) ? value : [value]) location.searchParams.append(key, item);
  return location;
}
