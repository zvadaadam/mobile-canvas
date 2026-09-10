declare module 'expo-canvas-screens' {
  import type { ComponentType } from 'react';
  export const codeVersion: string;
  export const screens: { id: string; key: string; name: string; width: number; height: number; insets?: { top: number; bottom: number; left: number; right: number }; props: Record<string, unknown>; Component: ComponentType<any> }[];
}
