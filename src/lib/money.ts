/**
 * Money helpers. Everything internal is integer minor units.
 */

const SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  AUD: 'A$',
  CAD: 'C$',
  SGD: 'S$',
  AED: 'AED ',
};

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? code + ' ';
}

/**
 * Parse user input to minor units.
 *
 * Handles both conventions without guessing wrong on the common cases:
 * "1,234.5" (comma groups) and "1.234,5" (European) both mean 1234.50. When
 * only commas appear, exactly three trailing digits reads as grouping
 * ("1,234" -> 1234.00), anything else as a decimal ("12,5" -> 12.50).
 * All arithmetic is integer, so no float rounding creeps in.
 */
export function parseAmount(input: string): number {
  const raw = (input || '').replace(/[^0-9.,-]/g, '');
  if (!raw) return 0;

  const negative = raw.startsWith('-');
  const body = raw.replace(/-/g, '');
  if (!body) return 0;

  const lastComma = body.lastIndexOf(',');
  const lastDot = body.lastIndexOf('.');

  let decimalIndex: number;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalIndex = Math.max(lastComma, lastDot); // whichever is rightmost wins
  } else if (lastComma >= 0) {
    decimalIndex = body.length - lastComma - 1 === 3 ? -1 : lastComma;
  } else {
    decimalIndex = lastDot;
  }

  const strip = (value: string) => value.replace(/[.,]/g, '');
  const whole = Number(
    strip(decimalIndex === -1 ? body : body.slice(0, decimalIndex)) || '0'
  );
  const fraction =
    decimalIndex === -1 ? '' : strip(body.slice(decimalIndex + 1));

  if (!Number.isFinite(whole)) return 0;

  // Round on the third decimal rather than truncating it away.
  const padded = (fraction + '000').slice(0, 3);
  let cents = Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1;
  if (!Number.isFinite(cents)) return 0;

  const value = whole * 100 + cents;
  return negative ? -value : value;
}

/**
 * 1234 -> "12.34". Two decimals, no symbol. Digit grouping follows the
 * currency: INR uses the 1,23,456 lakh convention, everything else 123,456.
 */
export function formatAmount(minor: number, currency = 'INR'): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const grouped = whole.toLocaleString(locale);
  return (negative ? '-' : '') + grouped + '.' + String(cents).padStart(2, '0');
}

/** Display form with symbol, e.g. "-> Rs 1,234.50". */
export function formatMoney(minor: number, currency = 'INR'): string {
  return currencySymbol(currency) + formatAmount(Math.abs(minor), currency);
}

/**
 * Split `total` into `count` parts that sum exactly to `total`.
 *
 * The remainder cents are handed out one each to the earliest recipients
 * rather than rounded away, so 1000/3 becomes [334, 333, 333] - summing to
 * exactly 1000. Any approach that rounds each share independently loses or
 * invents money on most inputs.
 */
export function splitEvenly(total: number, count: number): number[] {
  if (count <= 0) return [];
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / count);
  const remainder = abs - base * count;
  return Array.from({ length: count }, (_, i) =>
    sign * (base + (i < remainder ? 1 : 0))
  );
}

/**
 * Scale weights (percentages, shares) to sum exactly to `total`.
 * Largest-remainder method: floor everything, then give the leftover cents to
 * whoever was rounded down hardest. Keeps the sum exact and the bias fair.
 */
export function splitByWeights(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return splitEvenly(total, weights.length);

  const exact = weights.map((w) => (total * w) / sum);
  const floored = exact.map(Math.floor);
  let leftover = total - floored.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);

  const result = [...floored];
  for (let i = 0; leftover > 0 && i < order.length; i += 1, leftover -= 1) {
    result[order[i].index] += 1;
  }
  return result;
}
