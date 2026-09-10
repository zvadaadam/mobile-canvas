import { Text, Dimensions } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import Boundary from './Boundary';
import UnavailablePreview from './UnavailablePreview';
import { containFrameErrors, type ErrorHandlers } from './frame-errors';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PreviewProvider } from '@expo-canvas/preview';
import { screens, codeVersion } from 'expo-canvas-screens';
import { recentConsole } from './console';

type Props = { screenId: string; runtimeUrl: string; workspaceId: string; hostId: string; isolatedRuntime?: boolean };

export default function NativeScreen({ screenId, runtimeUrl, workspaceId, hostId, isolatedRuntime }: Props) {
  const screen = screens.find((entry) => entry.id === screenId);
  const [reset, setReset] = useState(0);
  const [frameError, setFrameError] = useState<string | null>(null);
  const state = useRef<Record<string, unknown>>({});
  const error = useRef<string | null>(null);
  const mountedAt = useRef(Date.now());
  const acknowledged = useRef(0);
  const navigation = useRef<string | null>(null);
  const version = useRef(codeVersion);
  if (version.current !== codeVersion) { version.current = codeVersion; error.current = null; }
  const reportNow = useRef<() => void>(() => {});
  const retry = () => { state.current = {}; error.current = null; setFrameError(null); setReset(value => value + 1); };
  useEffect(() => {
    if (!isolatedRuntime) return;
    return containFrameErrors((globalThis as any).ErrorUtils as ErrorHandlers | undefined, failure => {
      const message = failure?.message ?? String(failure);
      error.current = message; state.current.previewError = { message, stack: failure?.stack ?? null };
      setFrameError(message); reportNow.current();
    });
  }, [isolatedRuntime]);
  useEffect(() => { setFrameError(null); }, [codeVersion]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let pending = false;
    let request: AbortController | undefined;
    // One receipt per second keeps many frames cheap; state and navigation changes report at once.
    const report = async () => {
      if (!alive) return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
      clearTimeout(timer);
      // A destination is sent once; a rejected destination must not be retried forever.
      const destination = navigation.current;
      navigation.current = null;
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 4000);
      try {
        const response = await fetch(`${runtimeUrl}/api/studio/report`, {
          signal: request.signal, method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, hostId, kind: 'screen', screenId, codeVersion,
            state: state.current, error: error.current, mountedAt: mountedAt.current,
            acknowledged: acknowledged.current, navigation: destination, console: recentConsole() }),
        });
        if (!response.ok) throw new Error(`Report failed: ${response.status}`);
        const { command } = await response.json();
        if (alive && command && command.id > acknowledged.current) {
          acknowledged.current = command.id;
          if (command.type === 'reset') {
            retry();
          }
        }
      } catch { /* A temporary reconnect must not unmount the native view tree. */ }
      finally {
        clearTimeout(timeout);
        request = undefined;
        inFlight = false;
        if (alive) timer = setTimeout(report, pending ? 0 : 1000);
        pending = false;
      }
    };
    reportNow.current = () => { void report(); };
    void report();
    return () => { alive = false; clearTimeout(timer); request?.abort(); reportNow.current = () => {}; };
  }, [runtimeUrl, workspaceId, hostId, screenId, codeVersion]);
  if (!screen) return <Text>Loading screen…</Text>;
  // Matched hosts load route modules lazily after identifying this frame. Each
  // frame has its own JS runtime, so these values cannot leak to another screen.
  if (isolatedRuntime) {
    (globalThis as any).__EXPO_CANVAS_FRAME__ = { id: screenId, width: screen.width, height: screen.height };
    const window = Dimensions.get('window');
    if (window.width !== screen.width || window.height !== screen.height)
      Dimensions.set({ window: { ...window, width: screen.width, height: screen.height } });
  }
  const Screen = screen.Component;
  const insets = { top: 0, left: 0, right: 0, bottom: 0, ...(screen.insets ?? {}) };
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: screen.width, height: screen.height }, insets }}>
    <PreviewProvider key={reset} screens={screens.map((entry) => entry.key)} onState={(value) => { state.current = value; reportNow.current(); }} navigate={(key) => { navigation.current = key; reportNow.current(); }}>
      <Boundary key={reset} version={codeVersion} onRetry={retry} onError={(message) => { error.current = message; reportNow.current(); }}>
        {frameError ? <UnavailablePreview kind="error" title="This preview hit an error" reason="The error is contained to this frame. Retry it or edit its source; the rest of your canvas stays available." detail={frameError} onRetry={retry} /> : <Screen {...screen.props} />}
      </Boundary>
    </PreviewProvider>
  </SafeAreaProvider>;
}
