import { createContext, use, useEffect, useState, type ReactNode } from "react";

type State = Record<string, unknown>;
type PreviewContext = {
  state: State;
  set: (key: string, value: unknown) => void;
  navigate: (key: string) => void;
  screens: readonly string[] | null;
};
const Context = createContext<PreviewContext | null>(null);

/** The host owns navigation and disposable mock state, never production data. */
export function PreviewProvider({
  children,
  navigate,
  onState,
  screens = null,
}: {
  children: ReactNode;
  navigate: (key: string) => void;
  onState: (state: State) => void;
  /** Keys of the screens on this canvas; navigation to any other key is reported, not sent. */
  screens?: readonly string[] | null;
}) {
  const [state, setState] = useState<State>({});
  return (
    <Context
      value={{
        state,
        screens,
        navigate: (key) => {
          if (screens && !screens.includes(key)) {
            console.warn(`Expo Canvas: no screen with key "${key}" is on this canvas.`);
            return;
          }
          navigate(key);
        },
        set: (key, value) =>
          setState((previous) => {
            const resolved = typeof value === "function" ? value(previous[key]) : value;
            const next = { ...previous, [key]: resolved };
            onState(next);
            return next;
          }),
      }}
    >
      {children}
    </Context>
  );
}

/** State survives navigation and resets with Reset preview. Keep defaults JSON serializable. */
export function usePreviewState<T>(
  key: string,
  initial: T,
): [T, (value: T | ((previous: T) => T)) => void] {
  const context = use(Context);
  if (!context)
    throw new Error("Render this component in Expo Canvas's preview host");
  useEffect(() => {
    if (!(key in context.state)) context.set(key, initial);
  }, [key]);
  const value = (key in context.state ? context.state[key] : initial) as T;
  return [
    value,
    (next) =>
      context.set(
        key,
        (previous: unknown) => typeof next === "function"
          ? (next as (previous: T) => T)(previous === undefined ? initial : previous as T)
          : next,
      ),
  ];
}

/** Navigate by a stable screen key from expo-canvas.json. `screens` lists the keys on this canvas. */
export function usePreviewNavigation() {
  const context = use(Context);
  if (!context) throw new Error("PreviewProvider is missing");
  return { navigate: context.navigate, screens: context.screens };
}
