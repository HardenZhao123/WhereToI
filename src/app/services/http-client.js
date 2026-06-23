export async function fetchJson(url, options = {}) {
  const { headers: optionHeaders, ...fetchOptions } = options;
  const headers = {
    Accept: "application/json",
    ...(optionHeaders ?? {})
  };

  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
  if (options.body !== undefined && !hasContentType) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...fetchOptions,
    credentials: fetchOptions.credentials ?? "include",
    headers
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    const retryAfter = response.headers?.get?.("retry-after");
    if (retryAfter) {
      const retryAfterSeconds = Number(retryAfter);
      const retryAt = Date.parse(retryAfter);
      error.retryAfterMs = Number.isFinite(retryAfterSeconds)
        ? Math.max(0, retryAfterSeconds * 1000)
        : Math.max(0, retryAt - Date.now());
    }
    throw error;
  }

  return payload;
}
