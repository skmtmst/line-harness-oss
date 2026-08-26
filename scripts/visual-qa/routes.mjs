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
  { name: 'broadcasts', path: '/broadcasts', type: 'L' },
  { name: 'templates', path: '/templates', type: 'L' },
  { name: 'rich-menus', path: '/rich-menus', type: 'L' },
  { name: 'automations', path: '/automations', type: 'L' },
  // B ボード
  { name: 'dashboard', path: '/', type: 'B' },
  { name: 'analytics', path: '/analytics', type: 'B' },
  // D 詳細・専用
  { name: 'chats', path: '/chats', type: 'D' },
  // 設定系
  { name: 'settings-features', path: '/settings/features', type: 'L' },
  { name: 'staff', path: '/staff', type: 'L' },
]

/** 画像を撮る幅。V6の設計は1920だが、1440でも横スクロールが出てはいけない。 */
export const WIDTHS = [1440, 1920]
