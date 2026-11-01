/**
 * Format a number in human-readable short form.
 * 1234 → "1.2k", 1234567 → "1.2M", 1234567890 → "1.2B"
 */
export function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'k';
  return String(num);
}

/**
 * Format a number with thousands separators.
 * 1234567 → "1,234,567"
 */
export function formatNumberCommas(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
