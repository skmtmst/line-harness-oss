/** Worker の ?page=salon-book とLIFFの予約ページで共有する入口の引数。 */
export function readUrlState(): { view: string | null; peekMode: boolean; menuId: string | null } {
  const params = new URLSearchParams(window.location.search);
  return {
    view: params.get('view'),
    peekMode: params.get('mode') === 'peek',
    menuId: params.get('menu_id'),
  };
}
