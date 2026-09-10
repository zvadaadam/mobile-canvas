type Handler = (error: Error, fatal?: boolean) => void;
export interface ErrorHandlers { getGlobalHandler(): Handler; setGlobalHandler(handler: Handler): void }
/** Only isolated linked runtimes can attribute an uncaught exception to one frame. */
export function containFrameErrors(handlers: ErrorHandlers | undefined, report: Handler) {
  if (!handlers) return () => {};
  const previous = handlers.getGlobalHandler();
  handlers.setGlobalHandler(report);
  return () => { if (handlers.getGlobalHandler() === report) handlers.setGlobalHandler(previous); };
}
