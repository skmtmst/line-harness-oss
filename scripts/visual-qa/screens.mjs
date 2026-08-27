/**
 * V6の画面台帳。**撮り方をコードではなくデータで持つ。**
 *
 * 機能ごとに使い捨てのスクリプトを書いていたときは、1機能ごとに
 * 「開いて・押して・撮る」を書き直していた。262枚ぶん書くと必ずどこかで
 * 撮り方がずれ、**ずれた絵どうしを比べて「差がある」と言ってしまう。**
 *
 * ここに1行足せば、設計側も実装側も同じ手順で撮れる。
 * 撮るのは `capture-screens.mjs`。
 *
 * 書き方
 *   node      Pencil の実ノードID。台帳（`docs/design-qa/v6-screen-ledger.md`）と同じ
 *   feature   機能番号。撮る単位
 *   name      画面番号と名前
 *   dir       画像を置く場所。`docs/design-reference/<dir>/` と `docs/design-qa/<dir>/`
 *   route     実装のルート
 *   mode      'page'     … ページ全体を撮る（`fullPage`）
 *             'viewport' … 見えている範囲だけ撮る
 *   height    'viewport' のときの高さ。**設計の高さに合わせる**
 *   steps     撮る前の操作。`{ click: 'ボタン名' }` `{ wait: 800 }`
 *   clock     時計を止める時刻。相対時刻（「6日前」）を出す画面では必須
 *   status    'unimplemented' … 実装が無い。**撮らない。合格にもしない**
 *   why       `status` の理由。空にしない
 *
 * **`mode: 'page'` で重なりを撮らない。** `fullPage` は `position: fixed` を
 * 最初のビューポート位置に焼き込むので、ドロワーやダイアログが途中から
 * 始まる、実際には起きない絵になる。重なりは 'viewport' で、設計と同じ高さで撮る。
 */

/** ダッシュボードの「6日前」を止める時刻。設計の推移が8/19までなので、その日に置く。 */
const DASHBOARD_CLOCK = '2026-08-19T12:00:00.000Z'

export const SCREENS = [
  // ── 機能1 ダッシュボード ────────────────────────────────
  {
    node: 'vUXKb', feature: 1, name: '1-1 ダッシュボード',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
  },
  {
    node: 'ZN0ov', feature: 1, name: '1-1-1 ダッシュボード編集',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
    steps: [{ click: 'ダッシュボード編集' }],
  },
  {
    node: 'JN6mQ', feature: 1, name: '1-1-2 友だち追加QR',
    dir: 'dashboard-v6', route: '/', mode: 'viewport', height: 1668, clock: DASHBOARD_CLOCK,
    steps: [{ click: 'QRを表示' }],
  },
  {
    node: 'NjK9q', feature: 1, name: '1-1-3 対応受信の表示件数を開く',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
    steps: [{ click: '表示件数' }],
  },
  {
    node: 'Alekb', feature: 1, name: '1-1-4 通知パネルを開く',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
    steps: [{ click: '通知' }],
  },

  // ── 機能4 友だち属性 ─────────────────────────────────────
  // 一覧・状態・削除・CSVは `capture.spec.mjs` で基準画像として撮っている。
  // ここには、設計と並べるために撮るものだけを置く。
  {
    node: 'l25rlp', feature: 4, name: '4-1-A タグを作る・初期状態',
    dir: 'friend-attributes-v6', route: '/tags/new', mode: 'page',
  },
  {
    node: 'tP0RW', feature: 4, name: '4-1-B タグを作る・連動ON',
    dir: 'friend-attributes-v6', route: '/tags/new', mode: 'page',
    steps: [{ click: 'タグ連動', role: 'switch' }],
  },
  {
    node: 'LfrQs', feature: 4, name: '4-1-C 連動アクション追加ドロワー',
    dir: 'friend-attributes-v6', route: '/tags/new', mode: 'viewport', height: 1320,
    steps: [{ click: 'タグ連動', role: 'switch' }, { click: '＋ アクションを追加' }],
  },
  {
    node: 'ee0sk', feature: 4, name: '4-1-D タグを編集・既存設定あり',
    dir: 'friend-attributes-v6', route: '/tags/edit?id=tag-0', mode: 'page',
  },
  {
    node: 'VjXGX', feature: 4, name: '4-1-E 遡及反映の確認ダイアログ',
    dir: 'friend-attributes-v6', route: '/tags/edit?id=tag-0', mode: 'viewport', height: 1590,
    steps: [{ click: '遡及反映', role: 'switch', onlyIfOff: true }, { click: '保存する' }],
  },
  {
    node: 'byqIW', feature: 4, name: '4-1-G 属性フォルダを追加・色編集',
    dir: 'friend-attributes-v6', route: '/tags/folders/new', mode: 'page',
  },
  {
    node: 'A1ZYeP', feature: 4, name: '4-2-A 友だち情報欄の項目を追加',
    dir: 'friend-attributes-v6', route: '/tags/fields/new', mode: 'page',
  },
  {
    node: 'KoT6c', feature: 4, name: '4-2-B 友だち情報欄・項目移行',
    dir: 'friend-attributes-v6', route: '—', status: 'unimplemented',
    why: '項目移行の画面もルートも無い',
  },
  {
    node: 'GMvBd', feature: 4, name: '4-3-A 対応マークを追加・編集',
    dir: 'friend-attributes-v6', route: '/tags?tab=marks', status: 'unimplemented',
    why: '追加・編集の画面が無い。一覧の下に名前と色だけの追加欄がある',
  },
  {
    node: 'zGZMA', feature: 4, name: '4-3-B 対応マーク削除の確認ダイアログ',
    dir: 'friend-attributes-v6', route: '/tags?tab=marks', mode: 'viewport', height: 1080,
    steps: [{ click: '削除', nth: 1, scope: 'main' }],
  },
  {
    node: 'XBkiQ', feature: 4, name: '4-4-A 保存した検索の条件確認・編集',
    dir: 'friend-attributes-v6', route: '/tags?tab=searches', status: 'unimplemented',
    why: '条件の確認・編集の画面が無い。一覧は名前の確認と削除だけ',
  },
]

/** 設計の高さ。`Get(node)` で引いた実寸。`capture-screens.mjs --design` が使う。 */
export const DESIGN_SIZE = {
  vUXKb: [1920, 1668], ZN0ov: [1920, 1754], JN6mQ: [1920, 1668],
  NjK9q: [1920, 1668], Alekb: [1920, 1668],
  l25rlp: [1920, 1080], tP0RW: [1920, 1320], LfrQs: [1920, 1320],
  ee0sk: [1920, 1590], VjXGX: [1920, 1590], byqIW: [1920, 1080],
  A1ZYeP: [1920, 1080], KoT6c: [1920, 1080], GMvBd: [1920, 1080],
  zGZMA: [1920, 1080], XBkiQ: [1920, 1136],
}

/** 撮る幅。V6の設計は1920だが、1440でも横スクロールが出てはいけない。 */
export const WIDTHS = [1440, 1920]

/** その機能の画面。`--feature 1` で引く。 */
export function screensOf(feature) {
  return SCREENS.filter((s) => s.feature === Number(feature))
}
