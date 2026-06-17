/**
 * Returns the current timestamp as an ISO 8601 string.
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Calculates the duration in minutes between two ISO 8601 timestamps.
 */
export function durationMinutes(startISO: string, endISO: string): number {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  return Math.round((end - start) / (1000 * 60));
}

/**
 * Calculates the duration in seconds between two ISO 8601 timestamps.
 */
export function durationSeconds(startISO: string, endISO: string): number {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  return Math.round((end - start) / 1000);
}

/**
 * Checks if a date string is a valid ISO 8601 date.
 */
export function isValidISODate(value: string): boolean {
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * Checks if a date falls within an inclusive range.
 */
export function isWithinRange(date: string, start: string, end: string): boolean {
  const d = new Date(date).getTime();
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return d >= s && d <= e;
}
