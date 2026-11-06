/** メニューの控えがない保存済み予約でも表示できるよう、現在名へ戻す。 */
export function bookingHistoryItem<T extends { menu_name: string; menu_snapshot_json?: string | null }>(row: T): Omit<T, 'menu_snapshot_json'> {
  const { menu_snapshot_json, ...item } = row;
  if (menu_snapshot_json) {
    try {
      const saved: unknown = JSON.parse(menu_snapshot_json);
      if (saved && typeof saved === 'object' && 'name' in saved && typeof saved.name === 'string' && saved.name.trim()) {
        item.menu_name = saved.name;
      }
    } catch {
      // A damaged snapshot must not prevent the customer from reading history.
    }
  }
  return item;
}
