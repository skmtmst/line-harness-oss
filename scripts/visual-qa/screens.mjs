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
 *   steps     撮る前の操作。`{ click: 'ボタン名' }` `{ fill: '欄名', text: '…' }` `{ wait: 800 }`
 *             **名前は一部だけでよい**（言葉の一部で探す）。長く書くと、
 *             読み上げ名の空白の入り方が違うだけで当たらなくなる。
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

/**
 * 受信箱の時計。「1時間12分待ち」を出すため、設計の最終受信に合わせて止める。
 * 止めないと待ち時間が伸び続け、日をまたぐたびに絵が変わる。
 */
const INBOX_CLOCK = '2026-08-19T11:00:00.000Z'

/** 友だちは一覧。3-2 重複検出・3-3 統合ユーザーは同じ画面のタブ。 */
const FRIENDS = { feature: 3, dir: 'friends-v6', route: '/friends', mode: 'page' }

/** シナリオ配信。編集は `?id=` 付きで開く。 */
const SCENARIO = { feature: 5, dir: 'scenarios-v6', mode: 'page' }
const EDIT = '/scenarios/detail?id=scenario-0'

/** 一斉配信。作成は `/broadcasts/new`、結果は `/broadcasts/detail?id=`。 */
const BROADCAST = { feature: 6, dir: 'broadcasts-v6', mode: 'page' }
const NEW_BC = '/broadcasts/new'

/** リマインダ。作成は `/reminders/new`、編集は `/reminders/edit?id=`。 */
const REMINDER = { feature: 7, dir: 'reminders-v6', mode: 'page' }

/** 自動応答。作る・直すは一覧の上に出る窓（`/auto-replies/edit?id=` でも開ける）。 */
const AUTO_REPLY = { feature: 8, dir: 'auto-replies-v6', route: '/auto-replies', mode: 'page' }

/** 友だち追加時の配信。実装は**アカウントに1枚**の設定画面。 */
const FRIEND_ADD = { feature: 9, dir: 'friend-add-v6', route: '/friend-add-settings', mode: 'page' }

/** ウェビナー。編集は4つのタブ（いつ見られるようにするか／途中に出すもの／コメント演出／概要・分析）。 */
const WEBINAR = { feature: 10, dir: 'webinars-v6', route: '/webinars', mode: 'page' }
const WEBINAR_EDIT = '/webinars/edit?id=webinar-1'

/** テンプレート。上のタブで種類を切り替える（メッセージ／カルーセル／…）。 */
const TEMPLATE = { feature: 11, dir: 'templates-v6', route: '/templates', mode: 'page' }

/** リッチメニュー。作成・編集は1枚もので、設計の3段には分かれていない。 */
const RICH_MENU = { feature: 12, dir: 'rich-menus-v6', route: '/rich-menus', mode: 'page' }
const RM_EDIT = '/rich-menus/edit?id=rmg-1'

/** 回答フォーム。一覧と回答が同じ画面。編集は `/form-submissions/edit?id=`。 */
const FORM = { feature: 13, dir: 'forms-v6', route: '/form-submissions', mode: 'page' }
const FORM_EDIT = '/form-submissions/edit?id=form-1'

/** 共通情報。差し込みの中身を1か所で持つ。 */
const COMMON_VAR = { feature: 14, dir: 'common-vars-v6', route: '/contents/vars', mode: 'page' }

/** 登録メディア。詳細は札の中で開く（別ルートではない）。 */
const MEDIA = { feature: 15, dir: 'media-v6', route: '/contents', mode: 'page' }

/** 成果とアフィリエイト。`/conversions?tab=` の5タブに寄せてある。 */
const AFFILIATE = { feature: 16, dir: 'affiliates-v6', mode: 'page' }

/** マイル・行動スコア。実装は `/scoring` の1枚もので、設計の5タブは無い。 */
const MILEAGE = { feature: 17, dir: 'mileage-v6', route: '/scoring', mode: 'page' }

/** 流入と計測。`/inflow-links?tab=` の3タブ（流入経路／サイトスクリプト／広告連携）。 */
const INFLOW = { feature: 18, dir: 'inflow-v6', mode: 'page' }

/** コンバージョン。成果地点とレポートは `/conversions?tab=` の2タブ。 */
const CONVERSION = { feature: 19, dir: 'conversions-v6', mode: 'page' }

/** 分析。`/analytics?tab=` の5タブ（送信数／ファネル／クロス集計／URLクリック／GA）。 */
const ANALYTICS = { feature: 20, dir: 'analytics-v6', mode: 'page' }

/** 受信箱は全画面3カラム。設計はどれも 1920x1840。 */
const INBOX = { feature: 2, dir: 'inbox-v6', route: '/chats', clock: INBOX_CLOCK, mode: 'viewport', height: 1840 }

/** 会話を1本選んでから撮る。設計はどれも「Kenta Kawano (Obama)」を開いた状態。 */
const OPEN_CHAT = [{ click: 'Kenta Kawano (Obama)', after: 1200 }]

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

  // ── 機能2 受信箱 ────────────────────────────────────────
  { ...INBOX, node: 'xGLVe', name: '2-1 受信箱', steps: OPEN_CHAT },
  {
    ...INBOX, node: 'NfgOs', name: '2-2 テンプレート選択',
    steps: [...OPEN_CHAT, { click: '▧ テンプレートを選択' }],
  },
  {
    ...INBOX, node: 'H3lAOB', name: '2-3 顧客情報パネル非表示',
    steps: [...OPEN_CHAT, { click: '顧客情報を閉じる' }],
  },
  {
    ...INBOX, node: 'Xi4x9', name: '2-4 右パネル表示設定',
    steps: [...OPEN_CHAT, { click: '表示項目' }],
  },
  // 未読の会話が並んだ状態。開かずにそのまま撮る。
  { ...INBOX, node: 'f0zn6', name: '2-5 新着・担当者別未読' },
  {
    ...INBOX, node: 'NWbuF', name: '2-6 テンプレート・全フォルダ展開',
    steps: [...OPEN_CHAT, { click: '▧ テンプレートを選択' }, { click: 'フォルダ' }],
  },
  {
    ...INBOX, node: 'B7CER8', name: '2-7 内部メモ入力',
    steps: [...OPEN_CHAT, { click: '内部メモ' }],
  },
  /*
    2-8 / 2-9 / 2-10 は「プルダウンを開いた状態」。素のセレクトのままだと
    開いた中身がブラウザ任せで**画像に写らない**ので、専用の部品へ替えた
    （`components/chats/inbox-dropdown.tsx`）。
    2-8 は一覧の絞り込み、2-9 は会話の見出し、2-10 は対応マーク。
  */
  {
    ...INBOX, node: 'YZaDK', name: '2-8 担当者プルダウンを開く',
    steps: [{ click: '担当者で絞り込む' }],
  },
  {
    ...INBOX, node: 'L35UOV', name: '2-9 担当者変更を開く',
    steps: [...OPEN_CHAT, { click: '担当者を変える' }],
  },
  {
    ...INBOX, node: 'IYjvu', name: '2-10 対応マーク変更を開く',
    steps: [...OPEN_CHAT, { click: '対応マークを変える' }],
  },
  {
    ...INBOX, node: 'TUveA', name: '2-11 テンプレート・予約フォルダ',
    // 「予約」だけだと**分類のチップ**に当たる。フォルダの行は
    // `role="option"` で「フォルダ 予約」という名前なので、そちらを指す。
    steps: [...OPEN_CHAT, { click: '▧ テンプレートを選択' }, { click: 'フォルダ' }, { click: 'フォルダ 予約', role: 'option' }],
  },
  { ...INBOX, node: 'w72a2', name: '2-12 絞り込みを開く', steps: [{ click: '絞り込み' }] },
  { ...INBOX, node: 'ASsb3', name: '2-13 保存した検索を開く', steps: [{ click: '保存した検索' }] },
  /*
    2-14 → 2-15 → 2-16 → 2-17 は一続きの流れ。
    「この条件を保存」で `Ln4zS` のモーダルを開き、名前を入れて保存する。
    エラーは空のとき・同じ名前のときで文を変える。
  */
  {
    ...INBOX, node: 'ANgda', name: '2-14 保存した検索名を入力',
    steps: [{ click: '保存した検索' }, { click: 'この条件を保存' }],
  },
  {
    ...INBOX, node: 'tBlkL', name: '2-15 保存した検索・保存完了',
    steps: [
      { click: '保存した検索' }, { click: 'この条件を保存' },
      { fill: '検索名', text: '未対応・期限超過' }, { click: 'この条件を保存', nth: 1 },
    ],
  },
  {
    ...INBOX, node: 'AuSDY', name: '2-16 保存した検索名・未入力エラー',
    steps: [
      { click: '保存した検索' }, { click: 'この条件を保存' },
      { click: 'この条件を保存', nth: 1 },
    ],
  },
  {
    ...INBOX, node: 'LHjwD', name: '2-17 保存した検索名・重複エラー',
    steps: [
      { click: '保存した検索' }, { click: 'この条件を保存' },
      { fill: '検索名', text: 'VIPかつ未契約' }, { click: 'この条件を保存', nth: 1 },
    ],
  },

  // ── 機能3 友だち ────────────────────────────────────────
  { ...FRIENDS, node: 'PhxG6', name: '3-1 友だち' },
  {
    ...FRIENDS, node: 'LT8RS', name: '3-1-A 友だち（表示件数を開く）',
    status: 'unimplemented',
    why: '表示件数が素のセレクトで、開いた中身が画像に写らない。**タグ一覧は共通の `Select` を使っていて、同じ操作の作りが画面ごとに違う**',
  },
  {
    ...FRIENDS, node: 'Igi72', name: '3-1-B 友だち（詳細検索・14軸）',
    steps: [{ click: '詳細条件' }],
  },
  {
    ...FRIENDS, node: 'IAf7j', name: '3-1-C 友だち（一括アクション）',
    steps: [{ click: '表示中の友だちをすべて選ぶ', role: 'checkbox' }],
  },
  { ...FRIENDS, node: 'I6UAdr', name: '3-1-D 友だち詳細', route: '/friends/detail?id=friend-0' },
  {
    ...FRIENDS, node: 'bzDn6', name: '3-1-E 友だち一覧の状態（空・読込・エラー）',
    status: 'unimplemented',
    why: '口の返事を差し替えて撮る形。いまの仕組みに差し替えの手順が無い（`capture.spec.mjs` の `TAG_STATES` と同じ作りが要る）',
  },
  { ...FRIENDS, node: 'YzxU1', name: '3-2 重複検出', route: '/friends?tab=duplicates' },
  {
    ...FRIENDS, node: 'InCDe', name: '3-2-A 重複候補詳細・統合前確認',
    route: '/friends?tab=duplicates', status: 'unimplemented',
    why: '重複検出タブに「再計算」しか無く、**候補を1件ずつ開く導線が無い**。設計は統合前の確認まで見せる',
  },
  { ...FRIENDS, node: 'r7eSi', name: '3-3 統合ユーザー', route: '/friends?tab=merged' },
  {
    ...FRIENDS, node: 'w8W4Eh', name: '3-3-A 統合ユーザー詳細',
    route: '/friends?tab=merged', status: 'unimplemented',
    why: '統合ユーザーの行を開く導線が無い（再計算とページ送りだけ）',
  },
  {
    ...FRIENDS, node: 'vtBCu', name: '3-4 UID移行', route: '/accounts?tab=migration',
    status: 'unimplemented',
    why: '`/accounts` を開くと `/hq` へ飛ばされる。画面確認アカウントの権限では入れない。権限の切り分けが要る',
  },

  // ── 機能5 シナリオ配信 ──────────────────────────────────
  { ...SCENARIO, node: 'TC1b1', name: '5-1 シナリオ配信', route: '/scenarios' },
  { ...SCENARIO, node: 'cCB7r', name: '5-1-A シナリオ作成・配信方式', route: '/scenarios/mode?id=scenario-0' },
  { ...SCENARIO, node: 'kk8dz', name: '5-1-B シナリオ作成・1通目設定', route: '/scenarios/first-step?id=scenario-0' },
  { ...SCENARIO, node: 'bV5Vs', name: '5-1-C シナリオ編集', route: EDIT },
  {
    ...SCENARIO, node: 'xfYLn', name: '5-1-D シナリオ・ステップ編集', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: '編集' }],
  },
  {
    ...SCENARIO, node: 'r6Gzsu', name: '5-1-E シナリオ・配信条件を開く', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: '条件なし' }],
  },
  {
    ...SCENARIO, node: 'hz9ti', name: '5-1-F シナリオ・送信後アクションを開く', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: 'アクション' }],
  },
  {
    ...SCENARIO, node: 'dqFft', name: '5-1-G シナリオ・ステップ削除確認', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: 'この通を削除する' }],
  },
  {
    ...SCENARIO, node: 'EvVO5', name: '5-1-H シナリオ・開始条件を開く', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: '変更' }],
  },
  {
    ...SCENARIO, node: 'RUxNf', name: '5-1-I シナリオ・配信開始確認', route: EDIT,
    status: 'unimplemented',
    why: '編集画面に「配信を開始」が無い。状態は一覧の再開／停止で変えるだけで、**開始前の確認が挟まらない**',
  },
  {
    ...SCENARIO, node: 'NrBkW', name: '5-1-J シナリオ・配信開始完了', route: EDIT,
    status: 'unimplemented', why: '5-1-I（開始の確認）が無いため、その先も無い',
  },
  {
    ...SCENARIO, node: 'g2UNV', name: '5-1-K シナリオ・テスト送信', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: '一括テスト送信', nth: 1 }],
  },
  {
    ...SCENARIO, node: 'M2b2B', name: '5-1-L シナリオ・配信結果', route: EDIT,
    status: 'unimplemented', why: '配信結果を開く導線が未確認',
  },
  {
    ...SCENARIO, node: 'q5G45', name: '5-1-M 一覧の状態（空・読込・エラー）', route: '/scenarios',
    status: 'unimplemented',
    why: '口の返事を差し替えて撮る形。いまの仕組みに差し替えの手順が無い',
  },

  // ── 機能6 一斉配信 ──────────────────────────────────────
  { ...BROADCAST, node: 'q76C35', name: '6-1 一斉配信', route: '/broadcasts' },
  { ...BROADCAST, node: 'zZ9fA', name: '6-1-A 一斉配信を作成', route: NEW_BC },
  {
    ...BROADCAST, node: 'cPk8A', name: '6-1-B 対象条件', route: NEW_BC,
    status: 'unconfirmed',
    why: '「保存した条件から選ぶ」は在るが**押せない（無効のまま）**。先に対象の選び方を決める必要がありそう。実装が無いのか、順番の問題かは未確認',
  },
  { ...BROADCAST, node: 'XQfMD', name: '6-1-C メッセージ編集', route: NEW_BC },
  {
    ...BROADCAST, node: 'p97Tf', name: '6-1-D テンプレート選択', route: NEW_BC,
    mode: 'viewport', height: 1080, steps: [{ click: 'テンプレートから選ぶ' }],
  },
  {
    ...BROADCAST, node: 'Bw0zt', name: '6-1-E 送信設定', route: NEW_BC,
    mode: 'viewport', height: 1136, steps: [{ click: '日時を指定して予約' }],
  },
  {
    ...BROADCAST, node: 'h0kahp', name: '6-1-F テスト送信', route: NEW_BC,
    mode: 'viewport', height: 1080, steps: [{ click: 'テスト送信' }],
  },
  {
    ...BROADCAST, node: 'vW4Es', name: '6-1-G 配信前チェック', route: NEW_BC,
    status: 'unconfirmed',
    why: '「配信前チェック」が見つからない。本文と送信設定を埋めてから出るのかもしれない。未確認',
  },
  {
    ...BROADCAST, node: 'FpgxH', name: '6-1-H 最終確認', route: NEW_BC,
    status: 'unconfirmed',
    why: '「確認」が見つからない。6-1-G のあとに出るのかもしれない。未確認',
  },
  {
    ...BROADCAST, node: 'bPF0s', name: '6-1-I 予約完了', route: NEW_BC,
    status: 'unconfirmed', why: '6-1-H（最終確認）が出せてから確かめる',
  },
  { ...BROADCAST, node: 'u6gHt', name: '6-1-J 結果詳細', route: '/broadcasts/detail?id=broadcast-2' },
  {
    ...BROADCAST, node: 'EGMb1', name: '6-1-K 削除確認', route: '/broadcasts',
    mode: 'viewport', height: 1080, steps: [{ click: '削除' }],
  },
  {
    ...BROADCAST, node: 'sqFXf', name: '6-1-L 対象条件を編集', route: NEW_BC,
    status: 'unconfirmed',
    why: '「この条件を保存」は在るが**押せない（無効のまま）**。条件を組んでからでないと押せないと思われる。未確認',
  },
  {
    ...BROADCAST, node: 'xkRDb', name: '6-1-M フォルダ操作', route: '/broadcasts',
    mode: 'viewport', height: 1080, steps: [{ click: 'フォルダを追加' }],
  },
  {
    ...BROADCAST, node: 'TmHjF', name: '6-1-N 一覧の状態（空・読込・エラー）', route: '/broadcasts',
    status: 'unimplemented', why: '口の返事を差し替えて撮る形。いまの仕組みに差し替えの手順が無い',
  },

  // ── 機能7 リマインダ ────────────────────────────────────
  /*
    設計は5段の作成ウィザード（基本設定→対象者→通知ステップ→送信設定→確認）。
    実装は `/reminders/new` の1枚もので、段の縦帯も右の「設定内容」も無い。
    **段ごとの画面が無いので、設計の A〜G は1枚ずつには対応しない。**
  */
  { ...REMINDER, node: 'M1EXwB', name: '7-1 リマインダ', route: '/reminders' },
  { ...REMINDER, node: 'uJP22', name: '7-1-A リマインダを作成', route: '/reminders/new' },
  {
    ...REMINDER, node: 'J64xI', name: '7-1-B 通知ステップ編集',
    route: '/reminders/edit?id=reminder-3',
  },
  {
    ...REMINDER, node: 's7T2dz', name: '7-1-C 対象と終了条件', route: '/reminders/new',
    status: 'unimplemented',
    why: '「終了・停止条件」（予約取消で即時停止・対応完了で残りを停止 など）が実装に無い。`grep 停止条件|終了条件` が `/reminders` 配下で0件',
  },
  {
    ...REMINDER, node: 'JCz6J', name: '7-1-D 配信予定プレビュー', route: '/reminders/new',
    status: 'unimplemented',
    why: '送信予定を日時ごとに並べて重複を検知する画面が無い。**送る前に何通いくかを見せる場所が無い**',
  },
  {
    ...REMINDER, node: 'W98zZQ', name: '7-1-E テスト送信確認', route: '/reminders/edit?id=reminder-3',
    status: 'unimplemented',
    why: 'テスト送信は一斉配信とシナリオには在るが、リマインダには無い（`grep テスト送信` が `/reminders` 配下で0件）',
  },
  {
    ...REMINDER, node: 's6Vvp', name: '7-1-F 最終確認', route: '/reminders/new',
    status: 'unimplemented', why: '有効化前チェックと最終確認の段が無い。保存すると即座に一覧へ戻る',
  },
  {
    ...REMINDER, node: 'PSmHo', name: '7-1-G 有効化完了', route: '/reminders/new',
    status: 'unimplemented', why: '7-1-F が無いので、その後の完了画面も無い',
  },
  {
    ...REMINDER, node: 'GC4St', name: '7-1-H 実行結果', route: '/reminders',
    status: 'unimplemented',
    why: 'ステップごとの送信数・開封率・エラーを出す画面が無い（`grep 実行結果|送信履歴|開封` が `/reminders` 配下で0件）',
  },
  {
    ...REMINDER, node: 'Y0Sn3', name: '7-1-I 削除確認', route: '/reminders',
    status: 'unimplemented',
    why: '削除はブラウザの `confirm()`。設計の確認ダイアログではないうえ、**撮れない**（`reminders/page.tsx:202`）',
  },
  {
    ...REMINDER, node: 'dC0yg', name: '7-1-J 一覧の状態（空・読込・エラー）', route: '/reminders',
    status: 'unimplemented', why: '口の返事を差し替えて撮る形。いまの仕組みに差し替えの手順が無い',
  },

  // ── 機能8 自動応答 ──────────────────────────────────────
  /*
    設計は5段のウィザード（基本設定→どんなときに動くか→何を返すか→優先順位→確認）。
    実装は一覧の上に出る**1枚の窓**で、段も右の「設定内容」も無い。
  */
  { ...AUTO_REPLY, node: 'cmDfJ', name: '8-1 自動応答' },
  {
    ...AUTO_REPLY, node: 'K7vg2', name: '8-1-A 自動応答ルール編集',
    route: '/auto-replies/edit?id=ar-2',
  },
  {
    ...AUTO_REPLY, node: 'nzWIX', name: '8-1-B 反応条件',
    route: '/auto-replies/edit?id=ar-2',
  },
  {
    ...AUTO_REPLY, node: 'ivDoe', name: '8-1-C 応答とアクション',
    route: '/auto-replies/edit?id=ar-2',
  },
  {
    ...AUTO_REPLY, node: 'U9hzqH', name: '8-1-D 競合と優先順位',
    status: 'unimplemented',
    why: '同じ言葉に複数のルールが当たるときの並びと止め方を見せる画面が無い。`grep 競合` が `/auto-replies` 配下で0件。**評価順の数字はあるが、重なっていることを教える場所が無い**',
  },
  {
    ...AUTO_REPLY, node: 'g46ja', name: '8-1-E 自動応答テスト',
    status: 'unimplemented',
    why: '受信を想定した言葉を入れて、どのルールが反応するかを試す画面が無い（`grep テスト` が `/auto-replies` 配下で0件）',
  },
  {
    ...AUTO_REPLY, node: 'Yj6CQ', name: '8-1-F 最終確認',
    status: 'unimplemented', why: '有効化前チェックと最終確認の段が無い。窓の「保存」で即座に反映される',
  },
  {
    ...AUTO_REPLY, node: 'e6iJG', name: '8-1-G 有効化完了',
    status: 'unimplemented', why: '8-1-F が無いので、その後の完了画面も無い',
  },
  {
    ...AUTO_REPLY, node: 't7UtYQ', name: '8-1-H 実行結果',
    status: 'unimplemented',
    why: '誰の何という入力に何が実行されたかを並べる画面が無い（`grep 実行結果|最近の実行|引継ぎ` が0件）。一覧の「当たった回数」までしか見えない',
  },
  {
    ...AUTO_REPLY, node: 'Gy9OK', name: '8-1-I 削除確認',
    status: 'unimplemented',
    why: '削除はブラウザの `confirm()`。設計の確認ダイアログではないうえ、**撮れない**（`auto-replies/page.tsx:243`）',
  },
  {
    ...AUTO_REPLY, node: 'q8wSqO', name: '8-1-J 一覧の状態（空・読込・エラー）',
    status: 'unimplemented', why: '口の返事を差し替えて撮る形。いまの仕組みに差し替えの手順が無い',
  },

  // ── 機能9 友だち追加時の配信 ────────────────────────────
  /*
    **設計と実装で、持ち物の数が違う。**
    設計は「流入リンクごとに初回案内を並べる一覧」＋5段のウィザード。
    実装は**アカウントに1枚**の設定（`FriendAddRouting`）で、
    ①はじめて追加した人 と ②以前からの友だち の2つに分けるだけ。
    流入リンクで出し分ける仕組みがそもそも無い。
  */
  { ...FRIEND_ADD, node: 'uLQQc', name: '9-1 友だち追加時の配信' },
  {
    ...FRIEND_ADD, node: 's9gAx', name: '9-1-A 基本設定',
    status: 'unimplemented',
    why: '設定名・フォルダ・優先順位が無い。**設定はアカウントに1枚**なので、名前も順番も要らない作りになっている',
  },
  {
    ...FRIEND_ADD, node: 'W1wzCa', name: '9-1-B 流入条件',
    status: 'unimplemented',
    why: '流入リンクを選ぶ仕組みが無い。画面にも「流入元の記録は友だち追加のたびに必ず走るので、ここでは選びません」と書いてある（`page.tsx:712`）',
  },
  {
    ...FRIEND_ADD, node: 'K0Dbr2', name: '9-1-C 初回案内',
    status: 'unimplemented',
    why: '最初に送る文面をここで書く場所が無い。実装は**シナリオを選ぶ**だけで、本文はシナリオ側にある',
  },
  { ...FRIEND_ADD, node: 'txMO9', name: '9-1-D アクション追加' },
  {
    ...FRIEND_ADD, node: 'U3SI5', name: '9-1-E プレビューとテスト',
    mode: 'viewport', height: 1080, steps: [{ click: 'テスト実行' }],
  },
  {
    ...FRIEND_ADD, node: 'ec9vg', name: '9-1-F 最終確認',
    status: 'unimplemented', why: '有効化前チェックと最終確認の段が無い。「保存」で即座に反映される',
  },
  {
    ...FRIEND_ADD, node: 'quhg6', name: '9-1-G 有効化完了',
    status: 'unimplemented', why: '9-1-F が無いので、その後の完了画面も無い',
  },
  {
    ...FRIEND_ADD, node: 'P2J0Te', name: '9-1-H 実行結果',
    status: 'unimplemented',
    why: '誰がどの経路から入って何が実行されたかを並べる場所が無い。受け口（`/api/friend-add-routing/events`）は在るのに**画面が読んでいない**（`grep 履歴|events` が0件）',
  },
  {
    ...FRIEND_ADD, node: 'Q3qP1r', name: '9-1-I 削除確認',
    status: 'unimplemented', why: '設定はアカウントに1枚で消せない。削除という考えがそもそも無い',
  },

  // ── 機能10 ウェビナー ───────────────────────────────────
  /*
    設計は5段のウィザード（基本設定→動画→CTA・フォーム→通知→確認）。
    実装は作成が1枚、編集が4つのタブ。**「通知・リマインド」の段だけが
    まるごと無い**（`grep リマインド|見逃し` が `/webinars` 配下で0件）。
  */
  { ...WEBINAR, node: 'ZC13r', name: '10-1 ウェビナー' },
  { ...WEBINAR, node: 'lvaY5', name: '10-1-A ウェビナーを作成', route: '/webinars/new' },
  {
    ...WEBINAR, node: 'PV1Vh', name: '10-1-B 動画・公開設定', route: WEBINAR_EDIT,
    steps: [{ click: 'いつ見られるようにするか' }],
  },
  {
    ...WEBINAR, node: 'd3rFGD', name: '10-1-C CTA・フォーム', route: WEBINAR_EDIT,
    steps: [{ click: '見ている途中に出すもの' }],
  },
  {
    ...WEBINAR, node: 'Ho8z4', name: '10-1-D 通知・リマインド',
    status: 'unimplemented',
    why: '前日・1時間前・開始時の案内も、未視聴者への見逃し案内も無い（`grep リマインド|見逃し|通知` が `/webinars` 配下で0件）',
  },
  {
    ...WEBINAR, node: 'Xjk8q', name: '10-1-E 視聴後アクション', route: WEBINAR_EDIT,
    steps: [{ click: 'いつ見られるようにするか' }],
  },
  {
    ...WEBINAR, node: 'GB0NR', name: '10-1-F 公開ページプレビュー', route: WEBINAR_EDIT,
    status: 'unconfirmed',
    why: '「プレビュー」の場所は在るが**押せない（無効のまま）**。「プレビューは準備中です」と書いてある（`edit/page.tsx:894`）',
  },
  {
    ...WEBINAR, node: 'D6yO7e', name: '10-1-G 公開前確認',
    status: 'unimplemented', why: '公開前チェックと最終確認の段が無い。「保存」で即座に反映される',
  },
  {
    ...WEBINAR, node: 'TimXl', name: '10-1-H 公開完了',
    status: 'unimplemented', why: '10-1-G が無いので、その後の完了画面も無い',
  },
  {
    ...WEBINAR, node: 'Q8sHa', name: '10-1-I 参加者管理', route: WEBINAR_EDIT,
    steps: [{ click: '概要・分析' }],
  },
  {
    ...WEBINAR, node: 'yxyzQ', name: '10-1-J 分析', route: WEBINAR_EDIT,
    steps: [{ click: '概要・分析' }],
  },
  {
    ...WEBINAR, node: 'LKuAQ', name: '10-1-K 削除確認',
    status: 'unimplemented',
    why: 'ウェビナーを消す導線がどこにも無い。受け口（`webinarApi.remove`）は在るのに**画面が一度も呼んでいない**。編集画面の「削除」はCTAの札を1枚外すもので、ウェビナー本体ではない（`edit/page.tsx:764`）',
  },
  {
    ...WEBINAR, node: 'zCQXe', name: '10-1-L 一覧の状態（空・読込・エラー）',
    status: 'unimplemented', why: '口の返事を差し替えて撮る形。いまの仕組みに差し替えの手順が無い',
  },

  // ── 機能11 テンプレート ─────────────────────────────────
  /*
    設計のタブは6本（メッセージ／カルーセル／リッチメッセージ／質問／
    クーポン／リサーチ）。実装は5本で、**「質問」だけが無い。**
  */
  { ...TEMPLATE, node: 'W7LBc', name: '11-1 テンプレート' },
  {
    ...TEMPLATE, node: 'GFlD7', name: '11-1-A メッセージを作る',
    steps: [{ click: 'テンプレートを作る' }],
  },
  {
    ...TEMPLATE, node: 'FRkls', name: '11-1-B カルーセルを作る',
    steps: [{ click: 'カルーセル' }, { click: 'カードセットを作る' }],
  },
  {
    ...TEMPLATE, node: 'NNDMR', name: '11-1-C 質問を作る',
    status: 'unimplemented',
    why: '種類のタブが5本しかなく、**「質問」だけが無い**（`page.tsx:255-283`）。設計は「質問 8」のタブを持つ',
  },
  {
    ...TEMPLATE, node: 'j9ixI', name: '11-1-D リッチメッセージを作る',
    steps: [{ click: 'リッチメッセージ' }, { click: 'リッチメッセージを作る' }],
  },
  {
    ...TEMPLATE, node: 'hsBtl', name: '11-1-E クーポンを作る',
    steps: [{ click: 'クーポン' }, { click: 'クーポンを作る' }],
  },
  {
    ...TEMPLATE, node: 'J3GxEZ', name: '11-1-F リサーチを作る',
    steps: [{ click: 'リサーチ' }, { click: 'リサーチを作る' }],
  },
  {
    ...TEMPLATE, node: 'M9cij', name: '11-1-G テンプレートの削除確認',
    status: 'unimplemented',
    why: '削除はブラウザの `confirm()`。設計の確認ダイアログではないうえ、**撮れない**（`templates/page.tsx:236`）',
  },
  {
    ...TEMPLATE, node: 'CzndJ', name: '11-1-H フォルダ操作',
    status: 'unimplemented',
    why: '「フォルダを追加」が無い。左の縦帯はテンプレートの `category` という文字から**自動で生えているだけ**で、`/api/folders` を一度も呼んでいない。作る・名前を変える・消すのどれもできない',
  },
  {
    ...TEMPLATE, node: 'NKyoA', name: '11-1-I 一覧の状態（空・読込・エラー）',
    status: 'unimplemented', why: '口の返事を差し替えて撮る形。いまの仕組みに差し替えの手順が無い',
  },

  // ── 機能12 リッチメニュー ───────────────────────────────
  /*
    設計は3段（形とボタン→誰に出すか→公開のしかた）。実装は1枚もの。
    段は無いが**中身は同じ画面に全部ある**ので、同じ絵を3つの設計と
    突き合わせる形にする。
  */
  { ...RICH_MENU, node: 'GO8RQ', name: '12-1 リッチメニュー' },
  { ...RICH_MENU, node: 'XtfO3', name: '12-1-A メニューを作る・形とボタン', route: '/rich-menus/new' },
  { ...RICH_MENU, node: 'kQ1bs', name: '12-1-B メニューを作る・誰に出すか', route: RM_EDIT },
  {
    ...RICH_MENU, node: 'DIUbO', name: '12-1-C 切替メニューのつながり', route: RM_EDIT,
    status: 'unimplemented',
    why: '「どのメニューからどこへ移れるか」を図で見せる画面が無い。**戻るタブが無いことに気づく場所が無い**（`grep つながり|切替メニュー` が0件。参照の検査は削除しようとしたときの文言だけ）',
  },
  {
    ...RICH_MENU, node: 'NXdDk', name: '12-1-C-A つながりなし', route: RM_EDIT,
    status: 'unimplemented', why: '12-1-C が無いので、その空の状態も無い',
  },
  { ...RICH_MENU, node: 'UMiJ9', name: '12-1-D メニューを作る・公開のしかた', route: RM_EDIT },
  { ...RICH_MENU, node: 'TL7tp', name: '12-1-E 管理画面の外のメニューを取り込む' },
  {
    ...RICH_MENU, node: 'szXsT', name: '12-1-F リッチメニューの削除確認',
    status: 'unimplemented',
    why: '削除はブラウザの `confirm()`。設計の確認ダイアログではないうえ、**撮れない**（`rich-menus/page.tsx:193`）',
  },
  {
    ...RICH_MENU, node: 'RW5Tb', name: '12-1-G 一覧の状態（空・読込・エラー）',
    status: 'unimplemented', why: '口の返事を差し替えて撮る形。いまの仕組みに差し替えの手順が無い',
  },

  // ── 機能13 回答フォーム ─────────────────────────────────
  /*
    設計は一覧・編集（3つのタブ）・集まった回答の3つ。実装は一覧と回答が
    同じ画面で、編集は別ルート。**「デザイン設定」は押せない状態で置いてある**
    （見た目をアプリにそろえる方針にしたため、と画面に書いてある）。
  */
  { ...FORM, node: 'EMBIK', name: '13-1 回答フォーム' },
  { ...FORM, node: 'vCqUj', name: '13-1-A フォームを作る', route: FORM_EDIT },
  {
    ...FORM, node: 'ava2n', name: '13-1-B フォームのデザイン設定', route: FORM_EDIT,
    status: 'unconfirmed',
    why: '「デザイン設定」は在るが**押せない（無効のまま）**。「見た目をこのアプリのデザインにそろえる方針にしたため、色やフォントを選ぶ画面は作っていない」と書いてある（`edit/page.tsx:377`）',
  },
  {
    ...FORM, node: 'cSqvP', name: '13-1-C フォームのオプション設定', route: FORM_EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: 'オプション設定' }],
  },
  { ...FORM, node: 'v9tYhl', name: '13-1-D 集まった回答', steps: [{ click: '来店アンケート' }] },
  {
    ...FORM, node: 'gBp2J', name: '13-1-E フォームの削除確認',
    status: 'unimplemented',
    why: '一覧に削除の導線が無い（`grep 削除|confirm` が `form-submissions/page.tsx` で0件）',
  },
  {
    ...FORM, node: 'ZOPyc', name: '13-1-F 一覧の状態（空・読込・エラー）',
    status: 'unimplemented', why: '口の返事を差し替えて撮る形。いまの仕組みに差し替えの手順が無い',
  },

  // ── 機能14 共通情報 ─────────────────────────────────────
  { ...COMMON_VAR, node: 'WuKzU', name: '14-1 共通情報' },
  { ...COMMON_VAR, node: 'gBtaK', name: '14-1-A 共通情報を編集', route: '/contents/vars/edit?id=cv-1' },
  {
    ...COMMON_VAR, node: 'uNBlA', name: '14-1-B 変える前に影響を見る',
    status: 'unimplemented',
    why: '差し込み先を1件ずつ並べて、変える前と後の文を見せる画面が無い（`grep 影響|使われて` が `/contents/vars` 配下で0件）。**文字数の上限を超える先も出ない**',
  },
  {
    ...COMMON_VAR, node: 'yPkWe', name: '14-1-C 共通情報の削除確認',
    status: 'unimplemented',
    why: '削除はブラウザの `confirm()`。設計の確認ダイアログではないうえ、**撮れない**（`contents/vars/page.tsx:150`）',
  },

  // ── 機能15 登録メディア ─────────────────────────────────
  { ...MEDIA, node: 'g89Tc', name: '15-1 登録メディア' },
  {
    ...MEDIA, node: 'voJtX', name: '15-1-A メディアの詳細と差し替え',
    mode: 'viewport', height: 1080, steps: [{ click: '夏の定番セット.jpgの使用箇所' }],
  },
  {
    /*
      設計の `eXAJP` は一覧と同じ文言。実装も**一覧の上にドロップ枠が
      常に出ている**ので、同じ絵で突き合わせる。
    */
    ...MEDIA, node: 'eXAJP', name: '15-1-B ファイルを入れる',
  },
  {
    ...MEDIA, node: 'YfTfJ', name: '15-1-C メディアの削除確認',
    status: 'unimplemented',
    why: '削除はブラウザの `confirm()`。設計の確認ダイアログではないうえ、**撮れない**（`contents/page.tsx:175`）',
  },
  {
    ...MEDIA, node: 'h8pBZr', name: '15-1-D 一覧の状態（空・読込・エラー）',
    status: 'unimplemented', why: '口の返事を差し替えて撮る形。いまの仕組みに差し替えの手順が無い',
  },

  // ── 機能16 成果とアフィリエイト ─────────────────────────
  /*
    設計のタブは4本（アフィリエイター／案件／成果承認／支払い）。
    実装は5本で、**「支払い」が無く**、代わりに「成果地点（CV）」と
    「レポート」がある。支払いの2枚（`njLGA` `GqFTV`）は行き先が無い。
  */
  { ...AFFILIATE, node: 'PouPn', name: '16-1 成果とアフィリエイト', route: '/conversions?tab=affiliates' },
  { ...AFFILIATE, node: 'GH8VL', name: '16-1-A 案件', route: '/conversions?tab=offers' },
  { ...AFFILIATE, node: 'n5VVTb', name: '16-1-B 成果承認', route: '/conversions?tab=approvals' },
  {
    ...AFFILIATE, node: 'njLGA', name: '16-1-C 支払い',
    status: 'unimplemented',
    why: '「支払い」のタブが無い。締め日・支払日・振込先・未払い残高を扱う場所がどこにも無い（`grep 振込|締め` が0件）',
  },
  { ...AFFILIATE, node: 'xqT1Z', name: '16-1-D アフィリエイターを登録する', route: '/affiliates/new' },
  {
    ...AFFILIATE, node: 'jwrbf', name: '16-1-E アフィリエイターの成果内訳',
    route: '/conversions?tab=affiliates', mode: 'viewport', height: 1136,
    /* 表の行は `onClick` だけで、押せる役を持っていない。文字で探す。 */
    steps: [{ click: '田中 明', role: 'text' }],
  },
  { ...AFFILIATE, node: 'GPWzq', name: '16-1-F 案件をつくる', route: '/affiliate-offers/new' },
  {
    ...AFFILIATE, node: 'QX70l', name: '16-1-G アフィリエイターを削除する確認',
    status: 'unimplemented',
    why: '一覧に消す導線が無い。受け口（`api.affiliates.delete`）は在るのに**画面が呼んでいない**',
  },
  {
    ...AFFILIATE, node: 'GqFTV', name: '16-1-H 支払いを確定する',
    status: 'unimplemented', why: '16-1-C（支払い）が無いので、締める操作も無い',
  },

  // ── 機能17 マイル・行動スコア ───────────────────────────
  /*
    設計は5つのタブ（友だちの残高／たまる決めごと／使い道／履歴／行動スコア）。
    実装は `/scoring` の**1枚もの**で、帯・付与ルール・ランキングの3つだけ。
    **「使い道」「履歴」「行動スコア」はまるごと無い。**
  */
  { ...MILEAGE, node: 's98Vfw', name: '17-1 マイル' },
  { ...MILEAGE, node: 'N46cQ', name: '17-1-A たまる決めごと' },
  {
    ...MILEAGE, node: 'qlVLJ', name: '17-1-B マイルの使い道',
    status: 'unimplemented',
    why: '交換できる使い道の考えがまるごと無い（`grep 使い道|交換|redemption` が `/scoring` 配下で0件）。**ためてもらう仕組みだけあって、使う先が無い**',
  },
  {
    ...MILEAGE, node: 'MvZm5', name: '17-1-C マイルの履歴',
    status: 'unimplemented',
    why: '増減の記録を並べる画面が無い。手で動かした分の理由も残らない（`grep 履歴` が0件）',
  },
  { ...MILEAGE, node: 'BmoGY', name: '17-1-D たまる決めごとをつくる', route: '/scoring/new' },
  {
    ...MILEAGE, node: 'HIU5O', name: '17-1-E 友だちのマイル明細',
    status: 'unimplemented',
    why: 'マイルの画面から友だち1人の明細へ行けない。友だち詳細（`/friends/detail`）にマイルの帯は在るが、**何でたまったかの内訳は無い**',
  },
  {
    ...MILEAGE, node: 'vz0Ji', name: '17-1-F マイルを手で増やす・減らす',
    status: 'unimplemented',
    why: '手で増減する操作が無い（`grep 手で|調整|adjust` が `/scoring` 配下で0件）。**間違って付いたマイルを直せない**',
  },
  {
    ...MILEAGE, node: 'p9CcEB', name: '17-1-G マイルの使い道をつくる',
    status: 'unimplemented', why: '17-1-B（使い道）が無いので、作る画面も無い',
  },
  {
    ...MILEAGE, node: 'k8VCU', name: '17-1-H たまる決めごと・一覧の状態',
    status: 'unimplemented', why: '口の返事を差し替えて撮る形。いまの仕組みに差し替えの手順が無い',
  },
  {
    ...MILEAGE, node: 'z3PB2', name: '17-2 行動スコア',
    status: 'unimplemented',
    why: '行動スコアがまるごと無い（`grep 行動スコア|score` が `/scoring` 配下で0件）。**サイドバーの「マイル」はマイルだけ**',
  },
  {
    ...MILEAGE, node: 's6MBc', name: '17-2-A スコアのルール', route: '/scoring/new',
    status: 'unimplemented',
    why: '`/scoring/new` は**マイルの付与ルール**を作る画面で、スコアのルールではない。17-2 が無いので行き先も無い',
  },

  // ── 機能18 流入と計測 ───────────────────────────────────
  /*
    設計のタブは4本（流入経路24／サイトスクリプト／広告連携3／広告とのつなぎ5）。
    実装は3本で、**「広告とのつなぎ」（成果を広告へ返す）が無い。**
  */
  { ...INFLOW, node: 'Q4bkTg', name: '18-1 流入と計測', route: '/inflow-links?tab=links' },
  { ...INFLOW, node: 'IhSBB', name: '18-1-A サイトスクリプト', route: '/inflow-links?tab=script' },
  { ...INFLOW, node: 'v0HaI', name: '18-1-B 広告連携', route: '/inflow-links?tab=ads' },
  { ...INFLOW, node: 'TEVk8', name: '18-1-C 流入リンクをつくる', route: '/inflow-links/new' },
  { ...INFLOW, node: 'JupxW', name: '18-1-D 流入元の詳細', route: '/inflow-links/detail?ref=summer-ig' },
  {
    ...INFLOW, node: 'UIaM7', name: '18-1-E 流入リンクの削除確認',
    status: 'unimplemented', why: '一覧に消す確認の窓が無い。削除はブラウザの `confirm()` か、詳細の中の操作',
  },
  {
    ...INFLOW, node: 'BMmxU', name: '18-1-F 一覧の状態（空・読込・エラー）',
    status: 'unimplemented', why: '口の返事を差し替えて撮る形。いまの仕組みに差し替えの手順が無い',
  },
  {
    ...INFLOW, node: 'BuVDB', name: '18-2 広告とのつなぎ（成果の対応付け）',
    status: 'unimplemented',
    why: '成果を広告へ返す仕組みが無い。fbclid・gclid などの目印と成果地点の対応付けを扱う場所が無い（タブが3本しかない）',
  },
  {
    ...INFLOW, node: 'Im2b1', name: '18-2-A 広告への送信履歴',
    status: 'unimplemented', why: '18-2 が無いので、送った・断られた・やり直した記録も無い',
  },

  // ── 機能19 コンバージョン ───────────────────────────────
  { ...CONVERSION, node: 'ZrpKn', name: '19-1 コンバージョン', route: '/conversions?tab=points' },
  { ...CONVERSION, node: 'GUxsj', name: '19-1-A コンバージョン レポート', route: '/conversions?tab=report' },
  { ...CONVERSION, node: 'GtylA', name: '19-1-B 成果地点をつくる', route: '/conversions/new' },
  {
    ...CONVERSION, node: 'd8d3Mz', name: '19-1-C 成果地点の削除確認',
    status: 'unimplemented',
    why: '削除はブラウザの `confirm()`。設計の確認ダイアログではないうえ、**撮れない**',
  },

  // ── 機能20 分析 ─────────────────────────────────────────
  /*
    設計のタブは8本（友だちの増減／配信の反応／経路と成果／使われ方／
    クロス分析／ファネル／URLクリック／保存した分析18）。
    実装は5本で、**4本が無く、代わりに「Google Analytics」がある**
    （中身は Search Console の画面）。
  */
  {
    ...ANALYTICS, node: 'Zxezb', name: '20-1 分析（友だちの増減）',
    status: 'unimplemented',
    why: '友だちの増減を日ごとに並べるタブが無い。増えた・減った・残っている割合をまとめて見る場所が無い',
  },
  { ...ANALYTICS, node: 'J6Inc', name: '20-1-A 配信の反応', route: '/analytics?tab=messages' },
  {
    ...ANALYTICS, node: 'YBGtm', name: '20-1-B 経路と成果',
    status: 'unimplemented',
    why: '経路ごとに広告費と成果を差し引きまで出すタブが無い。**赤字の経路が分からない**',
  },
  {
    ...ANALYTICS, node: 'QQ1SR', name: '20-1-C 使われ方',
    status: 'unimplemented',
    why: '作ったのに使っていないものを数えるタブが無い。片づける導線も無い',
  },
  {
    ...ANALYTICS, node: 'URqOA', name: '20-1-D 定期レポートをつくる',
    status: 'unimplemented',
    why: '決まった曜日・時刻にレポートを送る仕組みが無い（`grep 定期レポート` が0件）',
  },
  { ...ANALYTICS, node: 'f5HsX', name: '20-2 クロス分析', route: '/analytics?tab=cross' },
  { ...ANALYTICS, node: 'C2I7ry', name: '20-2-A ファネル分析', route: '/analytics?tab=funnel' },
  { ...ANALYTICS, node: 'Fh2Qj', name: '20-2-B URLクリック', route: '/analytics?tab=clicks' },
  {
    ...ANALYTICS, node: 'dfwD4', name: '20-2-C 保存した分析',
    status: 'unimplemented',
    why: '分析の条件を保存する仕組みが無い。**設計は結果までそのまま残す**（あとから軸を変えても過去の結果は書き換わらない）',
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
  xGLVe: [1920, 1840], NfgOs: [1920, 1840], H3lAOB: [1920, 1840], Xi4x9: [1920, 1840],
  f0zn6: [1920, 1840], NWbuF: [1920, 1840], B7CER8: [1920, 1840], YZaDK: [1920, 1840],
  L35UOV: [1920, 1840], IYjvu: [1920, 1840], TUveA: [1920, 1840], w72a2: [1920, 1840],
  ASsb3: [1920, 1840], ANgda: [1920, 1840], tBlkL: [1920, 1840], AuSDY: [1920, 1840],
  LHjwD: [1920, 1840],
  q76C35: [1920, 1080], zZ9fA: [1920, 1136], cPk8A: [1920, 1080], XQfMD: [1920, 1136],
  p97Tf: [1920, 1080], Bw0zt: [1920, 1136], h0kahp: [1920, 1080], vW4Es: [1920, 1080],
  FpgxH: [1920, 1080], bPF0s: [1920, 1080], u6gHt: [1920, 1080], EGMb1: [1920, 1080],
  sqFXf: [1920, 1080], xkRDb: [1920, 1080], TmHjF: [1920, 1080],
  TC1b1: [1920, 1080], cCB7r: [1920, 1080], kk8dz: [1920, 1153], bV5Vs: [1920, 1080],
  xfYLn: [1920, 1080], r6Gzsu: [1920, 1080], hz9ti: [1920, 1080], dqFft: [1920, 1080],
  EvVO5: [1920, 1080], RUxNf: [1920, 1080], NrBkW: [1920, 1080], g2UNV: [1920, 1080],
  M2b2B: [1920, 1080], q5G45: [1920, 1080],
  PhxG6: [1920, 1080], LT8RS: [1920, 1080], Igi72: [1920, 1080], IAf7j: [1920, 1107],
  I6UAdr: [1920, 1384], bzDn6: [1920, 1080], YzxU1: [1920, 1431], InCDe: [1920, 1080],
  r7eSi: [1920, 1080], w8W4Eh: [1920, 1080], vtBCu: [1920, 1080],
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
