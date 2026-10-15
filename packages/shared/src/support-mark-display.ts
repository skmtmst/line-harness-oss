export const SUPPORT_MARK_LOCATIONS = ['inbox','friends','friend_detail'] as const;
export type SupportMarkLocation = typeof SUPPORT_MARK_LOCATIONS[number];
/** Empty means hidden everywhere; omission preserves the historic three locations. */
export function parseSupportMarkLocations(value: unknown): SupportMarkLocation[] {
  if (!Array.isArray(value) || value.length > 3 || value.some(item=>!SUPPORT_MARK_LOCATIONS.includes(item)) || new Set(value).size!==value.length) throw new Error('INVALID_DISPLAY_LOCATIONS');
  return SUPPORT_MARK_LOCATIONS.filter(item=>value.includes(item));
}
