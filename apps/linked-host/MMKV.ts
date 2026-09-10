import * as Native from 'expo-canvas-original-mmkv';
export * from 'expo-canvas-original-mmkv';
// Keep real native MMKV while separating the app's named stores per frame.
const configForFrame = (config: any = {}) => ({ ...config, id: `canvas.${(globalThis as any).__EXPO_CANVAS_FRAME__.id}.${config.id ?? 'mmkv.default'}` });
export const createMMKV = (config?: any) => Native.createMMKV(configForFrame(config));
export const existsMMKV = (id: string) => Native.existsMMKV(configForFrame({ id }).id);
export const deleteMMKV = (id: string) => Native.deleteMMKV(configForFrame({ id }).id);
