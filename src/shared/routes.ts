import type { GuardTransition } from './guards';
export type StaticValue = string | number | boolean | null;
export type StaticOptions = Record<string, StaticValue>;
export type NavigatorKind = "stack" | "tabs" | "native-tabs" | "slot" | "unknown";
export interface TabInfo { name: string; label: string | null; icon: string | null; selectedIcon: string | null }
export interface LayoutInfo {
  /** App-relative posix path, such as src/app/(tabs)/_layout.tsx. */
  file: string;
  /** Route directory relative to the routes directory; "" for the root layout. */
  dir: string;
  kind: NavigatorKind;
  screenOptions: StaticOptions;
  screens: Record<string, StaticOptions>;
  tabs: TabInfo[];
}
export interface Insets { top: number; bottom: number; left: number; right: number }
export interface RoutePager {
  file: string;
  steps: { key: string; title: string; file: string }[];
  setter: string;
  fields: string[];
  refs: string[];
  shared: string[];
  transition: string;
}
export interface RouteFrame {
  key: string;
  name: string;
  /** Route pattern without groups, such as /workout/[id]. */
  path: string;
  /** Route pattern with groups, such as /(tabs)/today. */
  fullPath: string;
  /** Shared source has one frame; these are its valid navigator contexts. */
  contexts?: { fullPath: string; chain: string[]; names: string[] }[];
  params: string[];
  /** App-relative posix path of the route file. */
  file: string;
  /** Layout files from the root inward. */
  chain: string[];
  /** The child route name each layout sees for this route. */
  names: string[];
  presentation: string;
  tabbed: boolean;
  headers: number;
  largeTitle: boolean;
  redirect: string | null;
  insets: Insets;
  /** Keys of the frames this route's source navigates to. */
  links: string[];
  notes: string;
  /** A distinct, pinned visual step within this same route. */
  step?: { key: string; index: number; count: number; title: string; file: string; routeKey: string; pager: RoutePager };
  /** Static evidence is an approximation of content navigation, not a crawl. */
  guardTransitions?: GuardTransition[];
  linkEvidence?: { target: string; file: string; kind: 'content' | 'step' | 'guard' }[];
}
export interface RouteMap {
  /** The routes directory, app-relative posix, such as src/app. */
  routesDirectory: string;
  layouts: LayoutInfo[];
  frames: RouteFrame[];
}
