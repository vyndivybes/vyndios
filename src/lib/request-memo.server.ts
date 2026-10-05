export function createRequestMemoizer<T>() {
  const byRequest = new WeakMap<Request, Map<string, Promise<T>>>();

  return async function memoizeRequest(
    request: Request,
    key: string,
    resolve: () => Promise<T>,
  ): Promise<T> {
    let cache = byRequest.get(request);
    if (!cache) {
      cache = new Map<string, Promise<T>>();
      byRequest.set(request, cache);
    }

    const existing = cache.get(key);
    if (existing) return existing;

    const pending = Promise.resolve().then(resolve);
    cache.set(key, pending);

    try {
      return await pending;
    } catch (error) {
      if (cache.get(key) === pending) cache.delete(key);
      throw error;
    }
  };
}
