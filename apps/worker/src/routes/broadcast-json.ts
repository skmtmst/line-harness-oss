


/**
 * Parse a D1 JSON-array column. Returns:
 *   - null if the column is null/undefined/empty string or parse fails
 *   - the value as-is if already an array (some D1 drivers auto-parse JSON columns)
 *   - the parsed array if the JSON is a valid string-array
 *   - null if parsed JSON is not an array (e.g., object, scalar)
 */
export function parseJsonArray(s: unknown): string[] | null {
  if (!s) return null;
  if (Array.isArray(s)) return s as string[];
  if (typeof s !== 'string') return null;
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}


export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
