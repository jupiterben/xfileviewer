/** A dependency-free boundary shared by viewers, parsers and optional features.
 * Keep import() inside the factory: registration must never execute module code.
 * Concurrent callers share one promise; a rejected factory can be retried.
 */
export function lazyModule<T>(factory: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      // Capture synchronous errors too, without delaying the first import.
      try {
        pending = Promise.resolve(factory()).catch((error: unknown) => {
          pending = undefined;
          throw error;
        });
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return pending;
  };
}
