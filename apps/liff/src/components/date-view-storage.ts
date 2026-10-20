/** 日時を選ぶ段の見せ方。'list' が週5日の並び 、'calendar' が月の表 。 */
export type DateView = 'list' | 'calendar';

const VIEW_STORAGE_KEY = 'liff-booking-date-view';
/** 端末に覚えた見せ方。読めないときは黙って null（設定の値に戻る）。 */
export function storedView(): DateView | null {
  try {
    const value = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return value === 'list' || value === 'calendar' ? value : null;
  } catch {
    return null;
  }
}

/** 切り替えた見せ方を端末に覚える。書けないときは黙って諦める。 */
export function rememberView(view: DateView): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    /* 書けない端末では次回も設定の値で開く */
  }
}
