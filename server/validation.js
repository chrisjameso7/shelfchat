class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}
export function clean(value, min, max, label) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    throw new ValidationError(`${label} must be ${min}–${max} characters.`);
  return value.trim();
}
export function safeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError("Provide a valid HTTPS file link.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname === "localhost" ||
    url.hostname.includes(":") ||
    /^\d+\./.test(url.hostname) ||
    !url.hostname.includes(".")
  )
    throw new ValidationError("Use a public HTTPS file link.");
  return url.href;
}
export function noteInput(body) {
  const handle = clean(body.handle, 2, 24, "Handle");
  if (!/^[\w-]+$/.test(handle))
    throw new ValidationError(
      "Handle may contain letters, numbers, underscores and hyphens.",
    );
  return {
    handle,
    tag: clean(body.tag, 1, 30, "Identity tag"),
    text: clean(body.text, 1, 2000, "Note"),
  };
}
