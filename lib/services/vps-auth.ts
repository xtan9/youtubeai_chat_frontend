export function getVpsApiKeys(): string[] {
  const currentKey = process.env.VPS_API_KEY?.trim();
  if (!currentKey) return [];
  return [currentKey, process.env.VPS_API_KEY_PREVIOUS]
    .map((key) => key?.trim())
    .filter((key, index, keys): key is string =>
      Boolean(key) && keys.indexOf(key) === index
    );
}

/**
 * Send one VPS request with the current key and retry only an authentication
 * rejection with the previous rotation key. Provider failures are returned
 * unchanged so a service outage cannot be mistaken for a key problem.
 */
export async function fetchWithVpsKeyRotation(
  url: string,
  init: RequestInit,
  keys: readonly string[]
): Promise<Response> {
  let response: Response | undefined;
  const signal = init.signal;
  const throwIfAborted = () => {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
    }
  };

  for (let index = 0; index < keys.length; index += 1) {
    throwIfAborted();
    const headers: Record<string, string> =
      init.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : Array.isArray(init.headers)
          ? Object.fromEntries(init.headers)
          : { ...(init.headers as Record<string, string> | undefined) };
    headers.Authorization = `Bearer ${keys[index]}`;
    response = await fetch(url, { ...init, headers });
    throwIfAborted();

    if (
      (response.status !== 401 && response.status !== 403) ||
      index === keys.length - 1
    ) {
      return response;
    }

    // Do not leave a rejected response body open while retrying. This is a
    // small but important guard for Node's connection pool during rotation.
    await response.body?.cancel().catch(() => undefined);
  }

  // Callers validate that at least one key exists. This branch keeps the
  // helper total if a future caller violates that precondition.
  throw new Error("VPS_API_URL and VPS_API_KEY must be configured");
}
