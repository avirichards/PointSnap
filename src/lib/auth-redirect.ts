export function safeNext(
  value: string | null | undefined,
  fallback = "/wallet",
) {
  return value &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/[\\\r\n]/.test(value)
    ? value
    : fallback;
}
