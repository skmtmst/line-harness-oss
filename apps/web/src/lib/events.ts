// アプリ内 window カスタムイベント名。dispatch 側と listener 側で必ずこの定数を使う
// (文字列リテラル散在だと typo でサイレントに壊れるため)。
export const UNANSWERED_REFRESH_EVENT = 'lh:unanswered-refresh'

/* ★V8 外側: 左メニューの畳み切替。上の帯のボタンと ⌘\ が投げ、Sidebar が受ける。 */
export const SIDEBAR_TOGGLE_EVENT = 'lh:sidebar-toggle'

/* ★V8: 設定画面の見た目スイッチが投げる。帯の通知件数など遅れて読む部品が受ける。 */
export const ADMIN_THEME_CHANGED_EVENT = 'lh:admin-theme-changed'
