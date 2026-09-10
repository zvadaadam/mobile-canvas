import { ExpoRoot, usePathname, useGlobalSearchParams } from 'expo-router';
import { context } from 'expo-canvas-route-context';
import { memo, useEffect, useMemo, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import UnavailablePreview from './UnavailablePreview';
import { usePreviewState, usePreviewNavigation } from '@expo-canvas/preview';
import { screens } from 'expo-canvas-screens';
import { routeLocation } from './route-location';
import { routeParamNames, paramsForScreenRoute } from './route-samples';
import { getRouteDestinations, subscribeRouteDestinations, getRouteOutputs, subscribeRouteOutputs } from './RouteObserver';
import { setFrameNavigation } from './FrameNavigation';
import hostConfig from './canvas-host.json';
import { setGuardPreview } from './GuardPreview';
import { setPagerPreview, type PagerStep } from './PagerPreview';

export default function LinkedApp({ route, params = {}, autoParams = true, routeExample }: {
  route: { fullPath: string; file?: string; step?: PagerStep; guardTransitions?: Parameters<typeof setGuardPreview>[0] }; params?: Record<string, string | string[]>; autoParams?: boolean;
  routeExample?: { href: string; from: string; file: string };
}) {
  const missing = routeParamNames(route.fullPath).filter(key => params[key] === undefined);
  const waiting = autoParams && missing.length > 0;
  const navigation = usePreviewNavigation();
  const [, setNavigationTarget] = usePreviewState('navigationTarget', null as null | { key: string; href: string; params: Record<string, string | string[]> });
  const [, setNavigationIssue] = usePreviewState('navigationIssue', null as string | null);
  const [, setGuardState] = usePreviewState('routeGuard', null as unknown);
  setGuardPreview(route.guardTransitions, key => { setNavigationTarget(null); navigation.navigate(key); }, setGuardState);
  setPagerPreview(route.step, index => {
    const target = screens.find(screen => (screen.props.route as any)?.step?.routeKey === route.step?.routeKey && (screen.props.route as any)?.step?.index === index);
    if (target) { setNavigationTarget(null); navigation.navigate(target.key); }
  });
  setFrameNavigation(href => {
    const target = screens.find(screen => paramsForScreenRoute(screen.props.route, href) !== null);
    if (!target) { setNavigationIssue(`No mapped frame for ${href}. This frame stays on its assigned route.`); return; }
    setNavigationIssue(null);
    setNavigationTarget({ key: target.key, href, params: paramsForScreenRoute(target.props.route, href)! });
    navigation.navigate(target.key);
  });
  const location = useMemo(() => routeLocation(route.fullPath, params), [route.fullPath, JSON.stringify(params)]);
  const destinations = useSyncExternalStore(subscribeRouteDestinations, getRouteDestinations, getRouteDestinations);
  const [, setDestinations] = usePreviewState('routeDestinations', destinations);
  useEffect(() => { setDestinations(destinations); }, [destinations]);
  const outputs = useSyncExternalStore(subscribeRouteOutputs, getRouteOutputs, getRouteOutputs);
  const output = route.file ? outputs[route.file] : undefined;
  const preview = { status: waiting ? 'waiting-for-link' : output === 'empty' ? 'needs-state' : 'rendering', output: output ?? 'unobserved', step: route.step ? { index: route.step.index, count: route.step.count, key: route.step.key } : null, missingParams: missing, ...(routeExample ? { example: routeExample } : {}) };
  const [, setPreview] = usePreviewState('routePreview', preview);
  useEffect(() => { setPreview(preview); }, [JSON.stringify(preview)]);
  usePreviewState('previewKind', 'linked-app');
  usePreviewState('designEnvironment', (hostConfig as any).design ?? null);
  const [, setInitialRoute] = usePreviewState('initialRoute', location.pathname);
  useEffect(() => { setInitialRoute(location.pathname); }, [location.pathname]);
  if (waiting) return <UnavailablePreview title="Waiting for a record" reason={`This screen needs ${missing.join(', ')}.`} detail="Open a destination in the app preview, or provide its route parameters in the inspector." />;
  return <><AppRoot key={location.href} location={location} /><RouteReceipt />{output === 'empty' && <View style={{ position: 'absolute', inset: 0 }}>
    <UnavailablePreview title="App state needed" reason="This screen has no content until its session or selected record is available." detail="Each preview has independent state. Its component source and flow connections are available in the map." />
  </View>}</>;
}

// ExpoRoot constructs wrapper component types during render. Canvas receipts must
// not remount the app's providers (and restart database migrations) as they update.
const AppRoot = memo(function AppRoot({ location }: { location: URL }) {
  return <ExpoRoot context={context} location={location} />;
});

function RouteReceipt() {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const [, setRouter] = usePreviewState('router', { pathname, params });
  useEffect(() => { setRouter({ pathname, params }); }, [pathname, JSON.stringify(params)]);
  usePreviewState('storage', (hostConfig as any).frameMMKV ? 'isolated MMKV and SQLite; app local data' : 'isolated SQLite; app migrations and bundled content');
  usePreviewState('routeGuards', 'visible in canvas preview');
  return null;
}
