import { requireNativeModule } from 'expo-modules-core';

// Use real SQLite, with a separate directory per frame in the canvas app's sandbox.
// This also covers direct openDatabase calls and connections created by transactions.
const native = requireNativeModule<any>('ExpoSQLite');
export default new Proxy(native, {
  get(target, key) {
    if (key === 'defaultDatabaseDirectory') return `${target.defaultDatabaseDirectory}/canvas/${(globalThis as any).__EXPO_CANVAS_FRAME__.id}`;
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
