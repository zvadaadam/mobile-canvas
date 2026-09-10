import './console';
import { AppRegistry, LogBox } from 'react-native';
import NativeScreen from './Screen';

// Console output still reaches Metro and the screen receipts; the banner would pollute captures.
LogBox.ignoreAllLogs(true);
AppRegistry.registerComponent('ExpoCanvasScreen', () => NativeScreen);
