export class CanvasError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function errorBody(error: unknown) {
  return {
    ok: false as const,
    error: {
      code: error instanceof CanvasError ? error.code : "invalid_request",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}
