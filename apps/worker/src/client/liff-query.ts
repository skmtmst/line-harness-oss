import { mergeLiffStateLocation } from '@line-crm/shared';
export { mergeLiffStateSearch } from '@line-crm/shared';

export function restoreLiffStateInCurrentUrl(): void {
  const restored = mergeLiffStateLocation(window.location.pathname, window.location.search, window.location.hash);
  if (restored === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  window.history.replaceState(window.history.state, '', restored);
}
