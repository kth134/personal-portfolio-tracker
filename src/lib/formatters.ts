// lib/formatters.ts

/**
 * Formats a number as USD with commas and 2 decimal places
 * e.g., 1234567.89 → "$1,234,567.89"
 */
export const formatUSD = (value: number | undefined | null): string => {
  if (value == null || isNaN(value)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

/**
 * Formats a large number with commas (no currency symbol)
 * Useful if we later want commas on quantity for stocks with large share counts
 */
export const formatNumber = (value: number | undefined | null): string => {
  if (value == null || isNaN(value)) return '0';
  return new Intl.NumberFormat('en-US').format(value);
};