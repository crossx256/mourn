/**
 * Generate a random file name preserving the original extension.
 */
export function generateRandomFileName(originalFileName: string): string {
  const parts = originalFileName.split('.');
  const extension = parts.length > 1 ? parts[parts.length - 1] : '';
  const randomId =
    Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  return extension ? `${randomId}.${extension}` : randomId;
}

export function resolveUploadFileName(originalFileName: string, randomize: boolean): string {
  return randomize ? generateRandomFileName(originalFileName) : originalFileName;
}
