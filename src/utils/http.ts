export function isJsonContentType(headers?: Record<string, unknown> | null): boolean {
  const contentType = String(headers?.['content-type'] ?? headers?.['Content-Type'] ?? '');
  return contentType.toLowerCase().includes('application/json');
}
