import { useMemo } from 'react';
import { useOnAction as useOriginalOnAction } from 'expo-canvas-original-on-action';

let navigate: ((href: string) => void) | undefined;
export function setFrameNavigation(callback: (href: string) => void) { navigate = callback; }

// Replace only the proposed subtree to resolve nested stacks/tabs against the
// real router's linking config. The proposed state is never committed to a frame.
function replaceState(root: any, key: string, next: any): any {
  if (root.key === key) return next;
  return { ...root, routes: root.routes.map((route: any) => route.state ? { ...route, state: replaceState(route.state, key, next) } : route) };
}
export function useOnAction(options: any) {
  const router = useMemo(() => {
    let intercepted = false;
    return { ...options.router,
      getStateForAction(state: any, action: any, config: any) {
        intercepted = false;
        const next = options.router.getStateForAction(state, action, config);
        if (!next || next === state || !navigate || ['SET_PARAMS', 'PRELOAD'].includes(action.type)) return next;
        // Loaded after the router finishes initializing; eager imports here
        // would cycle through React Navigation's own exports.
        const { store } = require('expo-router/build/global-state/router-store') as typeof import('expo-router/build/global-state/router-store');
        const { getPathFromState } = require('expo-router/build/fork/getPathFromState') as typeof import('expo-router/build/fork/getPathFromState');
        const root = store.navigationRef?.getRootState();
        if (!root || !store.linking?.config?.screens) return next;
        const proposed = replaceState(root, state.key, next);
        const linking = { ...store.linking.config, screens: store.linking.config.screens, preserveGroups: true };
        const before = getPathFromState(root, linking);
        const href = getPathFromState(proposed, linking);
        if (href === before) return next;
        intercepted = true;
        navigate(href);
        // Native tabs optimistically select on the native side. A new state
        // identity makes their provenance handshake restore the assigned tab.
        return { ...state };
      },
      shouldActionChangeFocus(action: any) { return !intercepted && options.router.shouldActionChangeFocus(action); },
    };
  }, [options.router]);
  return useOriginalOnAction({ ...options, router });
}
