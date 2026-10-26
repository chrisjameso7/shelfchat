export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch("/api" + url, init);
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: "Request failed. Please try again." }));
    throw new Error(body.error);
  }
  const result = await response.json();
  if (init?.method && init.method !== "GET")
    window.dispatchEvent(new Event("shelfchat:refresh"));
  return result;
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
