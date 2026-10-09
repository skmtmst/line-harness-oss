// アプリ内 window カスタムイベント名。dispatch 側と listener 側で必ずこの定数を使う
// (文字列リテラル散在だと typo でサイレントに壊れるため)。
export const UNANSWERED_REFRESH_EVENT = 'lh:unanswered-refresh'

/* ★V8 外側: 左メニューの畳み切替。上の帯のボタンと ⌘\ が投げ、Sidebar が受ける。 */
export const SIDEBAR_TOGGLE_EVENT = 'lh:sidebar-toggle'

/* 見た目の切り替えの合図。画面の切り替え口は V8 固定（2026-10-09）で外し、今は試験の中でだけ投げる。 */
export const ADMIN_THEME_CHANGED_EVENT = 'lh:admin-theme-changed'
