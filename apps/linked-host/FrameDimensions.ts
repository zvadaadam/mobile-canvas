const NativeDimensions = require('expo-canvas-native-dimensions').default;

function get(name: 'window' | 'screen') {
  const physical = NativeDimensions.get(name);
  const frame = (globalThis as any).__EXPO_CANVAS_FRAME__;
  return frame ? { ...physical, width: frame.width, height: frame.height } : physical;
}

// Window resize events still propagate, but app layout always sees its own frame.
export default {
  get,
  set: NativeDimensions.set.bind(NativeDimensions),
  addEventListener(type: 'change', handler: (value: unknown) => void) {
    return NativeDimensions.addEventListener(type, () => handler({ window: get('window'), screen: get('screen') }));
  },
};
