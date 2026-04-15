/**
 * withTimeout wraps any Promise with a hard deadline. If the timeout fires,
 * the returned promise rejects with an Error whose message includes `label`
 * and the ms budget. Optionally invokes `onTimeout` (e.g. to abort an
 * AbortController) so the underlying operation can free its resources.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* ignore */ }
      reject(new Error(`[TIMEOUT] ${label} exceeded ${ms}ms`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
