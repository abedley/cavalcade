/**
 * The daily deal: everyone playing on the same calendar date gets the same
 * seed, and so the same shuffle and the same starting player. The date is the
 * player's local date, so the deal changes at their midnight.
 */

/** The local calendar date of `date` as `YYYY-MM-DD`. */
export function dayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Midnight at the start of the day named by a `YYYY-MM-DD` key, in local time. */
export function dateOfKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The seed for a day: a 32-bit FNV-1a hash of its key, so neighbouring days deal very differently. */
export function seedForDay(key) {
  let hash = 0x811c9dc5;
  for (const ch of `cavalcade:${key}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Milliseconds from `date` until the next local midnight. */
export function msUntilMidnight(date = new Date()) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return next - date;
}
