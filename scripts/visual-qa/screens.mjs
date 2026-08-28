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
 *   states    一覧の状態を撮る。`{ apis: [口の当てはめ], kinds: ['loading','empty','error'] }`
 *             口の返事を差し替えて `<node>-<状態>-<幅>.png` を出す。
 *             **差し替えるのは一覧の口だけにしない。** 上の帯だけ前の数が残ると、
 *             「読めなかったのに件数は出ている」という起きない絵になる
 *   status    'unimplemented' … 実装が無い。**撮らない。合格にもしない**
 *             'elsewhere'     … 別の仕掛け（`capture.spec.mjs`）で撮っている。
 *                               **台帳から消さない。**消すと見ていないように見える
 *   shots     `status: 'elsewhere'` のときの、基準画像の名前（幅と `-darwin` を
 *             除いたもの）。**台帳がその絵の有無を確かめる。** 名前だけ書いて
 *             絵が無いと、見ていないものを「別の仕掛けで撮った」と数えてしまう
 *   gap       `status: 'unimplemented'` のときの片づけ方。空にしない
 *             'parts' … **既存部品で作れる。** `ConfirmDialog` `ListState`
 *                       `Select` など、もうリポジトリに在るものを当てるだけ
 *             'build' … **通常実装。** 画面を新しく作るが、**口は既に在る**
 *             'api'   … **新しいAPI・DBが要る。** 記録・集計・仕掛けが無い
 *             'drop'  … **V6から外す候補。** 作らない決めがある、または
 *                       ほかの画面に統合済み
 *             'pending' … **Codexが実装中。** 新しいPRのheadを待つ。
 *                       分けておかないと「作る話がまだ出ていない」ものと
 *                       同じ列に並び、**待っているだけなのに止まって見える**
 *   gapNote   `gap` の理由。**「無い」ではなく「何が要るか」を書く**
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

/**
 * マイル・行動スコア。
 *
 * **正本は `/mileage` に移った**（PR #441 head `5fd7c048`）。`/scoring` は
 * 恒久の転送になっている。タブは `?tab=balances` `?tab=earning-rules`。
 */
const MILEAGE = { feature: 17, dir: 'mileage-v6', route: '/mileage?tab=balances', mode: 'page' }

/** 流入と計測。`/inflow-links?tab=` の3タブ（流入経路／サイトスクリプト／広告連携）。 */
const INFLOW = { feature: 18, dir: 'inflow-v6', mode: 'page' }

/** コンバージョン。成果地点とレポートは `/conversions?tab=` の2タブ。 */
const CONVERSION = { feature: 19, dir: 'conversions-v6', mode: 'page' }

/** 分析。`/analytics?tab=` の5タブ（送信数／ファネル／クロス集計／URLクリック／GA）。 */
const ANALYTICS = { feature: 20, dir: 'analytics-v6', mode: 'page' }

/** NEN配信。タブは画面の中の状態で持つので、押して切り替える。 */
const NEN = { feature: 21, dir: 'nen-v6', route: '/nen-campaigns', mode: 'page' }

/** 写真審査。札の格子と、状態の札4本（審査待ち／採用済み／見送り／すべて）。 */
const PHOTO = { feature: 22, dir: 'photos-v6', route: '/nen-members', mode: 'page' }

/** EC連携。実装は1枚もので、設計の4タブは無い。 */
const EC = { feature: 23, dir: 'ec-v6', route: '/ec-commerce', mode: 'page' }

/** LINE通知。実装は1枚もので、種別の札6本（すべて／注文／銀行振込／…）。 */
const LINE_NOTIFY = { feature: 24, dir: 'line-notify-v6', route: '/line-notifications', mode: 'page' }

/** オートメーションと共通アクション。設計は同じタブ帯にまとめている。 */
const AUTOMATION = { feature: 25, dir: 'automations-v6', mode: 'page' }

/** 外部連携。実装は受信／送信の2タブ（外側に Webhook／未対応の通知）。 */
const WEBHOOK = { feature: 26, dir: 'webhooks-v6', route: '/webhooks', mode: 'page' }

/** 予約管理・予約設定。`/booking/bookings` `/booking/menus` `/booking/staff`。 */
const BOOKING = { feature: 27, dir: 'booking-v6', route: '/booking/bookings', mode: 'page' }

/** 予約設定。メニュー・担当スタッフはタブ、受付時間は別ルート。 */
const BOOKING_SET = { feature: 28, dir: 'booking-settings-v6', route: '/booking/menus', mode: 'page' }

/** イベント予約。一覧・作成・申込者の3ルート。 */
const EVENT = { feature: 29, dir: 'events-v6', route: '/events', mode: 'page' }

/**
 * ログインユーザー。
 * PR #475 head `15febf7f` で**タブが2本**になった（ログインユーザー／入った記録）。
 * 設計の4本のうち「招待中」「権限のかたまり」はまだ無い。
 */
const STAFF = { feature: 30, dir: 'staff-v6', route: '/staff?tab=members', mode: 'page' }

/** 機能設定。サイドメニューに出す機能を切り替える1枚。 */
const FEATURE_SET = { feature: 31, dir: 'settings-v6', route: '/settings', mode: 'page' }

/** 運用状態。`/emergency?tab=` の3タブ（健全性チェック／緊急コントロール／更新履歴）。 */
const OPERATIONS = { feature: 32, dir: 'operations-v6', mode: 'page' }

/** 受信箱は全画面3カラム。設計はどれも 1920x1840。 */
const INBOX = { feature: 2, dir: 'inbox-v6', route: '/chats', clock: INBOX_CLOCK, mode: 'viewport', height: 1840 }

/** 会話を1本選んでから撮る。設計はどれも「Kenta Kawano (Obama)」を開いた状態。 */
const OPEN_CHAT = [{ click: 'Kenta Kawano (Obama)', after: 1200 }]

export const SCREENS = [
  // ── 機能1 ダッシュボード ────────────────────────────────
  {
    node: 'vUXKb', feature: 1, name: '1-1 ダッシュボード',
    verdict: 'structure_match_data_pending', verdictNote: '構造一致 / データ未接続', verdictSource: 'dashboard-v6/design-qa.md',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
  },
  {
    node: 'ZN0ov', feature: 1, name: '1-1-1 ダッシュボード編集',
    verdict: 'structure_match_data_pending', verdictNote: '構造一致', verdictSource: 'dashboard-v6/design-qa.md',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
    steps: [{ click: 'ダッシュボード編集' }],
  },
  {
    node: 'JN6mQ', feature: 1, name: '1-1-2 友だち追加QR',
    verdict: 'structure_match_data_pending', verdictNote: '構造一致 / データ未接続', verdictSource: 'dashboard-v6/design-qa.md',
    dir: 'dashboard-v6', route: '/', mode: 'viewport', height: 1668, clock: DASHBOARD_CLOCK,
    steps: [{ click: 'QRを表示' }],
  },
  {
    node: 'NjK9q', feature: 1, name: '1-1-3 対応受信の表示件数を開く',
    verdict: 'structure_match_data_pending', verdictNote: '構造一致', verdictSource: 'dashboard-v6/design-qa.md',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
    steps: [{ click: '表示件数' }],
  },
  {
    node: 'Alekb', feature: 1, name: '1-1-4 通知パネルを開く',
    verdict: 'structure_match_data_pending', verdictNote: '構造一致 / データ未接続', verdictSource: 'dashboard-v6/design-qa.md',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
    steps: [{ click: '通知' }],
  },

  // ── 機能2 受信箱 ────────────────────────────────────────
  { ...INBOX, node: 'xGLVe', name: '2-1 受信箱', steps: OPEN_CHAT, verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'inbox-v6/design-qa.md' },
  {
    ...INBOX, node: 'NfgOs', name: '2-2 テンプレート選択',
    steps: [...OPEN_CHAT, { click: '▧ テンプレートを選択' }],
    verdict: 'needs_fix', verdictNote: 'P2 ひな形1件ごとの★（よく使うに入れる）が無い。右側の「よく使うに登録済み」札と更新日も出ない',
    verdictSource: 'inbox-v6/design-qa.md + docs/design-qa/inbox-v6/NfgOs-1920.png', verdictHead: 'a4239357',
  },
  {
    ...INBOX, node: 'H3lAOB', name: '2-3 顧客情報パネル非表示',
    steps: [...OPEN_CHAT, { click: '顧客情報を閉じる' }],
    verdict: 'needs_fix', verdictNote: 'P2 見出しの★が無い。担当と対応の並びが逆。「顧客情報を表示」が「顧客情報を開く」。一覧の日時が相対でなく絶対',
    verdictSource: 'inbox-v6/design-qa.md + docs/design-qa/inbox-v6/H3lAOB-1920.png', verdictHead: 'a4239357',
  },
  {
    ...INBOX, node: 'Xi4x9', name: '2-4 右パネル表示設定',
    steps: [...OPEN_CHAT, { click: '表示項目' }],
    verdict: 'needs_fix', verdictNote: 'P1 表示項目の中身が設計と違う（設計は対応マーク・担当者／予約・EC／内部メモ、実装はプロフィール／★つき情報／リッチメニュー／友だち情報／フォーム回答）。P2 見出しが「表示・並び順」、初期状態に戻す・完了が無い',
    verdictSource: 'inbox-v6/design-qa.md + docs/design-qa/inbox-v6/Xi4x9-1920.png', verdictHead: 'a4239357',
  },
  // 未読の会話が並んだ状態。開かずにそのまま撮る。
  { ...INBOX, node: 'f0zn6', name: '2-5 新着・担当者別未読',
    verdict: 'needs_fix', verdictNote: 'P1 「自分の未読 n」の絞り込みが無い。P2 未読が数字バッジでなく点だけ。新着行の色付けが無い',
    verdictSource: 'inbox-v6/design-qa.md + docs/design-qa/inbox-v6/f0zn6-1920.png', verdictHead: 'a4239357',
  },
  {
    ...INBOX, node: 'NWbuF', name: '2-6 テンプレート・全フォルダ展開',
    steps: [...OPEN_CHAT, { click: '▧ テンプレートを選択' }, { click: 'フォルダ' }],
    verdict: 'needs_fix', verdictNote: 'P2 フォルダ一覧に「未分類」が出ない。すべて20件のうち3件（未分類）だけ選べない',
    verdictSource: 'inbox-v6/NWbuF-1920.png', verdictHead: 'a4239357',
  },
  {
    ...INBOX, node: 'B7CER8', name: '2-7 内部メモ入力',
    steps: [...OPEN_CHAT, { click: '内部メモ' }],
    verdict: 'needs_fix', verdictNote: 'P2 設計は入力欄の上に出る「内部メモを追加」パネル（スタッフのみの札・記入例・社内限定の注記）、実装は中央のダイアログで札と注記が無い',
    verdictSource: 'inbox-v6/B7CER8-1920.png', verdictHead: 'a4239357',
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
    verdict: 'needs_fix', verdictNote: 'P2 選択肢に人のアイコンが無い。「未割当」が「未割り当て」で並びも先頭',
    verdictSource: 'inbox-v6/YZaDK-1920.png', verdictHead: 'a4239357',
  },
  {
    ...INBOX, node: 'L35UOV', name: '2-9 担当者変更を開く',
    steps: [...OPEN_CHAT, { click: '担当者を変える' }],
    verdict: 'needs_fix', verdictNote: 'P1 担当を変える窓に絞り込み用の「すべて」が混ざっている（担当者を「すべて」にはできない）。P2 顔写真の丸が無い',
    verdictSource: 'inbox-v6/L35UOV-1920.png', verdictHead: 'a4239357',
  },
  {
    ...INBOX, node: 'IYjvu', name: '2-10 対応マーク変更を開く',
    steps: [...OPEN_CHAT, { click: '対応マークを変える' }],
    verdict: 'match', verdictNote: '一致。未対応・対応中・保留・対応済の並び、色の丸、色付きの札、選択中の✓まで設計どおり',
    verdictSource: 'inbox-v6/IYjvu-1920.png', verdictHead: 'a4239357',
  },
  {
    ...INBOX, node: 'TUveA', name: '2-11 テンプレート・予約フォルダ',
    // 「予約」だけだと**分類のチップ**に当たる。フォルダの行は
    // `role="option"` で「フォルダ 予約」という名前なので、そちらを指す。
    steps: [...OPEN_CHAT, { click: '▧ テンプレートを選択' }, { click: 'フォルダ' }, { click: 'フォルダ 予約', role: 'option' }],
    verdict: 'needs_fix', verdictNote: 'P2 フォルダを予約にしても上の区分チップが「すべて」のまま。「★ 予約内のよく使う」の見出しが無い。1件ごとの★が無い',
    verdictSource: 'inbox-v6/TUveA-1920.png', verdictHead: 'a4239357',
  },
  { ...INBOX, node: 'w72a2', name: '2-12 絞り込みを開く', steps: [{ click: '絞り込み' }],
    verdict: 'needs_fix', verdictNote: 'P2 設計は420pxの浮くパネル、実装は右端の全高ドロワー。未読だけ表示がスイッチでなくチェック。期限とメッセージ種別は「まだ絞り込めません」で押せない（口が無いことを正直に出したもの。設計は押せる）',
    verdictSource: 'inbox-v6/w72a2-1920.png', verdictHead: 'a4239357',
  },
  { ...INBOX, node: 'ASsb3', name: '2-13 保存した検索を開く', steps: [{ click: '保存した検索' }],
    verdict: 'needs_fix', verdictNote: 'P1 保存した検索の中身（対応マーク・期限などの条件）と件数が出ず、名前だけ並ぶ。P2 よく使うの★と「…」が無く、削除が赤字で直に並ぶ',
    verdictSource: 'inbox-v6/ASsb3-1920.png', verdictHead: 'a4239357',
  },
  /*
    2-14 → 2-15 → 2-16 → 2-17 は一続きの流れ。
    「この条件を保存」で `Ln4zS` のモーダルを開き、名前を入れて保存する。
    エラーは空のとき・同じ名前のときで文を変える。
  */
  {
    ...INBOX, node: 'ANgda', name: '2-14 保存した検索名を入力',
    steps: [{ click: '保存した検索' }, { click: 'この条件を保存' }],
    verdict: 'needs_fix', verdictNote: 'P1 「保存する条件」が読むだけで変えられない（設計は対応マーク・期限・受信経路・担当者の4つを選び直せる）。期限の行が無い。P2 「よく使うに追加」の切替と「件数は自動更新される」注記が無い',
    verdictSource: 'inbox-v6/ANgda-1920.png', verdictHead: 'a4239357',
  },
  {
    ...INBOX, node: 'tBlkL', name: '2-15 保存した検索・保存完了',
    steps: [
      { click: '保存した検索' }, { click: 'この条件を保存' },
      { fill: '検索名', text: '未対応・期限超過' }, { click: 'この条件を保存', nth: 1 },
    ],
    verdict: 'needs_fix', verdictNote: 'P0 保存に失敗しても「保存しました」と出る。saved-view-dialog.tsx の submit が onSave の成否を見ずに setDone(true)。失敗の文は窓の後ろのパネルに出るため、窓を開けている人には見えない',
    verdictSource: 'inbox-v6/tBlkL-1920.png + apps/web/src/components/chats/saved-view-dialog.tsx', verdictHead: 'a4239357',
  },
  {
    ...INBOX, node: 'AuSDY', name: '2-16 保存した検索名・未入力エラー',
    steps: [
      { click: '保存した検索' }, { click: 'この条件を保存' },
      { click: 'この条件を保存', nth: 1 },
    ],
    verdict: 'needs_fix', verdictNote: 'P2 設計は赤い帯の注意書きと、押せない保存ボタン。実装は入力欄の下の赤い文だけで、保存ボタンは押せるまま',
    verdictSource: 'inbox-v6/AuSDY-1920.png', verdictHead: 'a4239357',
  },
  {
    ...INBOX, node: 'LHjwD', name: '2-17 保存した検索名・重複エラー',
    steps: [
      { click: '保存した検索' }, { click: 'この条件を保存' },
      { fill: '検索名', text: 'VIPかつ未契約' }, { click: 'この条件を保存', nth: 1 },
    ],
    verdict: 'needs_fix', verdictNote: 'P2 文言が設計と違う（設計「同じ名前の保存した検索があります。別の名前を入力してください。」／実装「同じ名前の検索がすでにあります。別の名前にしてください」）。設計は赤い帯、実装は入力欄の下の文',
    verdictSource: 'inbox-v6/LHjwD-1920.png', verdictHead: 'a4239357',
  },

  // ── 機能3 友だち ────────────────────────────────────────
  { ...FRIENDS, node: 'PhxG6', name: '3-1 友だち',
    verdict: 'needs_fix', verdictNote: 'P2 担当者の顔チップ（イニシャルの丸）が無く、未割り当ての「−」も出ない。ほかは設計どおり',
    verdictSource: 'friends-v6/PhxG6-1920.png', verdictHead: '728deca0',
  },
  {
    /*
      **表示件数は入っている。** `friend-list-table.tsx` に
      `10 / 20 / 30 / 40 / 50件表示` の5つがあり、設計の並びと同じ。
      未実装から外した（最新 `codex/development` `2e438929` で確認）。

      **開いた中身は撮れません。** 素の `<select>` なので、
      開いた一覧はブラウザ（OS）が描き、画像に入らない。
      閉じた姿と、選べる5つが同じことで判定する。
      共通の `Select` に寄せれば開いた姿も残せる（P2）。
    */
    ...FRIENDS, node: 'LT8RS', name: '3-1-A 友だち（表示件数を開く）',
    verdict: 'match', verdictNote: '一致', verdictSource: 'v6-recheck-496-and-classification.md', verdictHead: '2e438929',
  },
  {
    ...FRIENDS, node: 'Igi72', name: '3-1-B 友だち（詳細検索・14軸）',
    steps: [{ click: '詳細条件' }],
    verdict: 'needs_fix', verdictNote: 'P1 OR条件が4つだけで、しかも全部押せない（設計は対応マーク・シナリオ・イベント予約・カレンダー予約・回答フォーム・最終反応日・リマインダ・個別メモ・ステータスメッセージ・友だち登録日・その他）。「表示する友だち」（表示中・非表示・ブロックした人・友だちの状態）が丸ごと無い。「保存した検索から読み込む」が無い',
    verdictSource: 'friends-v6/Igi72-1920.png', verdictHead: '728deca0',
  },
  {
    ...FRIENDS, node: 'IAf7j', name: '3-1-C 友だち（一括アクション）',
    steps: [{ click: '表示中の友だちをすべて選ぶ', role: 'checkbox' }],
    /*
      **設計の画面そのものが無い。** 設計（`IAf7j`）は「友だちを一括操作」という
      別ページで、9つの操作タイルと右側の実行内容、選択した友だちの表まで見せる。
      実装は一覧の上に「4人を選択中」の帯と「操作を選ぶ」ボタンが出るだけで、
      押すと `friends/page.tsx:274` が「複数人への一括更新APIは未接続です」と
      知らせて終わる。**撮れた絵は設計の画面ではない。**
    */
    status: 'unimplemented',
    gap: 'api', gapNote: '複数人へまとめて タグ・シナリオ・担当者・対応マーク・リマインダ・メッセージ を反映する口が無い。画面も別ページとして作る必要がある',
    why: '一覧での選択までしか無く、一括操作のページが無い',
  },
  { ...FRIENDS, node: 'I6UAdr', name: '3-1-D 友だち詳細', route: '/friends/detail?id=friend-0',
    verdict: 'needs_fix', verdictNote: 'P1 画面の作りが設計と大きく違う。見出しが友だちの名前でなく「友だち詳細」。タブが概要・履歴・友だち情報・回答フォーム・配信/シナリオ・予約・リマインダ・アクション・マイル・リッチメニューでなく、タイムライン・健康記録ほか。概要の「進行中の配信・自動処理」「同じ人としてつながる情報」「最近の履歴」「この友だちに行う操作」が無い',
    verdictSource: 'friends-v6/I6UAdr-1920.png', verdictHead: '728deca0',
  },
  {
    ...FRIENDS, node: 'bzDn6', name: '3-1-E 友だち一覧の状態（空・読込・エラー）',
    /*
      **前の当てはめは `/api/friends/stats` に当たっていなかった。**
      Playwright の `*` は `/` をまたがないので、末尾が `friends*` だと
      `friends/stats` に届かない。当たらないまま撮ると、一覧が読めていないのに
      上のカードだけ前の数（214人）が残り、**起きない絵**になる。実際にそうなった。
    */
    states: { apis: ['**/api/friends?**', '**/api/friends/stats*'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: 'P1 失敗のときに赤い帯と同時に「条件に合う友だちが見つかりません」を出し、「友だち一覧 0件」と数える。未取得と0件を区別していない',
    verdictSource: 'friends-v6/bzDn6-error-1920.png', verdictHead: '728deca0',
  },
  { ...FRIENDS, node: 'YzxU1', name: '3-2 重複検出', route: '/friends?tab=duplicates',
    verdict: 'needs_fix', verdictNote: 'P1 重複候補の一覧（候補・確信度・一致した根拠・所属アカウント・状態・確認ボタン）が丸ごと無い。アカウント間の重複マトリックスも無い。KPIの名前と粒度が設計と違う（設計は重複候補・確認済み・重複配信の削減・1配信あたりの無駄・根拠不足）。絞り込みと判定ルールが無い',
    verdictSource: 'friends-v6/YzxU1-1920.png', verdictHead: '728deca0',
  },
  {
    ...FRIENDS, node: 'InCDe', name: '3-2-A 重複候補詳細・統合前確認',
    route: '/friends?tab=duplicates', gap: 'build',
    gapNote: '重複の口は在る。候補を1件ずつ開く導線が無い',
    status: 'unimplemented',
    why: '重複検出タブに「再計算」しか無く、**候補を1件ずつ開く導線が無い**。設計は統合前の確認まで見せる',
  },
  { ...FRIENDS, node: 'r7eSi', name: '3-3 統合ユーザー', route: '/friends?tab=merged',
    verdict: 'needs_fix', verdictNote: 'P1 統合ユーザーの列（UID・最終接触・重複配信・詳細を見る）が無く、代わりに内部の識別子「identity-0」が出ている。統合ユーザーを作成する導線が無い。KPIの名前が設計と違う',
    verdictSource: 'friends-v6/r7eSi-1920.png', verdictHead: '728deca0',
  },
  {
    ...FRIENDS, node: 'w8W4Eh', name: '3-3-A 統合ユーザー詳細',
    route: '/friends?tab=merged', gap: 'build',
    gapNote: '統合ユーザーの行を開く導線が無い',
    status: 'unimplemented',
    why: '統合ユーザーの行を開く導線が無い（再計算とページ送りだけ）',
  },
  {
    ...FRIENDS, node: 'vtBCu', name: '3-4 UID移行', route: '/accounts?tab=migration',
    gap: 'build',
    gapNote: '`/hq` 側に在る見込み。権限の切り分けを決める',
    status: 'unimplemented',
    why: '`/accounts` を開くと `/hq` へ飛ばされる。画面確認アカウントの権限では入れない。権限の切り分けが要る',
  },

  // ── 機能5 シナリオ配信 ──────────────────────────────────
  { ...SCENARIO, node: 'TC1b1', name: '5-1 シナリオ配信', route: '/scenarios',
    verdict: 'needs_fix', verdictNote: 'P1 完了率が画面の2つの数と合わない。購読中1,028人・読了済728人と出しながら完了率41%と出す（scenarios/page.tsx:234 が completed/(subscribers+completed) で割っている）。設計は71%（728/1,028）。P2 一覧に登録日の列が無い。配信方式に「経過時間（旧）」と内部の旧表記が出る。設計の緑の案内帯（作成しただけでは配信されません…）が本文の副題になっている',
    verdictSource: 'scenarios-v6/TC1b1-1920.png + apps/web/src/app/scenarios/page.tsx:234', verdictHead: '6db5ad7f',
  },
  { ...SCENARIO, node: 'cCB7r', name: '5-1-A シナリオ作成・配信方式', route: '/scenarios/mode?id=scenario-0',
    verdict: 'needs_fix', verdictNote: 'P2 設計の3段の進み表示（STEP1 シナリオ情報／STEP2 配信方式／STEP3 1通目を設定）が無い。フォルダをこの画面で選べない（設計はシナリオ情報のカードで選ぶ）。2つのカードの本文・例・チップは設計どおり',
    verdictSource: 'scenarios-v6/cCB7r-1920.png', verdictHead: '6db5ad7f',
  },
  { ...SCENARIO, node: 'kk8dz', name: '5-1-B シナリオ作成・1通目設定', route: '/scenarios/first-step?id=scenario-0',
    verdict: 'needs_fix', verdictNote: 'P2 STEP表示が無い。右側にLINEプレビューの吹き出しと設定サマリー（配信対象・配信日時・送信数・配信後）が無い。本文の字数（52 / 5,000）が出ない。種類のタブが設計の6つ（テキスト・画像・テンプレート・質問・カルーセル・その他）と違う9つ。時刻欄が「10:00 AM」と英語書式になるのは撮影側のブラウザ言語の癖で、実装の不具合ではない',
    verdictSource: 'scenarios-v6/kk8dz-1920.png', verdictHead: '6db5ad7f',
  },
  { ...SCENARIO, node: 'bV5Vs', name: '5-1-C シナリオ編集', route: EDIT,
    verdict: 'needs_fix', verdictNote: 'P1 到達率が取れないと NaN% と出る（scenario-detail-client.tsx:1510 の Math.round(stat.reachRate*100)。未取得なら—にすべき）。撮った絵のNaN%自体は当時の固定データが reachedRate という別名だったのが原因で、固定データは直した。実装側の守りは残っている。P2 一覧に配信対象の列が無く、配信後がどの行も—。設計の注意帯（作成しただけでは配信されません…）が無い',
    verdictSource: 'scenarios-v6/bV5Vs-1920.png + apps/web/src/app/scenarios/detail/scenario-detail-client.tsx:1510', verdictHead: '6db5ad7f',
  },
  {
    /*
      **`{ click: '編集' }` は設定カードの「編集」に当たっていた。**
      撮れた絵はシナリオ名・説明・フォルダ・トリガーの設定欄で、
      設計の「1通目を編集」ではない。**別の画面を並べて判定しない。**
      通の行の「編集」は設定カードの次に出るので `nth: 1` にする。
      撮り直すまで判定は入れない。
    */
    ...SCENARIO, node: 'xfYLn', name: '5-1-D シナリオ・ステップ編集', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: '編集', nth: 1 }],
  },
  {
    ...SCENARIO, node: 'r6Gzsu', name: '5-1-E シナリオ・配信条件を開く', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: '条件なし' }],
    verdict: 'needs_fix', verdictNote: 'P1 条件軸が設計と違う。設計は標準互換15軸＋この画面だけの6軸で、イベント予約・カレンダー予約・共通情報・リマインダ・その他・担当者・流入経路・配信状況・予約状況・購入履歴がある。実装は13個で、それらが無い代わりに反応状態・表示状態がある。P2 現在の条件の要約と「条件を初期化」が無く、条件1行の4つの選び欄も出ない',
    verdictSource: 'scenarios-v6/r6Gzsu-1920.png', verdictHead: '6db5ad7f',
  },
  {
    /*
      **`{ click: 'アクション' }` は「開始のきっかけ」のカードに当たっていた。**
      カードの説明が「アクションなどから開始できます」なので、通の行の
      「アクション」より先に見つかる。撮れたのは開始のきっかけの窓で、
      設計の「送信後のアクション」ではない。`nth: 1` にする。
      撮り直すまで判定は入れない。
    */
    ...SCENARIO, node: 'hz9ti', name: '5-1-F シナリオ・送信後アクションを開く', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: 'アクション', nth: 1 }],
  },
  {
    ...SCENARIO, node: 'dqFft', name: '5-1-G シナリオ・ステップ削除確認', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: 'この通を削除する' }],
    verdict: 'needs_fix', verdictNote: 'P1 通の削除の確認が、ブラウザ標準の confirm（scenario-detail-client.tsx:731「このステップを削除してもよいですか？」）。どの通を消すのか、配信対象と送信後アクションも一緒に消えること、到達済みの履歴は監査記録として残ることを言わない。設計は画面内の確認窓で3つとも書いてある。撮った絵に窓が写っていないのは、標準の窓が画像に入らないため',
    verdictSource: 'scenarios-v6/dqFft-1920.png + apps/web/src/app/scenarios/detail/scenario-detail-client.tsx:731', verdictHead: '6db5ad7f',
  },
  {
    ...SCENARIO, node: 'EvVO5', name: '5-1-H シナリオ・開始条件を開く', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: '変更' }],
    verdict: 'needs_fix', verdictNote: 'P1 設計の「シナリオの開始条件」の窓が無い。きっかけの6種類（友だち追加・タグ追加・フォーム回答・予約確定・手動開始・API/Webhook）を選ぶ面も、開始する友だちの条件も、初回のみ/毎回の選択も、一致人数の再計算（一致124人・すでに購読中8人・新規開始予定116人）も無い。実装は設定欄のトリガーのセレクト1つ',
    verdictSource: 'scenarios-v6/EvVO5-1920.png', verdictHead: '6db5ad7f',
  },
  {
    ...SCENARIO, node: 'RUxNf', name: '5-1-I シナリオ・配信開始確認', route: EDIT,
    gap: 'parts',
    gapNote: '同上',
    status: 'unimplemented',
    why: '編集画面に「配信を開始」が無い。状態は一覧の再開／停止で変えるだけで、**開始前の確認が挟まらない**',
  },
  {
    ...SCENARIO, node: 'NrBkW', name: '5-1-J シナリオ・配信開始完了', route: EDIT,
    gap: 'build',
    gapNote: '同上',
    status: 'unimplemented', why: '5-1-I（開始の確認）が無いため、その先も無い',
  },
  {
    ...SCENARIO, node: 'g2UNV', name: '5-1-K シナリオ・テスト送信', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: '一括テスト送信', nth: 1 }],
  },
  {
    /*
      **撮る支度だけ。ルートも口も、まだ決まっていません。**
      固定データは `SCENARIO_RESULTS`。共通契約
      （`ExecutionRunListItem`）に合わせてある。
      **開封率とエラー人数は `null`。** 取れないものを数で埋めない。
      実装PRの番号と head が届いたら route/states を実物から書く。
    */
    /*
      **PR #503（head `6db5ad7f`）で `/scenarios/results` が入った。**
      **新しい口は1本も足していない。** 既存の `api.scenarios.get(id)` と
      `api.scenarios.stats(id)`（`ScenarioStats`）を読むだけ。

      開封率・クリック率・失敗数は取れないので、画面もCSVも `—`。
      設計の数（82.4% など）を固定で置いていないことを確認済み。
    */
    ...SCENARIO, node: 'M2b2B', name: '5-1-L シナリオ・配信結果',
    route: '/scenarios/results?id=scenario-1',
    states: { apis: ['**/api/scenarios/*'], kinds: ['normal', 'loading', 'error'] },
    verdict: 'match', verdictNote: '一致',
    verdictSource: 'scenarios-v6/design-qa-results-503.md', verdictHead: '6db5ad7f',
  },
  {
    ...SCENARIO, node: 'q5G45', name: '5-1-M 一覧の状態（空・読込・エラー）', route: '/scenarios',
    states: { apis: ['**/api/scenarios*', '**/api/list-stats*'], kinds: ['loading', 'empty', 'error'] },
  },

  // ── 機能6 一斉配信 ──────────────────────────────────────
  { ...BROADCAST, node: 'q76C35', name: '6-1 一斉配信', route: '/broadcasts' },
  { ...BROADCAST, node: 'zZ9fA', name: '6-1-A 一斉配信を作成', route: NEW_BC },
  {
    ...BROADCAST, node: 'cPk8A', name: '6-1-B 対象条件', route: NEW_BC,
    gap: 'build',
    gapNote: '保存した検索の仕組みは #421 で入った。配信側から呼ぶだけ',
    status: 'unimplemented',
    why: '**確かめました（2026-08-28、`development` 2e438929）。順番の問題ではありません。** 「保存した条件から選ぶ」は `disabled` を直接書いてあり、`title` は「保存した条件は準備中です」（`broadcast-form.tsx:646-653`）。埋める順を変えても押せません',
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
    /*
      **確かめました（2026-08-28）。実装は在ります。**
      置き文のままだったのは、こちらの口が `POST /api/broadcasts/preflight` を
      405 で弾いていたためでした。**数えるだけで何も保存しない口**なので
      通すようにし、本文を書くと帯が埋まります
      （「2件 未確認／1,284 人に届きます／…」）。
      本文を入れないと帯が出ないので、`fill` してから撮る。
    */
    steps: [
      { fill: 'main textarea', selector: true, text: '画面確認のための本文です。よろしくお願いします。', after: 1500 },
    ],
  },
  {
    /*
      **Claude が作りました**（`codex/kenta-v6-broadcast-final-confirm`、
      #495 の head `7d890d3b` を土台）。押した瞬間に予約が確定しない
      ようにした窓。**本文と予約日時を入れないと出ない**ので、
      `steps` で埋めてから撮る。
    */
    ...BROADCAST, node: 'FpgxH', name: '6-1-H 最終確認',
    verdict: 'match', verdictNote: '一致', verdictSource: 'broadcasts-v6/design-qa-final-confirm-497.md', verdictHead: '84e5bab9',
    route: NEW_BC, mode: 'viewport', height: 1080,
    steps: [
      { fill: 'main input[placeholder^="例：8月"]', selector: true, text: '8月キャンペーンのお知らせ', after: 400 },
      { fill: 'main textarea', selector: true, text: '8月限定キャンペーンのお知らせです。詳しくはこちらをご確認ください。', after: 1600 },
      { click: '日時を指定して予約', scope: 'main' },
      { fill: 'main input[type="date"]', selector: true, text: '2026-08-27', after: 900 },
      { click: '配信を予約する', scope: 'main' },
      { wait: 900 },
    ],
  },
  {
    ...BROADCAST, node: 'bPF0s', name: '6-1-I 予約完了', route: NEW_BC,
    gap: 'build',
    gapNote: '保存の返事を受けて完了の面を出す。口は在る',
    status: 'unimplemented',
    why: '**確かめました（2026-08-28）。予約できたことを知らせる画面がありません。** 保存に成功すると `router.push(\'/broadcasts\')` で一覧へ戻るだけです（`broadcasts/new/page.tsx:55`）。何通が・いつ・誰に予約されたかは、戻った先で探すことになります',
  },
  { ...BROADCAST, node: 'u6gHt', name: '6-1-J 結果詳細', route: '/broadcasts/detail?id=broadcast-2' },
  {
    ...BROADCAST, node: 'EGMb1', name: '6-1-K 削除確認', route: '/broadcasts',
    mode: 'viewport', height: 1080, steps: [{ click: '削除' }],
  },
  {
    ...BROADCAST, node: 'sqFXf', name: '6-1-L 対象条件を編集', route: NEW_BC,
    gap: 'build',
    gapNote: '同上',
    status: 'unimplemented',
    why: '**確かめました（2026-08-28、`development` 2e438929）。条件を組んでも押せません。** 「この条件を保存」は `disabled` を直接書いてあり、`title` は「条件の保存は準備中です」（`broadcast-form.tsx:640-645`）。覚え書きも「条件の保存先が無い」',
  },
  {
    ...BROADCAST, node: 'xkRDb', name: '6-1-M フォルダ操作', route: '/broadcasts',
    mode: 'viewport', height: 1080, steps: [{ click: 'フォルダを追加' }],
  },
  {
    ...BROADCAST, node: 'TmHjF', name: '6-1-N 一覧の状態（空・読込・エラー）', route: '/broadcasts',
    states: { apis: ['**/api/broadcasts*', '**/api/list-stats*'], kinds: ['loading', 'empty', 'error'] },
  },

  // ── 機能7 リマインダ ────────────────────────────────────
  /*
    設計は5段の作成ウィザード（基本設定→対象者→通知ステップ→送信設定→確認）。
    実装は `/reminders/new` の1枚もので、段の縦帯も右の「設定内容」も無い。
    **段ごとの画面が無いので、設計の A〜G は1枚ずつには対応しない。**
  */
  { ...REMINDER, node: 'M1EXwB', name: '7-1 リマインダ', route: '/reminders', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'reminders-v6/design-qa.md' },
  { ...REMINDER, node: 'uJP22', name: '7-1-A リマインダを作成', route: '/reminders/new', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'reminders-v6/design-qa.md' },
  {
    ...REMINDER, node: 'J64xI', name: '7-1-B 通知ステップ編集',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'reminders-v6/design-qa.md',
    route: '/reminders/edit?id=reminder-3',
  },
  {
    ...REMINDER, node: 's7T2dz', name: '7-1-C 対象と終了条件', route: '/reminders/new',
    gap: 'api',
    gapNote: '終了・停止条件の保存先が要る',
    status: 'unimplemented',
    why: '「終了・停止条件」（予約取消で即時停止・対応完了で残りを停止 など）が実装に無い。`grep 停止条件|終了条件` が `/reminders` 配下で0件',
  },
  {
    ...REMINDER, node: 'JCz6J', name: '7-1-D 配信予定プレビュー', route: '/reminders/new',
    gap: 'build',
    gapNote: 'リマインダの設定から送信予定を計算して並べる',
    status: 'unimplemented',
    why: '送信予定を日時ごとに並べて重複を検知する画面が無い。**送る前に何通いくかを見せる場所が無い**',
  },
  {
    ...REMINDER, node: 'W98zZQ', name: '7-1-E テスト送信確認', route: '/reminders/edit?id=reminder-3',
    gap: 'build',
    gapNote: 'テスト送信は一斉配信とシナリオに在る。同じ形を移す',
    status: 'unimplemented',
    why: 'テスト送信は一斉配信とシナリオには在るが、リマインダには無い（`grep テスト送信` が `/reminders` 配下で0件）',
  },
  {
    ...REMINDER, node: 's6Vvp', name: '7-1-F 最終確認', route: '/reminders/new',
    gap: 'parts',
    gapNote: '同上',
    status: 'unimplemented', why: '有効化前チェックと最終確認の段が無い。保存すると即座に一覧へ戻る',
  },
  {
    ...REMINDER, node: 'PSmHo', name: '7-1-G 有効化完了', route: '/reminders/new',
    gap: 'build',
    gapNote: '同上',
    status: 'unimplemented', why: '7-1-F が無いので、その後の完了画面も無い',
  },
  {
    /*
      **PR #500（head `409f00bb`）で `/reminders/detail` が入った。**
      7機能で共通に使う `ExecutionRunListItem`（9項目）と、
      リマインダの書込台帳だけが持つ `domainStatus` の両方を返す。
      **表は1本にせず、読む口の契約でそろえる形。**
    */
    ...REMINDER, node: 'GC4St', name: '7-1-H 実行結果',
    verdict: 'needs_fix', verdictNote: 'P1×5', verdictSource: 'reminders-v6/design-qa-execution-results-500.md', verdictHead: '409f00bb',
    route: '/reminders/detail?id=reminder-1',
    states: {
      apis: ['**/api/reminders/*/runs*'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
  },
  {
    ...REMINDER, node: 'Y0Sn3', name: '7-1-I 削除確認', route: '/reminders',
    gap: 'parts',
    gapNote: '`ConfirmDialog` に替えるだけ。いまはブラウザの `confirm()`',
    status: 'unimplemented',
    why: '削除はブラウザの `confirm()`。設計の確認ダイアログではないうえ、**撮れない**（`reminders/page.tsx:202`）',
  },
  {
    ...REMINDER, node: 'dC0yg', name: '7-1-J 一覧の状態（空・読込・エラー）', route: '/reminders',
    states: { apis: ['**/api/reminders*', '**/api/list-stats*', '**/api/folders*'], kinds: ['loading', 'empty', 'error'] },
  },

  // ── 機能8 自動応答 ──────────────────────────────────────
  /*
    設計は5段のウィザード（基本設定→どんなときに動くか→何を返すか→優先順位→確認）。
    実装は一覧の上に出る**1枚の窓**で、段も右の「設定内容」も無い。
  */
  { ...AUTO_REPLY, node: 'cmDfJ', name: '8-1 自動応答', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'auto-replies-v6/design-qa.md' },
  {
    ...AUTO_REPLY, node: 'K7vg2', name: '8-1-A 自動応答ルール編集',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'auto-replies-v6/design-qa.md',
    route: '/auto-replies/edit?id=ar-2',
  },
  {
    ...AUTO_REPLY, node: 'nzWIX', name: '8-1-B 反応条件',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'auto-replies-v6/design-qa.md',
    route: '/auto-replies/edit?id=ar-2',
  },
  {
    ...AUTO_REPLY, node: 'ivDoe', name: '8-1-C 応答とアクション',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'auto-replies-v6/design-qa.md',
    route: '/auto-replies/edit?id=ar-2',
  },
  {
    ...AUTO_REPLY, node: 'U9hzqH', name: '8-1-D 競合と優先順位',
    gap: 'build',
    gapNote: '`priority` は在る。重なっているルールを出す',
    status: 'unimplemented',
    why: '同じ言葉に複数のルールが当たるときの並びと止め方を見せる画面が無い。`grep 競合` が `/auto-replies` 配下で0件。**評価順の数字はあるが、重なっていることを教える場所が無い**',
  },
  {
    ...AUTO_REPLY, node: 'g46ja', name: '8-1-E 自動応答テスト',
    gap: 'build',
    gapNote: 'ルールは在る。当てはめを画面で試すだけ',
    status: 'unimplemented',
    why: '受信を想定した言葉を入れて、どのルールが反応するかを試す画面が無い（`grep テスト` が `/auto-replies` 配下で0件）',
  },
  {
    ...AUTO_REPLY, node: 'Yj6CQ', name: '8-1-F 最終確認',
    gap: 'parts',
    gapNote: '同上',
    status: 'unimplemented', why: '有効化前チェックと最終確認の段が無い。窓の「保存」で即座に反映される',
  },
  {
    ...AUTO_REPLY, node: 'e6iJG', name: '8-1-G 有効化完了',
    gap: 'build',
    gapNote: '同上',
    status: 'unimplemented', why: '8-1-F が無いので、その後の完了画面も無い',
  },
  {
    /*
      **PR #501（head `93edbe17`）で `/auto-replies/runs` が入った。**
      口は `GET /api/auto-reply-runs?ruleId=`。1本にそろっている。

      **見送りの行がいちばん大事。** 選んだルールが条件で見送られ、
      後ろのルールが動いても、この画面は「選んだルールは何もしなかった」
      と出す（`auto-reply-runs.ts` の `effectiveDomainStatus`）。
      固定データに2行入れてある。
    */
    ...AUTO_REPLY, node: 't7UtYQ', name: '8-1-H 実行結果',
    verdict: 'match', verdictNote: '一致', verdictSource: 'auto-replies-v6/design-qa-execution-results-501.md', verdictHead: '93edbe17',
    route: '/auto-replies/runs?id=rule-a',
    states: {
      apis: ['**/api/auto-reply-runs*'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
  },
  {
    ...AUTO_REPLY, node: 'Gy9OK', name: '8-1-I 削除確認',
    gap: 'parts',
    gapNote: '同上',
    status: 'unimplemented',
    why: '削除はブラウザの `confirm()`。設計の確認ダイアログではないうえ、**撮れない**（`auto-replies/page.tsx:243`）',
  },
  {
    ...AUTO_REPLY, node: 'q8wSqO', name: '8-1-J 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/auto-replies*', '**/api/folders*'], kinds: ['loading', 'empty', 'error'] },
  },

  // ── 機能9 友だち追加時の配信 ────────────────────────────
  /*
    **設計と実装で、持ち物の数が違う。**
    設計は「流入リンクごとに初回案内を並べる一覧」＋5段のウィザード。
    実装は**アカウントに1枚**の設定（`FriendAddRouting`）で、
    ①はじめて追加した人 と ②以前からの友だち の2つに分けるだけ。
    流入リンクで出し分ける仕組みがそもそも無い。
  */
  { ...FRIEND_ADD, node: 'uLQQc', name: '9-1 友だち追加時の配信', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'friend-add-v6/design-qa.md' },
  {
    ...FRIEND_ADD, node: 's9gAx', name: '9-1-A 基本設定',
    gap: 'drop',
    gapNote: '設定はアカウントに1枚。名前もフォルダも優先順位も要らない',
    status: 'unimplemented',
    why: '設定名・フォルダ・優先順位が無い。**設定はアカウントに1枚**なので、名前も順番も要らない作りになっている',
  },
  {
    ...FRIEND_ADD, node: 'W1wzCa', name: '9-1-B 流入条件',
    gap: 'drop',
    gapNote: '実装に「流入元の記録は友だち追加のたびに必ず走るので、ここでは選びません」と明記',
    status: 'unimplemented',
    why: '流入リンクを選ぶ仕組みが無い。画面にも「流入元の記録は友だち追加のたびに必ず走るので、ここでは選びません」と書いてある（`page.tsx:712`）',
  },
  {
    ...FRIEND_ADD, node: 'K0Dbr2', name: '9-1-C 初回案内',
    gap: 'drop',
    gapNote: '最初に送る本文はシナリオ側にある。**2か所に持つと必ず食い違う**',
    status: 'unimplemented',
    why: '最初に送る文面をここで書く場所が無い。実装は**シナリオを選ぶ**だけで、本文はシナリオ側にある',
  },
  { ...FRIEND_ADD, node: 'txMO9', name: '9-1-D アクション追加', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'friend-add-v6/design-qa.md' },
  {
    ...FRIEND_ADD, node: 'U3SI5', name: '9-1-E プレビューとテスト',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'friend-add-v6/design-qa.md',
    mode: 'viewport', height: 1080, steps: [{ click: 'テスト実行' }],
  },
  {
    ...FRIEND_ADD, node: 'ec9vg', name: '9-1-F 最終確認',
    gap: 'parts',
    gapNote: '同上',
    status: 'unimplemented', why: '有効化前チェックと最終確認の段が無い。「保存」で即座に反映される',
  },
  {
    ...FRIEND_ADD, node: 'quhg6', name: '9-1-G 有効化完了',
    gap: 'build',
    gapNote: '同上',
    status: 'unimplemented', why: '9-1-F が無いので、その後の完了画面も無い',
  },
  {
    ...FRIEND_ADD, node: 'P2J0Te', name: '9-1-H 実行結果',
    gap: 'build',
    gapNote: '`/api/friend-add-routing/events` は在る。画面が読んでいない',
    status: 'unimplemented',
    why: '誰がどの経路から入って何が実行されたかを並べる場所が無い。受け口（`/api/friend-add-routing/events`）は在るのに**画面が読んでいない**（`grep 履歴|events` が0件）',
  },
  {
    ...FRIEND_ADD, node: 'Q3qP1r', name: '9-1-I 削除確認',
    gap: 'drop',
    gapNote: '設定は1枚で消せない。削除という考えがそもそも無い',
    status: 'unimplemented', why: '設定はアカウントに1枚で消せない。削除という考えがそもそも無い',
  },

  // ── 機能10 ウェビナー ───────────────────────────────────
  /*
    設計は5段のウィザード（基本設定→動画→CTA・フォーム→通知→確認）。
    実装は作成が1枚、編集が4つのタブ。**「通知・リマインド」の段だけが
    まるごと無い**（`grep リマインド|見逃し` が `/webinars` 配下で0件）。
  */
  { ...WEBINAR, node: 'ZC13r', name: '10-1 ウェビナー', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'webinars-v6/design-qa.md' },
  { ...WEBINAR, node: 'lvaY5', name: '10-1-A ウェビナーを作成', route: '/webinars/new', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'webinars-v6/design-qa.md' },
  {
    ...WEBINAR, node: 'PV1Vh', name: '10-1-B 動画・公開設定', route: WEBINAR_EDIT,
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'webinars-v6/design-qa.md',
    steps: [{ click: 'いつ見られるようにするか' }],
  },
  {
    ...WEBINAR, node: 'd3rFGD', name: '10-1-C CTA・フォーム', route: WEBINAR_EDIT,
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'webinars-v6/design-qa.md',
    steps: [{ click: '見ている途中に出すもの' }],
  },
  {
    ...WEBINAR, node: 'Ho8z4', name: '10-1-D 通知・リマインド',
    gap: 'api',
    gapNote: '前日・1時間前・開始時に走らせる仕掛けが要る',
    status: 'unimplemented',
    why: '前日・1時間前・開始時の案内も、未視聴者への見逃し案内も無い（`grep リマインド|見逃し|通知` が `/webinars` 配下で0件）',
  },
  {
    ...WEBINAR, node: 'Xjk8q', name: '10-1-E 視聴後アクション', route: WEBINAR_EDIT,
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'webinars-v6/design-qa.md',
    steps: [{ click: 'いつ見られるようにするか' }],
  },
  {
    ...WEBINAR, node: 'GB0NR', name: '10-1-F 公開ページプレビュー', route: WEBINAR_EDIT,
    gap: 'parts',
    gapNote: '`slug` は画面に出ている。公開ページを別窓で開くだけ',
    status: 'unimplemented',
    why: '**確かめました（2026-08-28）。順番の問題ではありません。**「プレビュー」は `disabled` を直接書いてあり、`title` は「プレビューは準備中です」（`webinars/edit/page.tsx:892-897`）。覚え書きも「参加画面をそのまま開く導線が無い」',
  },
  {
    ...WEBINAR, node: 'D6yO7e', name: '10-1-G 公開前確認',
    gap: 'parts',
    gapNote: '同上',
    status: 'unimplemented', why: '公開前チェックと最終確認の段が無い。「保存」で即座に反映される',
  },
  {
    ...WEBINAR, node: 'TimXl', name: '10-1-H 公開完了',
    gap: 'build',
    gapNote: '同上',
    status: 'unimplemented', why: '10-1-G が無いので、その後の完了画面も無い',
  },
  {
    ...WEBINAR, node: 'Q8sHa', name: '10-1-I 参加者管理', route: WEBINAR_EDIT,
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'webinars-v6/design-qa.md',
    steps: [{ click: '概要・分析' }],
  },
  {
    ...WEBINAR, node: 'yxyzQ', name: '10-1-J 分析', route: WEBINAR_EDIT,
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'webinars-v6/design-qa.md',
    steps: [{ click: '概要・分析' }],
  },
  {
    ...WEBINAR, node: 'LKuAQ', name: '10-1-K 削除確認',
    gap: 'parts',
    gapNote: '`webinarApi.remove` は在る。画面が呼んでいないだけ',
    status: 'unimplemented',
    why: 'ウェビナーを消す導線がどこにも無い。受け口（`webinarApi.remove`）は在るのに**画面が一度も呼んでいない**。編集画面の「削除」はCTAの札を1枚外すもので、ウェビナー本体ではない（`edit/page.tsx:764`）',
  },
  {
    ...WEBINAR, node: 'zCQXe', name: '10-1-L 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/webinars*'], kinds: ['loading', 'empty', 'error'] },
  },

  // ── 機能11 テンプレート ─────────────────────────────────
  /*
    設計のタブは6本（メッセージ／カルーセル／リッチメッセージ／質問／
    クーポン／リサーチ）。実装は5本で、**「質問」だけが無い。**
  */
  { ...TEMPLATE, node: 'W7LBc', name: '11-1 テンプレート', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'templates-v6/design-qa.md' },
  {
    ...TEMPLATE, node: 'GFlD7', name: '11-1-A メッセージを作る',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'templates-v6/design-qa.md',
    steps: [{ click: 'テンプレートを作る' }],
  },
  {
    ...TEMPLATE, node: 'FRkls', name: '11-1-B カルーセルを作る',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'templates-v6/design-qa.md',
    steps: [{ click: 'カルーセル' }, { click: 'カードセットを作る' }],
  },
  {
    ...TEMPLATE, node: 'NNDMR', name: '11-1-C 質問を作る',
    gap: 'api',
    gapNote: '「質問」の型と保存先が要る。いまの `messageType` に無い',
    status: 'unimplemented',
    why: '種類のタブが5本しかなく、**「質問」だけが無い**（`page.tsx:255-283`）。設計は「質問 8」のタブを持つ',
  },
  {
    ...TEMPLATE, node: 'j9ixI', name: '11-1-D リッチメッセージを作る',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'templates-v6/design-qa.md',
    steps: [{ click: 'リッチメッセージ' }, { click: 'リッチメッセージを作る' }],
  },
  {
    ...TEMPLATE, node: 'hsBtl', name: '11-1-E クーポンを作る',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'templates-v6/design-qa.md',
    steps: [{ click: 'クーポン' }, { click: 'クーポンを作る' }],
  },
  {
    ...TEMPLATE, node: 'J3GxEZ', name: '11-1-F リサーチを作る',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'templates-v6/design-qa.md',
    steps: [{ click: 'リサーチ' }, { click: 'リサーチを作る' }],
  },
  {
    /*
      **#433（head `51020a97`）で窓が入った。** それまでは削除がブラウザの
      `confirm()` で、撮ることもできなかった。実装側に
      `data-design-node="M9cij"` の印が付いている（`templates/page.tsx:831`）。
      使用中のテンプレートは「使用先を見る」に変わるので、
      **使っていない行の「テンプレートを削除」を押す。**
    */
    ...TEMPLATE, node: 'M9cij', name: '11-1-G テンプレートの削除確認',
    mode: 'viewport', height: 1080,
    steps: [{ click: 'テンプレートを削除', scope: 'main' }],
  },
  {
    /*
      **#493（head `62ddaebe`）でフォルダ操作が入った。** それまでは左の
      縦帯がテンプレートの `category` から自動で生えているだけで、
      `/api/folders` を一度も呼んでいなかった。いまは
      `api.folders.list('template', accountId)` を読み、
      作る・名前を変える・消す・並べ替える・移す・「よく使う」の
      切替まで通っている。
    */
    ...TEMPLATE, node: 'CzndJ', name: '11-1-H フォルダ操作',
  },
  {
    ...TEMPLATE, node: 'NKyoA', name: '11-1-I 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/templates*', '**/api/broadcast-message-assets*'], kinds: ['loading', 'empty', 'error'] },
  },

  // ── 機能12 リッチメニュー ───────────────────────────────
  /*
    設計は3段（形とボタン→誰に出すか→公開のしかた）。実装は1枚もの。
    段は無いが**中身は同じ画面に全部ある**ので、同じ絵を3つの設計と
    突き合わせる形にする。
  */
  { ...RICH_MENU, node: 'GO8RQ', name: '12-1 リッチメニュー', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'rich-menus-v6/design-qa.md' },
  { ...RICH_MENU, node: 'XtfO3', name: '12-1-A メニューを作る・形とボタン', route: '/rich-menus/new', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'rich-menus-v6/design-qa.md' },
  { ...RICH_MENU, node: 'kQ1bs', name: '12-1-B メニューを作る・誰に出すか', route: RM_EDIT, verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'rich-menus-v6/design-qa.md' },
  {
    ...RICH_MENU, node: 'DIUbO', name: '12-1-C 切替メニューのつながり', route: RM_EDIT,
    gap: 'build',
    gapNote: 'リッチメニューの `pages` `areas` は在る。移り先を図にする',
    status: 'unimplemented',
    why: '「どのメニューからどこへ移れるか」を図で見せる画面が無い。**戻るタブが無いことに気づく場所が無い**（`grep つながり|切替メニュー` が0件。参照の検査は削除しようとしたときの文言だけ）',
  },
  {
    ...RICH_MENU, node: 'NXdDk', name: '12-1-C-A つながりなし', route: RM_EDIT,
    gap: 'build',
    gapNote: '上の空の状態',
    status: 'unimplemented', why: '12-1-C が無いので、その空の状態も無い',
  },
  { ...RICH_MENU, node: 'UMiJ9', name: '12-1-D メニューを作る・公開のしかた', route: RM_EDIT, verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'rich-menus-v6/design-qa.md' },
  { ...RICH_MENU, node: 'TL7tp', name: '12-1-E 管理画面の外のメニューを取り込む', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'rich-menus-v6/design-qa.md' },
  {
    ...RICH_MENU, node: 'szXsT', name: '12-1-F リッチメニューの削除確認',
    gap: 'parts',
    gapNote: '同上',
    status: 'unimplemented',
    why: '削除はブラウザの `confirm()`。設計の確認ダイアログではないうえ、**撮れない**（`rich-menus/page.tsx:193`）',
  },
  {
    ...RICH_MENU, node: 'RW5Tb', name: '12-1-G 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/rich-menu-groups*', '**/api/folders*'], kinds: ['loading', 'empty', 'error'] },
  },

  // ── 機能13 回答フォーム ─────────────────────────────────
  /*
    設計は一覧・編集（3つのタブ）・集まった回答の3つ。実装は一覧と回答が
    同じ画面で、編集は別ルート。**「デザイン設定」は押せない状態で置いてある**
    （見た目をアプリにそろえる方針にしたため、と画面に書いてある）。
  */
  { ...FORM, node: 'EMBIK', name: '13-1 回答フォーム', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'forms-v6/design-qa.md' },
  { ...FORM, node: 'vCqUj', name: '13-1-A フォームを作る', route: FORM_EDIT, verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'forms-v6/design-qa.md' },
  {
    ...FORM, node: 'ava2n', name: '13-1-B フォームのデザイン設定', route: FORM_EDIT,
    gap: 'drop',
    gapNote: '**作らない決めが実装に明記**。「見た目をこのアプリのデザインにそろえる方針にしたため、色やフォントを選ぶ画面は作っていない」',
    status: 'unimplemented',
    why: '**確かめました（2026-08-28）。作らない決めです。** 「デザイン設定」は `disabled` を直接書いてあり（`form-submissions/edit/page.tsx:379-388`）、覚え書きに「フォームの見た目をこのアプリのデザインにそろえる方針にしたため、色やフォントを選ぶ画面は作っていない」とあります。**V6から外す候補**',
  },
  {
    ...FORM, node: 'cSqvP', name: '13-1-C フォームのオプション設定', route: FORM_EDIT,
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'forms-v6/design-qa.md',
    mode: 'viewport', height: 1080, steps: [{ click: 'オプション設定' }],
  },
  { ...FORM, node: 'v9tYhl', name: '13-1-D 集まった回答', steps: [{ click: '来店アンケート' }], verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'forms-v6/design-qa.md' },
  {
    ...FORM, node: 'gBp2J', name: '13-1-E フォームの削除確認',
    gap: 'parts',
    gapNote: '一覧に削除の導線を足し、`ConfirmDialog` を当てる',
    status: 'unimplemented',
    why: '一覧に削除の導線が無い（`grep 削除|confirm` が `form-submissions/page.tsx` で0件）',
  },
  {
    ...FORM, node: 'ZOPyc', name: '13-1-F 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/forms*'], kinds: ['loading', 'empty', 'error'] },
  },

  // ── 機能14 共通情報 ─────────────────────────────────────
  { ...COMMON_VAR, node: 'WuKzU', name: '14-1 共通情報', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'common-vars-v6/design-qa.md' },
  { ...COMMON_VAR, node: 'gBtaK', name: '14-1-A 共通情報を編集', route: '/contents/vars/edit?id=cv-1', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'common-vars-v6/design-qa.md' },
  {
    ...COMMON_VAR, node: 'uNBlA', name: '14-1-B 変える前に影響を見る',
    gap: 'api',
    gapNote: '共通情報の差し込み先を1件ずつ引く口が要る',
    status: 'unimplemented',
    why: '差し込み先を1件ずつ並べて、変える前と後の文を見せる画面が無い（`grep 影響|使われて` が `/contents/vars` 配下で0件）。**文字数の上限を超える先も出ない**',
  },
  {
    ...COMMON_VAR, node: 'yPkWe', name: '14-1-C 共通情報の削除確認',
    gap: 'parts',
    gapNote: '同上',
    status: 'unimplemented',
    why: '削除はブラウザの `confirm()`。設計の確認ダイアログではないうえ、**撮れない**（`contents/vars/page.tsx:150`）',
  },

  // ── 機能15 登録メディア ─────────────────────────────────
  { ...MEDIA, node: 'g89Tc', name: '15-1 登録メディア', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'media-v6/design-qa.md' },
  {
    ...MEDIA, node: 'voJtX', name: '15-1-A メディアの詳細と差し替え',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'media-v6/design-qa.md',
    mode: 'viewport', height: 1080, steps: [{ click: '夏の定番セット.jpgの使用箇所' }],
  },
  {
    /*
      設計の `eXAJP` は一覧と同じ文言。実装も**一覧の上にドロップ枠が
      常に出ている**ので、同じ絵で突き合わせる。
    */
    ...MEDIA, node: 'eXAJP', name: '15-1-B ファイルを入れる',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'media-v6/design-qa.md',
  },
  {
    ...MEDIA, node: 'YfTfJ', name: '15-1-C メディアの削除確認',
    gap: 'parts',
    gapNote: '同上',
    status: 'unimplemented',
    why: '削除はブラウザの `confirm()`。設計の確認ダイアログではないうえ、**撮れない**（`contents/page.tsx:175`）',
  },
  {
    ...MEDIA, node: 'h8pBZr', name: '15-1-D 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/media*'], kinds: ['loading', 'empty', 'error'] },
  },

  // ── 機能16 成果とアフィリエイト ─────────────────────────
  /*
    設計のタブは4本（アフィリエイター／案件／成果承認／支払い）。
    実装は5本で、**「支払い」が無く**、代わりに「成果地点（CV）」と
    「レポート」がある。支払いの2枚（`njLGA` `GqFTV`）は行き先が無い。
  */
  { ...AFFILIATE, node: 'PouPn', name: '16-1 成果とアフィリエイト', route: '/conversions?tab=affiliates', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'affiliates-v6/design-qa.md' },
  { ...AFFILIATE, node: 'GH8VL', name: '16-1-A 案件', route: '/conversions?tab=offers', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'affiliates-v6/design-qa.md' },
  { ...AFFILIATE, node: 'n5VVTb', name: '16-1-B 成果承認', route: '/conversions?tab=approvals', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'affiliates-v6/design-qa.md' },
  {
    ...AFFILIATE, node: 'njLGA', name: '16-1-C 支払い',
    gap: 'api',
    gapNote: '締め日・支払日・振込先・未払い残高の表が要る',
    status: 'unimplemented',
    why: '「支払い」のタブが無い。締め日・支払日・振込先・未払い残高を扱う場所がどこにも無い（`grep 振込|締め` が0件）',
  },
  { ...AFFILIATE, node: 'xqT1Z', name: '16-1-D アフィリエイターを登録する', route: '/affiliates/new', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'affiliates-v6/design-qa.md' },
  {
    ...AFFILIATE, node: 'jwrbf', name: '16-1-E アフィリエイターの成果内訳',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'affiliates-v6/design-qa.md',
    route: '/conversions?tab=affiliates', mode: 'viewport', height: 1136,
    /* 表の行は `onClick` だけで、押せる役を持っていない。文字で探す。 */
    steps: [{ click: '田中 明', role: 'text' }],
  },
  { ...AFFILIATE, node: 'GPWzq', name: '16-1-F 案件をつくる', route: '/affiliate-offers/new', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'affiliates-v6/design-qa.md' },
  {
    ...AFFILIATE, node: 'QX70l', name: '16-1-G アフィリエイターを削除する確認',
    gap: 'parts',
    gapNote: '`api.affiliates.delete` は在る。画面が呼んでいないだけ',
    status: 'unimplemented',
    why: '一覧に消す導線が無い。受け口（`api.affiliates.delete`）は在るのに**画面が呼んでいない**',
  },
  {
    ...AFFILIATE, node: 'GqFTV', name: '16-1-H 支払いを確定する',
    gap: 'api',
    gapNote: '同上（締める操作）',
    status: 'unimplemented', why: '16-1-C（支払い）が無いので、締める操作も無い',
  },

  // ── 機能17 マイル・行動スコア ───────────────────────────
  /*
    設計は5つのタブ（友だちの残高／たまる決めごと／使い道／履歴／行動スコア）。
    実装は `/scoring` の**1枚もの**で、帯・付与ルール・ランキングの3つだけ。
    **「使い道」「履歴」「行動スコア」はまるごと無い。**
  */
  { ...MILEAGE, node: 's98Vfw', name: '17-1 マイル', verdict: 'needs_fix', verdictNote: 'P2', verdictSource: 'mileage-v6/design-qa.md' },
  { ...MILEAGE, node: 'N46cQ', name: '17-1-A たまる決めごと', route: '/mileage?tab=earning-rules', verdict: 'needs_fix', verdictNote: 'P2', verdictSource: 'mileage-v6/design-qa.md' },
  {
    ...MILEAGE, node: 'qlVLJ', name: '17-1-B マイルの使い道',
    gap: 'api',
    gapNote: '交換の定義（何と何マイルで替えるか）と、引き換えの記録が要る',
    status: 'unimplemented',
    why: '交換できる使い道の考えがまるごと無い（`grep 使い道|交換|redemption` が `/scoring` 配下で0件）。**ためてもらう仕組みだけあって、使う先が無い**',
  },
  {
    /*
      **#441（head `05c5b103`）で「履歴」タブが入った。**
      それまでは残高と決めごとの2タブしか無かった。
    */
    ...MILEAGE, node: 'MvZm5', name: '17-1-C マイルの履歴',
    route: '/mileage?tab=history', mode: 'page',
  },
  { ...MILEAGE, node: 'BmoGY', name: '17-1-D たまる決めごとをつくる', route: '/mileage/earning-rules/new', verdict: 'structure_match_data_pending', verdictNote: '構造一致・データ未接続', verdictSource: 'mileage-v6/design-qa.md' },
  {
    /*
      **#441 で `/mileage/friends/detail` が入った。**
      実装側に `data-design-node="HIU5O"` の印が付いている。
    */
    ...MILEAGE, node: 'HIU5O', name: '17-1-E 友だちのマイル明細',
    route: '/mileage/friends/detail?id=friend-1', mode: 'page',
  },
  {
    /*
      **#494（head `0ca45f98`）で入った。** 友だちのマイル明細
      （`HIU5O`）の右上「マイルを手で増やす・減らす」から窓が開く。
      オーナーか管理者にしか出ない（`staff.me()` の `role` で分ける）。
      窓は `position: fixed` なので `page`（全面）では撮れない。
    */
    ...MILEAGE, node: 'vz0Ji', name: '17-1-F マイルを手で増やす・減らす',
    verdict: 'needs_fix', verdictNote: 'P1', verdictSource: 'mileage-v6/design-qa-score-495.md',
    route: '/mileage/friends/detail?id=friend-1', mode: 'viewport', height: 1080,
    steps: [{ click: 'マイルを手で増やす・減らす', scope: 'main' }],
  },
  {
    ...MILEAGE, node: 'p9CcEB', name: '17-1-G マイルの使い道をつくる',
    gap: 'api',
    gapNote: '同上',
    status: 'unimplemented', why: '17-1-B（使い道）が無いので、作る画面も無い',
  },
  {
    ...MILEAGE, node: 'k8VCU', name: '17-1-H たまる決めごと・一覧の状態',
    verdict: 'match', verdictNote: '一致', verdictSource: 'mileage-v6/design-qa.md',
    route: '/mileage?tab=earning-rules',
    states: { apis: ['**/api/mileage/rules*', '**/api/mileage/overview*'], kinds: ['loading', 'empty', 'error'] },
  },
  {
    /*
      **#495（head `7d890d3b`）でタブが入った。**
      それまでタブは3本（残高／決めごと／履歴）で、行動スコアが無かった。
    */
    ...MILEAGE, node: 'z3PB2', name: '17-2 行動スコア',
    route: '/mileage?tab=score', mode: 'page',
    states: {
      apis: ['**/api/action-scores/friends*'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
  },
  {
    /*
      **PR #496（head `4dac7986`）で `/mileage/score-rules` が入った。**
      アカウント単位・下書き・テスト・公開・停止・版番号が揃い、
      「新規API・DB拡張が必要」だった4つの理由のうち3つが解けた。
      残るのは**版履歴**（過去の版を並べて見る面）で、
      `ActionScoreRuleConfiguration` は `editableVersion` と
      `publishedVersion` の2つしか持たない。
    */
    ...MILEAGE, node: 's6MBc', name: '17-2-A スコアのルール', route: '/mileage/score-rules',
    verdict: 'needs_fix', verdictNote: 'P2（つながる先・パンくず・読む場面と直す場面の分離）', verdictSource: 'mileage-v6/design-qa-score-rules-496.md', verdictHead: '961722fc',
    states: {
      apis: ['**/api/action-scores/rules?*'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
  },

  // ── 機能18 流入と計測 ───────────────────────────────────
  /*
    設計のタブは4本（流入経路24／サイトスクリプト／広告連携3／広告とのつなぎ5）。
    実装は3本で、**「広告とのつなぎ」（成果を広告へ返す）が無い。**
  */
  { ...INFLOW, node: 'Q4bkTg', name: '18-1 流入と計測', route: '/inflow-links?tab=links', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'inflow-v6/design-qa.md' },
  { ...INFLOW, node: 'IhSBB', name: '18-1-A サイトスクリプト', route: '/inflow-links?tab=script', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'inflow-v6/design-qa.md' },
  { ...INFLOW, node: 'v0HaI', name: '18-1-B 広告連携', route: '/inflow-links?tab=ads', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'inflow-v6/design-qa.md' },
  { ...INFLOW, node: 'TEVk8', name: '18-1-C 流入リンクをつくる', route: '/inflow-links/new', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'inflow-v6/design-qa.md' },
  { ...INFLOW, node: 'JupxW', name: '18-1-D 流入元の詳細', route: '/inflow-links/detail?ref=summer-ig', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'inflow-v6/design-qa.md' },
  {
    ...INFLOW, node: 'UIaM7', name: '18-1-E 流入リンクの削除確認',
    gap: 'parts',
    gapNote: '同上',
    status: 'unimplemented', why: '一覧に消す確認の窓が無い。削除はブラウザの `confirm()` か、詳細の中の操作',
  },
  {
    ...INFLOW, node: 'BMmxU', name: '18-1-F 一覧の状態（空・読込・エラー）',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'inflow-v6/design-qa.md',
    route: '/inflow-links?tab=links',
    states: { apis: ['**/api/entry-routes*', '**/api/analytics/ref-summary*'], kinds: ['loading', 'empty', 'error'] },
  },
  /*
    **判定を改めた（PR #443 head `f372ff30`）。**
    「成果を広告へ返す仕組みが無い」と書いていたが、独立したタブが無い
    だけで、**中身は「広告連携」タブに入っている。** 返した記録も、
    クリックの種類（fbclid）も、失敗の理由も出る。
  */
  { ...INFLOW, node: 'BuVDB', name: '18-2 広告とのつなぎ（成果の対応付け）', route: '/inflow-links?tab=ads', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'inflow-v6/design-qa.md' },
  { ...INFLOW, node: 'Im2b1', name: '18-2-A 広告への送信履歴', route: '/inflow-links?tab=ads', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'inflow-v6/design-qa.md' },

  // ── 機能19 コンバージョン ───────────────────────────────
  { ...CONVERSION, node: 'ZrpKn', name: '19-1 コンバージョン', route: '/conversions?tab=points', verdict: 'needs_fix', verdictNote: 'P2', verdictSource: 'conversions-v6/design-qa.md' },
  { ...CONVERSION, node: 'GUxsj', name: '19-1-A コンバージョン レポート', route: '/conversions?tab=report', verdict: 'needs_fix', verdictNote: 'P1', verdictSource: 'conversions-v6/design-qa.md' },
  { ...CONVERSION, node: 'GtylA', name: '19-1-B 成果地点をつくる', route: '/conversions/new', verdict: 'structure_match_data_pending', verdictNote: '構造一致・データ未接続', verdictSource: 'conversions-v6/design-qa.md' },
  {
    /*
      **#444（head `ccbd0975`）で窓が入った。** それまでは削除がブラウザの
      `confirm()` で、撮ることもできなかった。実装側に
      `data-design-node="d8d3Mz"` の印まで付いている。
      窓は `position: fixed` なので `page`（全面）では撮れない。
    */
    ...CONVERSION, node: 'd8d3Mz', name: '19-1-C 成果地点の削除確認',
    route: '/conversions?tab=points', mode: 'viewport', height: 1080,
    steps: [{ click: '数えるのをやめる', scope: 'main' }],
  },

  // ── 機能20 分析 ─────────────────────────────────────────
  /*
    **判定を全面的に改めた（PR #445 head `5d5f7a5f`）。**
    タブが5本 → **設計どおりの8本**になった。友だちの増減・経路と成果・
    使われ方・保存した分析が入っている。数は `AnalyticsMetric`
    （`{value, state, reason}`）で、**未取得と実値0を型で分けている。**
  */
  { ...ANALYTICS, node: 'Zxezb', name: '20-1 分析（友だちの増減）', route: '/analytics?tab=friends', verdict: 'structure_match_data_pending', verdictNote: '構造一致・データ未接続', verdictSource: 'analytics-v6/design-qa.md' },
  { ...ANALYTICS, node: 'J6Inc', name: '20-1-A 配信の反応', route: '/analytics?tab=reactions', verdict: 'structure_match_data_pending', verdictNote: '構造一致・データ未接続', verdictSource: 'analytics-v6/design-qa.md' },
  { ...ANALYTICS, node: 'YBGtm', name: '20-1-B 経路と成果', route: '/analytics?tab=routes', verdict: 'structure_match_data_pending', verdictNote: '構造一致・データ未接続', verdictSource: 'analytics-v6/design-qa.md' },
  { ...ANALYTICS, node: 'QQ1SR', name: '20-1-C 使われ方', route: '/analytics?tab=usage', verdict: 'needs_fix', verdictNote: 'P1', verdictSource: 'analytics-v6/design-qa.md' },
  {
    ...ANALYTICS, node: 'URqOA', name: '20-1-D 定期レポートをつくる',
    gap: 'api',
    gapNote: '決まった曜日・時刻に走らせる仕掛けと、送り先の保存が要る',
    status: 'unimplemented',
    why: '決まった曜日・時刻にレポートを送る仕組みが無い（`grep 定期レポート` が `/analytics` 配下で0件。PR #445 head `5d5f7a5f` でも確かめた）',
  },
  { ...ANALYTICS, node: 'f5HsX', name: '20-2 クロス分析', route: '/analytics?tab=cross', verdict: 'structure_match_data_pending', verdictNote: '構造一致・データ未接続', verdictSource: 'analytics-v6/design-qa.md' },
  { ...ANALYTICS, node: 'C2I7ry', name: '20-2-A ファネル分析', route: '/analytics?tab=funnel', verdict: 'structure_match_data_pending', verdictNote: '構造一致・データ未接続', verdictSource: 'analytics-v6/design-qa.md' },
  { ...ANALYTICS, node: 'Fh2Qj', name: '20-2-B URLクリック', route: '/analytics?tab=url-clicks', verdict: 'structure_match_data_pending', verdictNote: '構造一致・データ未接続', verdictSource: 'analytics-v6/design-qa.md' },
  { ...ANALYTICS, node: 'dfwD4', name: '20-2-C 保存した分析', route: '/analytics?tab=saved', verdict: 'needs_fix', verdictNote: 'P1', verdictSource: 'analytics-v6/design-qa.md' },

  // ── 機能21 NEN配信 ──────────────────────────────────────
  /* タブ4本は設計とそろっている（配信フロー／NENコラム／ペット／配信履歴）。 */
  { ...NEN, node: 'VLMGH', name: '21-1 NEN配信', verdict: 'needs_fix', verdictNote: 'P1', verdictSource: 'nen-v6/design-qa.md' },
  { ...NEN, node: 'DEX0k', name: '21-1-A NENコラム', steps: [{ click: 'NENコラム' }], verdict: 'needs_fix', verdictNote: 'P1', verdictSource: 'nen-v6/design-qa.md' },
  { ...NEN, node: 'q4lajm', name: '21-1-B ペット・記念日', steps: [{ click: 'ペット・誕生日' }], verdict: 'needs_fix', verdictNote: 'P1', verdictSource: 'nen-v6/design-qa.md' },
  { ...NEN, node: 'WeXbL', name: '21-1-C NEN配信の履歴', steps: [{ click: '配信履歴' }], verdict: 'structure_match_data_pending', verdictNote: '構造一致・データ未接続', verdictSource: 'nen-v6/design-qa.md' },
  {
    ...NEN, node: 'HpKyF', name: '21-1-D NEN配信の中身を編集する',
    verdict: 'needs_fix', verdictNote: 'P1', verdictSource: 'nen-v6/design-qa.md',
    route: '/nen-campaigns/edit?key=review_request',
  },
  {
    ...NEN, node: 'ymXJK', name: '21-1-E コラムを書く',
    gap: 'api',
    gapNote: 'コラムの正本はEC側。管理画面で書くなら保存先が要る',
    status: 'unimplemented',
    why: 'コラムを新しく書く画面が無い。実装は**外から取り込んだコラムの「配信文」だけ**を直せる（`page.tsx:414`「配信文を編集」）。題名・本文・写真・分類はこちらで作れない',
  },
  {
    ...NEN, node: 'i9sQP', name: '21-1-F NENコラム・一覧の状態',
    verdict: 'structure_match_data_pending', verdictNote: '構造一致・データ未接続', verdictSource: 'nen-v6/design-qa.md',
    states: { apis: ['**/api/nen-campaigns/columns*', '**/api/nen-campaigns/overview*'], kinds: ['loading', 'empty', 'error'] },
  },

  // ── 機能22 写真審査 ─────────────────────────────────────
  { ...PHOTO, node: 'Qu6Vk', name: '22-1 写真審査', verdict: 'needs_fix', verdictNote: 'P0', verdictSource: 'photos-v6/design-qa.md' },
  {
    ...PHOTO, node: 'hHrz8', name: '22-1-A 写真を1枚ずつ見る',
    gap: 'build',
    gapNote: '写真は在る。拡大・回転・切り取りは画面側で作れる（**自動検出だけは別。下の「新規API」を参照**）',
    status: 'unimplemented',
    why: '1枚を大きく見る画面が無い。拡大・回転・切り取りも、自動で見つけたこと（人の顔・他社のロゴ・重複）も無い',
  },
  {
    /*
      **#447（head `12c80878`）で実装が入った。** それまでは「見送る」を
      押した時点で確定し、理由も残らなかった。いまは窓が開き、理由を
      5つから選んで補足を書ける。
      窓は `position: fixed` なので **`page`（全面）では撮れない**。
      設計の高さでビューポートを取る。
    */
    ...PHOTO, node: 'N2J629', name: '22-1-B 写真を戻す理由をえらぶ',
    verdict: 'structure_match_data_pending', verdictNote: '構造一致・要修正 P1', verdictSource: 'photos-v6/design-qa.md',
    mode: 'viewport', height: 1080,
    steps: [{ click: '理由を選んで見送る', scope: 'main' }],
  },
  {
    ...PHOTO, node: 'J3Wxl8', name: '22-1-C 出しているもの',
    gap: 'api',
    gapNote: '通した写真と掲載先（リッチメニュー・コラム・サイト）を結ぶ記録が要る',
    status: 'unimplemented',
    why: '通した写真をどこで使っているか（リッチメニュー・コラム・サイト）を並べるタブが無い。状態の札は4本（審査待ち／採用済み／見送り／すべて）で「出しているもの」が無い',
  },

  // ── 機能23 EC連携 ───────────────────────────────────────
  /*
    設計のタブは4本（取り込みの記録／会員のつき合わせ／定期便／つなぎ先）。
    実装は1枚もので、**取り込みの記録だけ**がある。
  */
  { ...EC, node: 'eI3gs', name: '23-1 EC連携', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'ec-v6/design-qa.md' },
  {
    ...EC, node: 'ELayY', name: '23-1-A 会員のつき合わせ',
    gap: 'build',
    gapNote: '注文は在る。`friendId` が空のものを並べて候補を出す',
    status: 'unimplemented',
    why: '結びつかなかった注文を並べて、候補と突き合わせる画面が無い。**`friendId` が空の注文が、どこにも出てこない**',
  },
  {
    ...EC, node: 'bfB50', name: '23-1-B 定期便',
    gap: 'api',
    gapNote: 'Stripe定期便本体の接続。実装に「接続後に有効化します」と明記',
    status: 'unimplemented',
    why: '定期便のタブが無い。画面に「定期便イベントは受信準備済みです。Stripe定期便本体の接続後に有効化します」と書いてある（`page.tsx:384`）',
  },
  {
    ...EC, node: 'oHAN4', name: '23-1-C EC連携のつなぎ先',
    gap: 'api',
    gapNote: 'つなぎ先と突合キーを画面から変える口が要る。実装に「口が無い」と明記',
    status: 'unimplemented',
    why: 'つなぎ先も、人を見分ける決めごとも画面から変えられない。「接続先や突合キーを画面から変える口が無い」と書いてある（`page.tsx:174`）',
  },

  // ── 機能24 LINE通知 ─────────────────────────────────────
  /*
    設計のタブは4本（顧客へのお知らせ9／運用者へのお知らせ11／
    送れなかったもの4／記録）。実装は**1枚もの**で、顧客へのお知らせだけ。
  */
  { ...LINE_NOTIFY, node: 'festr', name: '24-1 LINE通知', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'line-notify-v6/design-qa.md' },
  {
    ...LINE_NOTIFY, node: 'Q55bb', name: '24-1-A お知らせの中身を編集する',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'line-notify-v6/design-qa.md',
    mode: 'viewport', height: 1136, steps: [{ click: '発送した', role: 'text' }],
  },
  {
    /*
      **撮る支度だけ。** 固定データは `UNDELIVERED_RECORDS`。
      **届かなかった理由・メール送信の記録は置き場がありません。**
      連絡先は作り物（`example.com`）だけを置く。
    */
    ...LINE_NOTIFY, node: 'X8JCA5', name: '24-1-B 送れなかったもの',
    gap: 'api',
    gapNote: '届かなかったお知らせを残す記録が要る',
    status: 'unimplemented',
    why: '届かなかったお知らせを並べるタブが無い。**発送や返金が届いていない人を、その日のうちに別の手だてで届ける場所が無い**',
  },
  {
    /*
      **撮る支度だけ。ルートも口も、まだ決まっていません。**
      固定データは `NOTIFICATION_RECORDS`（共通契約に合わせてある）。
      **だれに送ったか・開封・クリックは、いまの `notifications` に
      置き場がありません。** そこは `null` にしてある。
    */
    ...LINE_NOTIFY, node: 'Se65i', name: '24-1-C お知らせの記録',
    gap: 'api',
    gapNote: 'いつ・だれに・どのお知らせを送ったかの記録が要る',
    status: 'unimplemented',
    why: 'いつ・だれに・どのお知らせを送ったかの記録が無い。開かれた・押されたの数も出ない',
  },
  {
    ...LINE_NOTIFY, node: 'DpxOK', name: '24-2 運用者へのお知らせ',
    gap: 'api',
    gapNote: '運用者へ知らせる仕掛けそのものが要る',
    status: 'unimplemented',
    why: 'お店の人へ知らせる仕組みが無い（`grep 運用者` が `/line-notifications` 配下で0件）',
  },
  {
    ...LINE_NOTIFY, node: 'N2gAza', name: '24-2-A 運用者へのお知らせをつくる',
    gap: 'api',
    gapNote: '同上（作る画面）',
    status: 'unimplemented', why: '24-2 が無いので、作る画面も無い',
  },

  // ── 機能25 オートメーション ─────────────────────────────
  /*
    設計のタブ帯は5本（動いているもの14／止めているもの4／動いた記録／
    見本12／共通アクション14）で、オートメーションと共通アクションが
    **同じ帯**に並ぶ。実装は `/automations` と `/common-actions` の別ページ。
  */
  { ...AUTOMATION, node: 'gief7', name: '25-1 オートメーション', route: '/automations', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'automations-v6/design-qa.md' },
  { ...AUTOMATION, node: 'Rv8Jv', name: '25-1-A オートメーションをつくる', route: '/automations/new', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'automations-v6/design-qa.md' },
  {
    /*
      **PR #502（head `75b010fc`）で `/automations/runs` が入った。**
      **新しい表は作っていない。** 既存の `automation_runs` を読むだけ。
      口は `GET /api/automation-runs`。

      「もう一度やる」は**意図して出していない。** 部分成功した処理を
      二重に実行しない安全な口が無いため（`automations.ts` に注釈あり）。
      設計にはあるので、差として記録だけしておく。
    */
    ...AUTOMATION, node: 'DkPY0', name: '25-1-B オートメーションが動いた記録',
    verdict: 'match', verdictNote: '一致', verdictSource: 'automations-v6/design-qa-execution-results-502.md', verdictHead: '75b010fc',
    route: '/automations/runs',
    states: {
      apis: ['**/api/automation-runs*'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
  },
  {
    ...AUTOMATION, node: 'WjYAC', name: '25-1-C 見本から作る',
    gap: 'build',
    gapNote: '見本は固定の組み合わせ。新しい口は要らない',
    status: 'unimplemented',
    why: '見本（よく使う組み合わせ）が無い。`grep 見本|テンプレート` が `/automations` 配下で0件',
  },
  {
    ...AUTOMATION, node: 'Vdbv5', name: '25-1-D 一覧の状態（空・読込・エラー）',
    route: '/automations',
    states: { apis: ['**/api/automations*'], kinds: ['loading', 'empty', 'error'] },
  },
  { ...AUTOMATION, node: 'xOpDs', name: '25-2 共通アクション', route: '/common-actions', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'automations-v6/design-qa.md' },
  { ...AUTOMATION, node: 'py5CG', name: '25-2-A 共通アクションをつくる', route: '/common-actions/new', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'automations-v6/design-qa.md' },
  { ...AUTOMATION, node: 'syWp4', name: '25-2-B 共通アクションの版と使われている場所', route: '/common-actions/versions?id=ca-1', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'automations-v6/design-qa.md' },

  // ── 機能26 外部連携 ─────────────────────────────────────
  /*
    設計のタブは4本（こちらから送る6／こちらで受け取る3／やり取りの記録／見本14）。
    実装は2本（受信 (Incoming)／送信 (Outgoing)）で、記録も見本も無い。
  */
  {
    ...WEBHOOK, node: 'k3WxrO', name: '26-1 外部連携',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'webhooks-v6/design-qa.md',
    steps: [{ click: '送信 (Outgoing)' }],
  },
  { ...WEBHOOK, node: 'M0Gb7', name: '26-1-A こちらで受け取る', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'webhooks-v6/design-qa.md' },
  {
    /*
      **撮る支度だけ。** 固定データは `INTEGRATION_RECORDS`。
      **つなぎ先は名前だけ。** `outgoing_webhooks` は `url` と `secret` を
      持つので、道も鍵も送った中身も、画面にも画像にも出さない。
    */
    ...WEBHOOK, node: 'KNG00', name: '26-1-B やり取りの記録',
    gap: 'api',
    gapNote: '外部連携のやり取りを残す記録と、やり直しの口が要る',
    status: 'unimplemented',
    why: '送った・受け取ったやり取りの記録が無い。**失敗したものをやり直す場所も無い**（`grep 記録|やり直す|deliveries` が `/webhooks` 配下で0件）',
  },
  {
    ...WEBHOOK, node: 'f8SBSh', name: '26-1-C 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/webhooks/**'], kinds: ['loading', 'empty', 'error'] },
  },

  // ── 機能27 予約管理 ─────────────────────────────────────
  /*
    設計は台帳（時間×担当の格子）と、電話の代理予約が4枚。
    実装は一覧＋詳細で、**「予約を追加」は押せない**
    （「管理画面から予約を代理で入れる仕組みは準備中です」`bookings/page.tsx:289`）。
  */
  { ...BOOKING, node: 'TV2DI', name: '27-1 予約管理', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'booking-v6/design-qa.md' },
  {
    ...BOOKING, node: 'TnDbq', name: '27-1-A 予約の詳細',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'booking-v6/design-qa.md',
    mode: 'viewport', height: 1136, steps: [{ click: '高橋 直人', role: 'text' }],
  },
  /*
    **判定を改めた（PR #459 head `ba0bf62d`）。** 代理予約の画面ができた
    （`/booking/bookings/new`）。ただし**LINEの友だちに限る**。
    「LINE未連携の電話客は、顧客台帳の受け皿ができるまで登録できません。」
  */
  { ...BOOKING, node: 'cpdDi', name: '27-1-B 電話の予約を入れる', route: '/booking/bookings/new' },
  { ...BOOKING, node: 'SbuUI', name: '27-1-C 今週の予約', steps: [{ click: '今週' }], verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'booking-v6/design-qa.md' },
  {
    ...BOOKING, node: 'GFDqW', name: '27-1-D 代理予約・内容確認',
    gap: 'parts',
    gapNote: '同上（代理予約）',
    status: 'unimplemented', why: '代理予約の画面はできたが、内容確認の段は無い（1枚で入力して保存する）（PR #459 head `ba0bf62d` で確かめた）',
  },
  {
    ...BOOKING, node: 'GfceK', name: '27-1-E 代理予約・登録完了',
    gap: 'build',
    gapNote: '同上（代理予約）',
    status: 'unimplemented', why: '登録したあとの完了画面が無い。保存すると一覧へ戻る（PR #459 head `ba0bf62d` で確かめた）',
  },
  {
    ...BOOKING, node: 'Lg8ff', name: '27-1-F 代理予約・予約枠の重なりと入力エラー',
    gap: 'api',
    gapNote: '予約枠の重なりを判定する口が要る',
    status: 'unimplemented', why: '枠の重なりを止める検査が無い。設計は「9/02（火）11:00 は 佐々木 がふさがっています（2件）」と出す（PR #459 head `ba0bf62d` で確かめた）',
  },

  // ── 機能28 予約設定 ─────────────────────────────────────
  /*
    設計のタブは4本（メニュー8／受付枠／休業日／予約のルール）。
    実装はメニューと担当スタッフの2タブで、受付枠と休業日は
    `/booking/staff/shifts` の別ルートにある。
  */
  { ...BOOKING_SET, node: 'QSLEH', name: '28-1 予約設定', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'booking-settings-v6/design-qa.md' },
  { ...BOOKING_SET, node: 'tksPc', name: '28-1-A 受付枠と休業日', route: '/booking/staff/shifts', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'booking-settings-v6/design-qa.md' },
  { ...BOOKING_SET, node: 'GhOb3', name: '28-1-B 予約メニューをつくる', route: '/booking/menus/new', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'booking-settings-v6/design-qa.md' },
  {
    ...BOOKING_SET, node: 'W6465r', name: '28-1-C 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/booking/admin/menus*', '**/api/booking/admin/staff*'], kinds: ['loading', 'empty', 'error'] },
  },

  // ── 機能29 イベント予約 ─────────────────────────────────
  { ...EVENT, node: 'ugP5y', name: '29-1 イベント予約', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'events-v6/design-qa.md' },
  { ...EVENT, node: 'MKrPY', name: '29-1-A イベントをつくる', route: '/events/new', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'events-v6/design-qa.md' },
  { ...EVENT, node: 'i5SN2j', name: '29-1-B 申込者の一覧', route: '/events/bookings?id=ev-1', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'events-v6/design-qa.md' },
  {
    ...EVENT, node: 'k5m5Bc', name: '29-1-C 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/events/admin/events*'], kinds: ['loading', 'empty', 'error'] },
  },

  // ── 機能30 ログインユーザー ─────────────────────────────
  /*
    設計のタブは4本（いまいる人8／招待中2／入った記録／権限のかたまり5）。
    実装は1枚もの。
  */
  { ...STAFF, node: 'e3jz3', name: '30-1 ログインユーザー', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'staff-v6/design-qa.md' },
  {
    ...STAFF, node: 'EOTS4', name: '30-1-A 見せる範囲を決める',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'staff-v6/design-qa.md',
    mode: 'viewport', height: 1080, steps: [{ click: '高田 誠', role: 'text' }],
  },
  /*
    **判定を改めた（PR #475 head `15febf7f`）。** 「入った記録」のタブができた。
    ただしタブは2本（ログインユーザー／入った記録）で、設計の4本のうち
    「招待中」「権限のかたまり」はまだ無い。
  */
  { ...STAFF, node: 'jwVlo', name: '30-1-B 入った記録', route: '/staff?tab=audit' },
  { ...STAFF, node: 'I3ZSrU', name: '30-1-C 人を招待する', route: '/staff/new', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'staff-v6/design-qa.md' },

  // ── 機能31 機能設定 ─────────────────────────────────────
  { ...FEATURE_SET, node: 'c4R6F', name: '31-1 機能設定', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'settings-v6/design-qa.md' },

  // ── 機能32 運用状態 ─────────────────────────────────────
  /* タブ3本は設計とそろっている（健全性チェック／緊急コントロール／更新履歴）。 */
  { ...OPERATIONS, node: 'UgonK', name: '32-1 運用状態・健全性チェック', route: '/emergency?tab=health', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'operations-v6/design-qa.md' },
  { ...OPERATIONS, node: 'b3HfZ', name: '32-1-A 緊急コントロール', route: '/emergency?tab=control', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'operations-v6/design-qa.md' },
  { ...OPERATIONS, node: 'UhC2O', name: '32-1-B 更新履歴', route: '/emergency?tab=history', verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'operations-v6/design-qa.md' },
  {
    ...OPERATIONS, node: 'U0BwS', name: '32-1-C 緊急停止の最終確認',
    verdict: 'needs_fix', verdictNote: '未一致', verdictSource: 'operations-v6/design-qa.md',
    route: '/emergency?tab=control', mode: 'viewport', height: 1136,
    /*
      **停止するものを1つ選んでから押す。** 何も選ばずに押すと
      「停止する配信を1つ以上選んでください」で窓が開かない
      （`emergency/page.tsx:361`）。
    */
    steps: [{ click: '予約中の一斉配信', role: 'text' }, { click: '緊急停止する' }],
  },

  // ── 機能4 友だち属性（PR #402 で比較した残り10枚を台帳へ統合） ──
  /*
    タグ・情報欄・対応マーク・保存した検索は `/tags` の4タブ。
    CSV取り込みの4枚は、ファイルを選ばせる必要があるので
    `capture.spec.mjs` が撮っている（`tags-csv-*`）。
  */
  { node: 'hqrOv', feature: 4, name: '4-1 友だち属性・タグ', dir: 'friend-attributes-v6', route: '/tags', mode: 'page',
    verdict: 'needs_fix', verdictNote: 'P2 フォルダの但し書きが設計の「中の項目」でなく「中のタグ」。帯・フォルダ・行・列・よく使うは数値まで設計どおり',
    verdictSource: 'friend-attributes-v6/design-qa-remaining10.md', verdictHead: '87c150ad',
  },
  {
    node: 'dKlkz', feature: 4, name: '4-1-F タグ削除の確認ダイアログ',
    dir: 'friend-attributes-v6', route: '/tags', mode: 'viewport', height: 1080,
    steps: [{ click: '削除', scope: 'main' }],
    verdict: 'needs_fix', verdictNote: 'P2 注意文が設計と違う（設計「アフィリエイトのオファーで使用中のタグは削除できません」／実装「使用中のため、このタグは削除できません（4件から参照されています）」）。窓の作りは5行＋赤い注意＋名前の打ち直し＋2つのボタンまで一致。実装の文のほうが正しいので、Pencil側を直す候補',
    verdictSource: 'friend-attributes-v6/dKlkz-1920.png + design-qa-remaining10.md', verdictHead: '87c150ad',
  },
  {
    node: 'H374MR', feature: 4, name: '4-1-H タグCSV一括登録',
    dir: 'friend-attributes-v6', route: '/tags', mode: 'page',
    status: 'elsewhere', shots: 'tags-csv-select',
    why: 'ファイルを選ばせる操作が要る。`capture.spec.mjs` の `tags-csv-select` が撮っている',
    verdict: 'structure_match_data_pending', verdictNote: 'CSV一括登録の選択画面。作りは一致。取り込みの口が固定データのままで、実データにつながっていない',
    verdictSource: 'friend-attributes-v6/design-qa-remaining10.md', verdictHead: '87c150ad',
  },
  {
    node: 'sfTEW', feature: 4, name: '4-1-H-A CSV取り込み・確認（dry-run）',
    dir: 'friend-attributes-v6', route: '/tags', mode: 'page',
    status: 'elsewhere', shots: 'tags-csv-preview',
    why: '同上。`tags-csv-preview` が撮っている',
    verdict: 'needs_fix', verdictNote: 'P1 CSV確認に「行」の列が無い。設計は12/13/14/15/16とCSVの行番号を出す。P2 扱いの言葉が設計と違う（設計「飛ばす／エラー」実装「重複で見送り／入力確認」。実装のほうが正確なのでPencil側を直す候補）',
    verdictSource: 'friend-attributes-v6/design-qa-remaining10.md', verdictHead: '87c150ad',
  },
  {
    node: 'op1rh', feature: 4, name: '4-1-H-B CSV取り込み・完了',
    dir: 'friend-attributes-v6', route: '/tags', mode: 'page',
    status: 'elsewhere', shots: 'tags-csv-success',
    why: '同上。`tags-csv-success` が撮っている',
    verdict: 'structure_match_data_pending', verdictNote: 'CSV取り込み・完了。作りは一致。取り込み結果が固定データのままで、実データにつながっていない',
    verdictSource: 'friend-attributes-v6/design-qa-remaining10.md', verdictHead: '87c150ad',
  },
  {
    node: 'QzRsJ', feature: 4, name: '4-1-H-C CSV取り込み・一部失敗',
    dir: 'friend-attributes-v6', route: '/tags', mode: 'page',
    status: 'elsewhere', shots: 'tags-csv-partial',
    why: '同上。`tags-csv-partial` が撮っている',
    verdict: 'structure_match_data_pending', verdictNote: 'CSV取り込み・一部失敗。作りは一致。行ごとの失敗理由が口から返らず、いまの固定データは全行同じ文。実装は返ってきた文をそのまま出すので、口が理由を分ければ直る',
    verdictSource: 'friend-attributes-v6/design-qa-remaining10.md', verdictHead: '87c150ad',
  },
  { node: 'HBTk0', feature: 4, name: '4-2 友だち情報欄', dir: 'friend-attributes-v6', route: '/tags?tab=fields', mode: 'page',
    verdict: 'needs_fix', verdictNote: 'P1 「回答フォーム」「表示先」の列が無い。「入力済み」が未取得なのに0人と出る（withUsage=1を付けずに読んでいる）。帯4つが無い',
    verdictSource: 'friend-attributes-v6/design-qa-remaining10.md', verdictHead: '87c150ad',
  },
  {
    node: 'yKEdO', feature: 4, name: '4-2-C 一覧の状態（空・読込・エラー）',
    dir: 'friend-attributes-v6', route: '/tags?tab=fields', mode: 'page',
    states: { apis: ['**/api/friend-fields*', '**/api/list-stats*'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: 'P1 読込・空・失敗の文が設計と違う（設計「読み込んでいます／データがありません／表示できませんでした」）。P0（失敗時に空の文と「項目を追加」の誘いが出る）は #420 で直った',
    verdictSource: 'friend-attributes-v6/design-qa-remaining10.md', verdictHead: '87c150ad',
  },
  { node: 'rIhbN', feature: 4, name: '4-3 対応マーク', dir: 'friend-attributes-v6', route: '/tags?tab=marks', mode: 'page',
    verdict: 'needs_fix', verdictNote: 'P1 マークごとの人数が「人」だけで数字が出ない（SupportMarkの型にfriendCountが無く、どの口も返さない）。未取得なら—と出すべきところが空。帯4つが無い',
    verdictSource: 'friend-attributes-v6/design-qa-remaining10.md', verdictHead: '87c150ad',
  },
  { node: 'QKx8Q', feature: 4, name: '4-4 保存した検索', dir: 'friend-attributes-v6', route: '/tags?tab=searches', mode: 'page', verdict: 'needs_fix', verdictNote: 'P1', verdictSource: 'friend-attributes-v6/design-qa-searches-421.md' },

  // ── 機能4 友だち属性 ─────────────────────────────────────
  // 一覧・状態・削除・CSVは `capture.spec.mjs` で基準画像として撮っている。
  // ここには、設計と並べるために撮るものだけを置く。
  {
    node: 'l25rlp', feature: 4, name: '4-1-A タグを作る・初期状態',
    dir: 'friend-attributes-v6', route: '/tags/new', mode: 'page',
    verdict: 'needs_fix', verdictNote: 'P2 ★の説明が設計と違う（設計「このスイッチ、またはタグ一覧の星をクリックして、友だち一覧への表示をON／OFFできます。」）。3.連動のOFF時の案内が、設計は4つに説明付き（本人へのマイル付与 +N mile／紹介者へのマイル付与／今後のマイル倍率 1.2・1.5・2.0・3.0倍／連動アクション テキスト送信・テンプレート送信・タグ操作・シナリオ開始など）、実装は説明の無い2列。「この設定で起きること」の3つ目の文言も違う',
    verdictSource: 'friend-attributes-v6/l25rlp-1920.png', verdictHead: '87c150ad',
  },
  {
    node: 'tP0RW', feature: 4, name: '4-1-B タグを作る・連動ON',
    dir: 'friend-attributes-v6', route: '/tags/new', mode: 'page',
    steps: [{ click: 'タグ連動', role: 'switch' }],
    verdict: 'needs_fix', verdictNote: 'P2 「ONの間だけ動きます。OFFに戻すと、以降にタグが付いても連動は実行されません（過去の付与は取り消されません）。」の注記が無い。「マイル タグが付いた瞬間に積みます」の見出しが無い。a〜eの番号と設計の言い回し（このタグが初めて付いた本人に／その人を紹介した人に ほか）が違う',
    verdictSource: 'friend-attributes-v6/tP0RW-1920.png', verdictHead: 'baeb644b',
  },
  {
    node: 'LfrQs', feature: 4, name: '4-1-C 連動アクション追加ドロワー',
    dir: 'friend-attributes-v6', route: '/tags/new', mode: 'viewport', height: 1320,
    steps: [{ click: 'タグ連動', role: 'switch' }, { click: '＋ アクションを追加' }],
    verdict: 'needs_fix', verdictNote: 'P2 見出しの副題にタグ名が入らない（設計は「「NEN会員（定期）」が付いたときに実行する処理を選びます。」）。節の名前が違う（処理の種類→アクションの種類、実行タイミング→実行するタイミング、実行順の位置→追加する位置）。位置に「4番目（いちばん最後）」の順番が出ない。13種類の処理と待機の注記は一致',
    verdictSource: 'friend-attributes-v6/LfrQs-1920.png', verdictHead: 'baeb644b',
  },
  {
    node: 'ee0sk', feature: 4, name: '4-1-D タグを編集・既存設定あり',
    dir: 'friend-attributes-v6', route: '/tags/edit?id=tag-0', mode: 'page',
    verdict: 'needs_fix', verdictNote: 'P2 連動アクションの種類名が設計と違う（設計 テキスト送信・タグ追加・シナリオ開始／実装 メッセージ・シナリオ）。複製のボタンが無い。「OFFに戻すと…すでに積んだマイルは取り消されません。」の注記が無い。4.の4枚のカードに設計の補足（このタグを持つ友だち／まだ受け取っていない人／紹介者が登録されている人／さかのぼりません）が無い',
    verdictSource: 'friend-attributes-v6/ee0sk-1920.png', verdictHead: 'baeb644b',
  },
  {
    node: 'VjXGX', feature: 4, name: '4-1-E 遡及反映の確認ダイアログ',
    dir: 'friend-attributes-v6', route: '/tags/edit?id=tag-0', mode: 'viewport', height: 1590,
    steps: [{ click: '遡及反映', role: 'switch', onlyIfOff: true }, { click: '保存する' }],
    verdict: 'needs_fix', verdictNote: 'P2 副題にタグ名が入らない。取り消し方の案内（マイル画面から手動で調整）が無い。「新規作成のときはこのダイアログは出ません」の注記が無い。表に見出し行を足したのは実装のほうが読みやすい',
    verdictSource: 'friend-attributes-v6/VjXGX-1920.png', verdictHead: 'baeb644b',
  },
  {
    node: 'byqIW', feature: 4, name: '4-1-G 属性フォルダを追加・色編集',
    dir: 'friend-attributes-v6', route: '/tags/folders/new', mode: 'page',
    verdict: 'needs_fix', verdictNote: 'P2 設計は一覧に重なる小窓（フォルダを編集）、実装は別ページ。「一覧での表示」の見え方見本が無い。色の並びが設計と違う。「作成する場所（タグ／友だち情報欄）」は実装だけにある足し前',
    verdictSource: 'friend-attributes-v6/byqIW-1920.png', verdictHead: 'baeb644b',
  },
  {
    node: 'A1ZYeP', feature: 4, name: '4-2-A 友だち情報欄の項目を追加',
    dir: 'friend-attributes-v6', route: '/tags/fields/new', mode: 'page',
    verdict: 'needs_fix', verdictNote: 'P1 種類の選択肢が設計と違う（設計 1行・複数行・数値・日付・日時・電話・メール・URL・単一選択・複数選択・画像・PDF の12種類。実装は日時・画像・PDFが無く、真偽が増えて10種類）。P2 既定値が設計は「未設定」「［お名前］を使う」の選択、実装は自由入力。「200字まで」と「移すとタブの並びも変わります」の注記が無い',
    verdictSource: 'friend-attributes-v6/A1ZYeP-1920.png', verdictHead: '87c150ad',
  },
  {
    /*
      **#420（head `87c150ad`）で `/tags/fields/migrate` が入った。**
      使用中の項目（`usageCount > 0`）の行にだけ「移行」が出る
      （`field-list.tsx:143`）。使っていない項目は消せるので出ない。
    */
    node: 'KoT6c', feature: 4, name: '4-2-B 友だち情報欄・項目移行',
    verdict: 'needs_fix', verdictNote: 'P1（「dry-run」が画面に出ている）', verdictSource: 'v6-recheck-496-and-classification.md', verdictHead: '87c150ad',
    dir: 'friend-attributes-v6', route: '/tags/fields/migrate?id=field-birthday', mode: 'page',
  },
  {
    node: 'GMvBd', feature: 4, name: '4-3-A 対応マークを追加・編集',
    dir: 'friend-attributes-v6', route: '/tags?tab=marks', gap: 'api',
    gapNote: '**既存部品だけでは作れません。** 設計は1枚の画面で、名前・色・並び順・初期値のほかに**「自動変更ルール」**（担当者を割り当てたときなど、きっかけでマークを自動で変える）を持つ。ここに新しい口とテーブルが要る。名前・色・並び順・初期値までなら既存部品で作れる',
    status: 'unimplemented',
    why: '追加・編集の画面が無い。一覧の下に名前と色だけの追加欄がある（`components/friend-fields/mark-list.tsx`）。設計の自動変更ルールに当たるものは、口も画面も無い',
  },
  {
    node: 'zGZMA', feature: 4, name: '4-3-B 対応マーク削除の確認ダイアログ',
    dir: 'friend-attributes-v6', route: '/tags?tab=marks', mode: 'viewport', height: 1080,
    steps: [{ click: '削除', nth: 1, scope: 'main' }],
    verdict: 'needs_fix', verdictNote: 'P1 何人に付いているか、どのマークへ置き換わるかを言わずに消せる。設計は「この対応マークを使用している3人は、削除後に「未対応」へ変更されます。元に戻せません。」',
    verdictSource: 'friend-attributes-v6/zGZMA-1920.png', verdictHead: 'baeb644b',
  },
  {
    /* **#421（head `71aff344`）で `/tags/searches/edit` が入った。** */
    node: 'XBkiQ', feature: 4, name: '4-4-A 保存した検索の条件確認・編集',
    verdict: 'needs_fix', verdictNote: 'P1', verdictSource: 'friend-attributes-v6/design-qa-searches-421.md',
    dir: 'friend-attributes-v6', route: '/tags/searches/edit?id=ss-1', mode: 'page',
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

/**
 * どのPRの、どのheadで撮ったか。
 *
 * **「基準画像が以前と同じ」は合格の理由になりません。** 実装が進んだのに
 * 古いheadの絵を並べていると、直ったことも壊れたことも見えません。
 * どの機能をいつ・どの commit で見たかを、ここに1か所だけ持ちます。
 *
 * 書いていない機能は、まだPRのheadで撮り直していません（自分の枝で撮った
 * ものです）。**空欄を「確認済み」と読まないでください。**
 *
 * **1つの機能が複数のPRに分かれることがあります。** 機能4は #420（友だち
 * 情報欄）と #421（保存した検索）が別々に進んでいて、**#421 は #420 を
 * 含みません。** #421 の head で機能4を丸ごと撮り直すと、#420 で直った
 * 絵が直る前に戻ります。**一度それをやりました。**
 *
 * そうならないよう、機能ごとに配列で持ち、`screens` にどの画面が
 * どのheadのものかを書きます。**撮り直すときは `--only` で対象を絞る。**
 */
export const CAPTURED_AT = {
  4: [
    { pr: 420, head: '87c150ad', on: '2026-08-28', screens: ['HBTk0', 'yKEdO', 'KoT6c', 'A1ZYeP', 'l25rlp', 'rIhbN'] },
    { pr: 421, head: 'f7b7974a', on: '2026-08-28', screens: ['QKx8Q', 'XBkiQ'] },
  ],
  11: [
    { pr: 433, head: '51020a97', on: '2026-08-28', screens: ['M9cij'] },
    { pr: 493, head: '62ddaebe', on: '2026-08-28', screens: ['CzndJ', 'M9cij'], note: '#493 は #433 を含む' },
  ],
  6: [{ pr: 497, head: '84e5bab9', on: '2026-08-28', screens: ['FpgxH'], note: 'Claudeが作ったDraft。#495 の上に積んである' }],
  17: [
    { pr: 441, head: '05c5b103', on: '2026-08-28', screens: ['MvZm5', 'BmoGY', 'HIU5O'] },
    { pr: 441, head: 'e953109c', on: '2026-08-28', screens: ['s98Vfw', 'N46cQ', 'k8VCU'] },
    { pr: 494, head: '0ca45f98', on: '2026-08-28', screens: ['HIU5O'], note: '#494 は #441 を含む' },
    { pr: 495, head: '7d890d3b', on: '2026-08-28', screens: ['z3PB2', 'vz0Ji'], note: '#495 は #494 を含む' },
    { pr: 496, head: '4dac7986', on: '2026-08-28', screens: ['s6MBc'], note: '#496 は #495 を含む' },
    { pr: 499, head: '961722fc', on: '2026-08-28', screens: ['s6MBc'], note: 'Claudeが作ったDraft。#496 の上に積んである' },
  ],
  7: [{ pr: 500, head: '409f00bb', on: '2026-08-28', screens: ['GC4St'] }],
  8: [{ pr: 501, head: '93edbe17', on: '2026-08-28', screens: ['t7UtYQ'], note: '#501 は #500 を含む' }],
  5: [{ pr: 503, head: '6db5ad7f', on: '2026-08-28', screens: ['M2b2B'], note: '新しい口は足さず既存の統計を読む' }],
  25: [{ pr: 502, head: '75b010fc', on: '2026-08-28', screens: ['DkPY0'], note: '#502 は #500 を含む。新しい表は作らず既存の automation_runs を読む' }],
  18: [{ pr: 443, head: 'f372ff30', on: '2026-08-28' }],
  19: [{ pr: 444, head: 'ccbd0975', on: '2026-08-28' }],
  20: [{ pr: 445, head: '787a4b46', on: '2026-08-28' }],
  21: [{ pr: 446, head: '4307088d', on: '2026-08-28' }],
  22: [{ pr: 447, head: '65adbc59', on: '2026-08-28' }],
}
