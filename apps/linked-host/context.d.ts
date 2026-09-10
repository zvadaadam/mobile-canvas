declare module 'expo-canvas-route-context' {
  import type { ComponentProps } from 'react';
  import type { ExpoRoot } from 'expo-router';
  export const context: ComponentProps<typeof ExpoRoot>['context'];
}
declare module 'expo-canvas-original-on-action' {
  export { useOnAction } from 'expo-router/build/react-navigation/core/useOnAction';
}
declare module 'expo-canvas-original-mmkv' {
  export function createMMKV(configuration?: Record<string, unknown>): any;
  export function existsMMKV(id: string): boolean;
  export function deleteMMKV(id: string): boolean;
}
