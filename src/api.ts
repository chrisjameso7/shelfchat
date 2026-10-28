export async function api<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const deadline = AbortSignal.timeout(
    init?.timeoutMs ?? (url.includes("/read?") ? 45000 : 20000),
  );
  const headers = new Headers(init?.headers);
  if (typeof init?.body === "string" && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  try {
    const response = await fetch("/api" + url, {
      ...init,
      headers,
      signal: init?.signal
        ? AbortSignal.any([init.signal, deadline])
        : deadline,
    });
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ error: "Request failed. Try again." }));
      throw new Error(body.error || "Request failed. Try again.");
    }
    const result = await response.json();
    if (init?.method && init.method !== "GET")
      window.dispatchEvent(new Event("shelfchat:refresh"));
    return result;
  } catch (error) {
    if (deadline.aborted) throw new Error("Request timed out. Try again.");
    throw error;
  }
}
export type Capabilities = {
  transport: "poll" | "sse";
  uploads: "blob" | "local";
};
export const capabilities = () => api<Capabilities>("/config");
export function readIdentity() {
  try {
    const value = JSON.parse(
      localStorage.getItem("shelfchat.identity.v1") || "null",
    );
    return value &&
      typeof value.handle === "string" &&
      typeof value.tag === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
export const fileSize = (size: number) =>
  size
    ? size >= 1048576
      ? `${(size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(size / 1024))} KB`
    : "External file";
