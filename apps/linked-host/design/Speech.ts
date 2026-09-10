export * from 'expo-speech-recognition/build/index';
import { ExpoSpeechRecognitionModule as Native } from 'expo-speech-recognition/build/ExpoSpeechRecognitionModule';

import { disconnectedSpeechStart } from './speech-adapter';
const start = disconnectedSpeechStart((event, value) => Native.emit(event, value));

// Some screens request microphone access as soon as they mount. Exploring a
// design must not start recording or trigger fifteen OS permission dialogs.
const permission = async () => ({ status: 'denied', granted: false, canAskAgain: false, expires: 'never', restricted: false });
export const ExpoSpeechRecognitionModule = new Proxy(Native, {
  get(target, key, receiver) {
    if (typeof key === 'string' && /^(get|request)(Microphone|SpeechRecognizer)?PermissionsAsync$/.test(key)) return permission;
    if (key === 'start') return start;
    if (key === 'stop' || key === 'abort') return () => {};
    if (key === 'isRecognitionAvailable') return () => false;
    return Reflect.get(target, key, receiver);
  },
});
