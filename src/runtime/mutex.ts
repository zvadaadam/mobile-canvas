/**
 * One asynchronous critical section at a time, in arrival order. Every
 * serializer in the runtime (project switches, session commits, selection
 * writes, workflow mutations) is this one primitive.
 */
export interface Mutex {
  /** Resolves once the caller holds the lock; the returned release is idempotent. */
  acquire(): Promise<() => void>;
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export function createMutex(): Mutex {
  let tail: Promise<void> = Promise.resolve();
  const acquire = async (): Promise<() => void> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  };
  return {
    acquire,
    async run(operation) {
      const release = await acquire();
      try {
        return await operation();
      } finally {
        release();
      }
    },
  };
}
