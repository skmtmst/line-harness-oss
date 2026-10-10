import { mergeLiffStateSearch } from '@line-crm/shared';
export { mergeLiffStateSearch } from '@line-crm/shared';

export function restoreLiffStateInCurrentUrl(): void {
  const mergedSearch = mergeLiffStateSearch(window.location.search);
  if (mergedSearch === window.location.search) return;
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${mergedSearch}${window.location.hash}`,
  );
}
