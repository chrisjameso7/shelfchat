export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch("/api" + url, init);
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: "Request failed. Please try again." }));
    throw new Error(body.error);
  }
  return response.json();
}
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
  size ? `${(size / 1024 / 1024).toFixed(1)} MB` : "External file";
