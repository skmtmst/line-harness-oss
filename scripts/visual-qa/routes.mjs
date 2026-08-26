/**
 * 画像で見張るルートの一覧。
 *
 * 全103ルートをいきなり入れない。**5つの画面型の代表**から始めて、
 * 落ち着いたら増やす。増やすときは、そのルートが本当に描けることを
 * 手で1回確かめてから足す（描けないものを入れると、毎回赤いままになり、
 * 誰も見なくなる）。
 *
 * `name` は画像のファイル名になる。変えると前回と比較できなくなるので、
 * 一度決めたら変えない。
 */
export const ROUTES = [
  // L 一覧
  { name: 'tags', path: '/tags', type: 'L' },
  { name: 'friends', path: '/friends', type: 'L' },
  { name: 'scenarios', path: '/scenarios', type: 'L' },
  { name: 'templates', path: '/templates', type: 'L' },
  // D 受信箱（3カラム全画面）
  { name: 'chats', path: '/chats', type: 'D' },
  // 設定系
  { name: 'settings-features', path: '/settings/features', type: 'L' },
  { name: 'staff', path: '/staff', type: 'L' },
]

/**
 * まだ入れられないルート。**モックの形が足りず、画面が落ちる。**
 *
 * 落ちるものを一覧へ入れると毎回赤くなり、誰も見なくなる。
 * 直したら `ROUTES` へ移す。直し方は `mock-api.mjs` の `ARRAY_PATHS` /
 * `ARRAY_PREFIXES` に、その画面が読む口を足すこと（推測しない。
 * ブラウザのコンソールに出る `◯◯.filter is not a function` を見る）。
 *
 * - `/`            ダッシュボード
 * - `/analytics`   分析
 * - `/broadcasts`  一斉配信
 * - `/rich-menus`  リッチメニュー
 * - `/automations` オートメーション
 */
export const NOT_READY = ['/', '/analytics', '/broadcasts', '/rich-menus', '/automations']

/** 画像を撮る幅。V6の設計は1920だが、1440でも横スクロールが出てはいけない。 */
export const WIDTHS = [1440, 1920]
