/** The native speech API reports start failures through events, not a thrown
 * exception. Keep this contract even when the service is disconnected. */
export function disconnectedSpeechStart(emit: (event: 'error' | 'end', value: any) => void) {
  return () => {
    setTimeout(() => {
      emit('error', { error: 'not-allowed', message: 'Speech recording is unavailable in Canvas design preview.', code: 0 });
      emit('end', {});
    }, 0);
  };
}
