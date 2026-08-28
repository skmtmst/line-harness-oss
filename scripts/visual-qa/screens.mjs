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
  { ...INBOX, node: 'xGLVe', name: '2-1 受信箱', steps: OPEN_CHAT, verdict: 'needs_fix', verdictNote: 'P1 見出しの副題に本名（河野 健太）が出ない。この部品が友だちの詳細を持っていない（データ未接続）。P2 見出しの★が無い。シナリオの札に🔗のアイコンが無く、日時が札の中に入っている（設計は札の外）。受信の吹き出しに最小幅が無く内容ぴったりになる。3カラム（一覧・トーク・顧客情報）と、見出しのアバターの頭文字・担当と対応の専用ドロップダウンは直って設計どおり', verdictSource: 'inbox-v6/design-qa.md' },
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
    verdict: 'needs_fix', verdictNote: 'P0は #513 head `60b39036` で修正済み・画像再確認待ち。onSaveが成否を返し、成功のときだけsetDone(true)へ進む。現行の比較画像は修正前headなので、#513を土台に保存APIを失敗させて「保存しました」が出ないことを確認するまで要修正を維持する',
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
    verdict: 'needs_fix', verdictNote: 'P1 失敗のときに赤い帯と同時に「条件に合う友だちが見つかりません」を出し、「友だち一覧 0件」と数える。未取得と0件を区別していない。**#520 で直す差分が出ている（未取り込み）**',
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
    verdict: 'needs_fix', verdictNote: 'P1 作り手の言葉が画面に出ている（「cron が 5 分粒度のため最大 5 分遅れる場合があります」）。運用の人に cron は通じない。P2 設計は「1通目を編集」の専用ページで、LINEプレビュー・配信の流れ・設定内容・配信前チェック（テスト送信が未完了です ほか4項目）を右に並べる。実装は一覧の行の下に開く欄で、それらが無い。時刻が09:00 AMと英語書式になるのは撮影側のブラウザ言語の癖',
    verdictSource: 'scenarios-v6/xfYLn-1920.png', verdictHead: '6db5ad7f',
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
    verdict: 'needs_fix', verdictNote: 'P1 選べる動作が設計の8つ（テキスト送信・テンプレート送信・タグ操作・友だち情報操作・シナリオ操作・リマインダ操作・対応マーク/表示操作・イベント予約操作）のうち5つで、テキスト送信・テンプレート送信・リマインダ操作・イベント予約操作が無い。実行の順番も、動作ごとの条件分岐（条件ON/OFF）も、保存済みセットの呼び出しも、「発動2回目以降も各動作を実行」も無い',
    verdictSource: 'scenarios-v6/hz9ti-1920.png', verdictHead: '6db5ad7f',
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
    gap: 'pending',
    gapNote: '#521 head `7d5d74fd` で開始・停止の確認窓を実装済み。最新headを1440/1920で比較してから未実装を外す',
    status: 'unimplemented',
    why: 'developmentには開始前確認が無いが、#521に `data-design-node="RUxNf"` の確認フローがある。#519 → #521の積み順を保ち、headの画像確認待ち',
  },
  {
    ...SCENARIO, node: 'NrBkW', name: '5-1-J シナリオ・配信開始完了', route: EDIT,
    gap: 'pending',
    gapNote: '#522 head `3c88b8bd` で開始完了と実績確認への導線を実装済み。取り込み順は #521 → #522',
    status: 'unimplemented', why: '#522で実装済み。#521の開始確認を土台にしているため、積み順を守った最新headの画像確認待ち',
  },
  {
    ...SCENARIO, node: 'g2UNV', name: '5-1-K シナリオ・テスト送信', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: '一括テスト送信', nth: 1 }],
    verdict: 'needs_fix', verdictNote: 'P1 テスト送信の意味が設計と違う。設計は自分のLINEへ送る確認で「本番影響：なし」、待機は10秒へ短縮、タグ・情報欄の変更は実行しない、と明記する。実装は友だちを選んで本物のメッセージを実際に送る（画面にもその警告が出る）。開始ステップの指定・所要時間・設定サマリー・メッセージプレビュー・開始前の3項目チェックが無い',
    verdictSource: 'scenarios-v6/g2UNV-1920.png', verdictHead: '6db5ad7f',
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
    states: { apis: ['**/api/scenarios/*', '**/api/scenarios/**'], kinds: ['normal', 'loading', 'error'] },
    verdict: 'match', verdictNote: '一致',
    verdictSource: 'scenarios-v6/design-qa-results-503.md', verdictHead: '6db5ad7f',
  },
  {
    ...SCENARIO, node: 'q5G45', name: '5-1-M 一覧の状態（空・読込・エラー）', route: '/scenarios',
    states: { apis: ['**/api/scenarios*', '**/api/scenarios/**', '**/api/list-stats*'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: 'P1 失敗のときに赤い帯と同時に「シナリオがありません。「＋ シナリオを作成」から作ってください。」を出す。持っているシナリオが消えたように見え、押せば同じものをもう1つ作る。#420 で友だち情報欄について直したのと同じ形が、こちらに残っている。帯が—と「取得できませんでした」になるのは設計どおりで正しい。**#519 で直す差分が出ている（未取り込み）**',
    verdictSource: 'scenarios-v6/q5G45-error-1920.png', verdictHead: '6db5ad7f',
  },

  // ── 機能6 一斉配信 ──────────────────────────────────────
  { ...BROADCAST, node: 'q76C35', name: '6-1 一斉配信', route: '/broadcasts',
    verdict: 'needs_fix', verdictNote: 'P2 帯の4枚が設計（予約中・下書き・今月の配信・平均開封率）と違い、今月の配信・到達・平均開封率・失敗になっている。列の並びも違い、開封（率）の未取得が「-」で「—」でない。フォルダごとの「…」（名前を変える・消す）が無い。日付欄が mm/dd/yyyy になるのは撮影側のブラウザ言語の癖。以前ここに出ていた「予約中 undefined」は /api/broadcasts/stats の固定データを用意していなかったこちらの落ちで、足して消えた。ただし broadcast-kpis.tsx:40 は欠けた項目をそのまま文へ繋ぐので、守りは足りないまま',
    verdictSource: 'broadcasts-v6/q76C35-1920.png + apps/web/src/components/broadcasts/broadcast-kpis.tsx:40', verdictHead: '6db5ad7f',
  },
  { ...BROADCAST, node: 'zZ9fA', name: '6-1-A 一斉配信を作成', route: NEW_BC,
    verdict: 'needs_fix', verdictNote: 'P1 節の番号が画面の並びと合っていない（上から 1.送る相手 → 3.送る内容 → 2.送る時間）。設計の5段の進み表示（基本設定・対象者・メッセージ・送信設定・確認）が無く、1枚の長い画面になっている。配信方法（新しいメッセージを作成／テンプレートを選択／過去の配信を複製）と「最近の配信」からの複製が無い。社内メモが無い。P2 右の設定内容（配信対象・配信日時・送信数・配信後）が無く、配信名の字数（14 / 60文字）も出ない。送信対象の未取得が「−」で「—」でない',
    verdictSource: 'broadcasts-v6/zZ9fA-1920.png', verdictHead: '6db5ad7f',
  },
  {
    ...BROADCAST, node: 'cPk8A', name: '6-1-B 対象条件', route: NEW_BC,
    gap: 'build',
    gapNote: '保存した検索の仕組みは #421 で入った。配信側から呼ぶだけ',
    status: 'unimplemented',
    why: '**確かめました（2026-08-28、`development` 2e438929）。順番の問題ではありません。** 「保存した条件から選ぶ」は `disabled` を直接書いてあり、`title` は「保存した条件は準備中です」（`broadcast-form.tsx:646-653`）。埋める順を変えても押せません',
  },
  { ...BROADCAST, node: 'XQfMD', name: '6-1-C メッセージ編集', route: NEW_BC,
    verdict: 'needs_fix', verdictNote: 'P1 本文の上限が設計と違う。設計は1通あたり5,000文字・合計22,500文字・最大5通で、4,500文字を超えると自動分割。実装は0/500・吹き出しは最大3。ボタン（最大4つ、ラベルと押したときの動作）の編集が無い。URLの扱いの表（サイト名・URL・計測）が無い。保存してテンプレート化、配信後のアクションが無い。P2 種類がタブでなくセレクト',
    verdictSource: 'broadcasts-v6/XQfMD-1920.png', verdictHead: '6db5ad7f',
  },
  {
    /*
      **設計は重なる窓だが、実装は本文の下に開く欄。**
      見えている範囲だけ撮ると、開いた中身が画面の外に残る。
      ここは `page` で撮って、開いた欄まで写す。
    */
    ...BROADCAST, node: 'p97Tf', name: '6-1-D テンプレート選択', route: NEW_BC,
    mode: 'page', steps: [{ click: 'テンプレートから選ぶ' }],
    verdict: 'needs_fix', verdictNote: 'P1 ひな形が約60件、フォルダの絞り込みも検索も無く2列でそのまま並ぶ（設計はフォルダ選択＋検索＋3件の候補）。選んだひな形の更新日・使用回数・プレビューが出ず、読み込む前の確認窓も無い。P2 1件ごとの★（よく使う）が無い。カードの補足に内部の値「text」がそのまま出ている',
    verdictSource: 'broadcasts-v6/p97Tf-1920.png', verdictHead: '6db5ad7f',
  },
  {
    ...BROADCAST, node: 'Bw0zt', name: '6-1-E 送信設定', route: NEW_BC,
    mode: 'viewport', height: 1136, steps: [{ click: '日時を指定して予約' }],
    verdict: 'needs_fix', verdictNote: 'P1 送信枠（使用予定と残り通数）が出ない。前後の配信と重ならないかを見る配信スケジュールも、重複時の送信（1人1通にまとめる）も、配信優先度も無い。予約時刻の直前に対象人数と送信枠を再確認する旨の注意も無い。P2 開封数の計測が独立した切り替えでなく「この配信の開封数は取らない」のチェックとして3.送る内容の中にある。日付欄が mm/dd/yyyy、時刻が10:00 AM になるのは撮影側のブラウザ言語の癖',
    verdictSource: 'broadcasts-v6/Bw0zt-1920.png', verdictHead: '6db5ad7f',
  },
  {
    /*
      **空のまま押すと窓が開かない。** 「管理用タイトルを入力してください」が
      出るだけで、テスト送信の窓は出ない。先に管理名と本文を埋める。
      （その注意文が、欄から遠い本文の下に出るのも差として残る）
      撮り直すまで判定は入れない。
    */
    ...BROADCAST, node: 'h0kahp', name: '6-1-F テスト送信', route: NEW_BC,
    mode: 'viewport', height: 1080,
    /*
      **本文の入れ物には名札が無い。** `textarea` は `placeholder` だけなので
      `getByLabel` では引けない。`selector: true` で CSS から引く。
      名札で引こうとして 30 秒待って落ちた。
    */
    steps: [
      { fill: 'input[placeholder^="例：8月キャンペーン"]', selector: true, text: '画面確認の配信' },
      { fill: 'textarea[placeholder="テキストを入力"]', selector: true, text: '画面確認のための本文です。' },
      { click: 'テスト送信' },
      { wait: 800 },
    ],
    verdict: 'needs_fix', verdictNote: 'P1 テスト送信を押すと、先に配信を1件作ってから送る（broadcast-form.tsx:514 の api.broadcasts.create → testSend）。送信に失敗しても作った配信は消さないので、押すたびに配信が1件残る。画面は「テスト送信できませんでした」としか言わない。P1 送信先を選べない。設計は「テスト送信先を選択」の窓で相手を選び、テスト履歴と確認項目（改行と文字切れ・画像/ボタンの表示・変数の差し込み・リンクの遷移）と「本番の送信枠を消費しません」を見せる。撮った絵で送信が失敗しているのは、モックが書き込みを405で返すためで実装の不具合ではない',
    verdictSource: 'broadcasts-v6/h0kahp-1920.png + apps/web/src/components/broadcasts/broadcast-form.tsx:514', verdictHead: '6db5ad7f',
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
    verdict: 'needs_fix', verdictNote: 'P1 送信枠を見ない。設計は残り3,787/5,000通を出し、足りなければ「配信枠が不足しています」で止めて対象を見直させる。実装の配信前チェック6件に送信枠の行が無く、足りなくても進める。確認項目の3つのチェック（対象人数・メッセージ表示・配信日時）も無い。実装の6件（文字数・ブロック除外・同じ本文の重複・URL・テスト送信・開封集計）は設計より細かく、そこは良い',
    verdictSource: 'broadcasts-v6/vW4Es-1920.png', verdictHead: '6db5ad7f',
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
  { ...BROADCAST, node: 'u6gHt', name: '6-1-J 結果詳細', route: '/broadcasts/detail?id=broadcast-2',
    verdict: 'needs_fix', verdictNote: 'P1 開封が送信より多く出る。送信624件・到達624件と並べて開封2,410件（62.4%）と出す。手元の記録（624）とLINE側の集計（3,862のうち2,410）を混ぜているのに、どちらの母数かを画面が言わない。桁の合わない2つを並べても何も言わない。P2 メッセージの種類が「1通（carousel）」と内部の語のまま出る。設計のタブ（クリック・友だち・エラー・配信内容）、ボタンとリンクごとの反応、設定サマリー、メッセージプレビュー、CSVで書き出す が無い',
    verdictSource: 'broadcasts-v6/u6gHt-1920.png', verdictHead: '6db5ad7f',
  },
  {
    ...BROADCAST, node: 'EGMb1', name: '6-1-K 削除確認', route: '/broadcasts',
    mode: 'viewport', height: 1080, steps: [{ click: '削除' }],
    verdict: 'needs_fix', verdictNote: 'P1 配信の削除の確認が、ブラウザ標準の confirm（broadcasts/page.tsx:139「この配信を削除してもよいですか？」）。どの配信か、予約中か送信済みかを言わない。設計は画面内の確認窓',
    verdictSource: 'broadcasts-v6/EGMb1-1920.png + apps/web/src/app/broadcasts/page.tsx:139', verdictHead: '6db5ad7f',
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
    verdict: 'needs_fix', verdictNote: 'P2 フォルダの追加はできるが、フォルダごとの「…」（名前を変える・消す・並べ替える）が無い。設計の一覧はフォルダごとに件数と「…」を持つ',
    verdictSource: 'broadcasts-v6/xkRDb-1920.png', verdictHead: '6db5ad7f',
  },
  {
    ...BROADCAST, node: 'TmHjF', name: '6-1-N 一覧の状態（空・読込・エラー）', route: '/broadcasts',
    /*
      **末尾が `broadcasts*` だと `/api/broadcasts/stats` に届かない。**
      Playwright の `*` は `/` をまたがない。届かないまま撮ると、一覧が
      読めていないのに帯だけ数が残る。機能3でも同じことが起きていた。
    */
    states: {
      apis: ['**/api/broadcasts?**', '**/api/broadcasts', '**/api/broadcasts/stats*', '**/api/list-stats*'],
      kinds: ['loading', 'empty', 'error'],
    },
    verdict: 'needs_fix', verdictNote: 'P2 文言だけが設計と違う（設計「表示できませんでした／再読み込みしても直らない場合はエラー報告へ。」）。中身は正しい。失敗のとき帯は—、一覧の中は「いまは読み込めていません。上の案内をご覧ください。」。ただし共通部品の data-list-state が付いておらず、状態を名前で言えていない（試験から状態を見分けられない）',
    verdictSource: 'broadcasts-v6/TmHjF-error-1920.png', verdictHead: '6db5ad7f',
  },

  // ── 機能7 リマインダ ────────────────────────────────────
  /*
    設計は5段の作成ウィザード（基本設定→対象者→通知ステップ→送信設定→確認）。
    実装は `/reminders/new` の1枚もので、段の縦帯も右の「設定内容」も無い。
    **段ごとの画面が無いので、設計の A〜G は1枚ずつには対応しない。**
  */
  { ...REMINDER, node: 'M1EXwB', name: '7-1 リマインダ', route: '/reminders', verdict: 'needs_fix', verdictNote: 'P1 失敗の帯が無い（設計の4つめは「失敗 2通（要確認）」、実装は「今月の配信」）。P1 状態で絞る札4つ（有効のみ・下書き・停止中・失敗あり）が無い。P1 列に「予定」と「最終送信」が無い（実装は 名前・配信方式・きっかけ・送る内容・フォルダ・稼働・登録日）。P2 送信予定の単位が設計の「通」でなく「人」。基準日の期間・並び順・表示件数が無い。行ごとのごみ箱が無く下に「選択したリマインダを削除」。P2 状態が2つしか出せない。Reminder.isActive が真偽値ひとつなので、作ったが動かしていない（下書き）と動かしていて止めた（停止中）を分けられない。**列を増やすかどうかは実装側の決めごと**', verdictSource: 'reminders-v6/design-qa.md' },
  { ...REMINDER, node: 'uJP22', name: '7-1-A リマインダを作成', route: '/reminders/new', verdict: 'needs_fix', verdictNote: 'P1 作成の段の構造が無い。設計は段ごとに 対象の絞り込み・停止条件・配信予定の下見・テスト送信・最終確認へ進むが、実装にあるのは1段目の入力だけ', verdictSource: 'reminders-v6/design-qa.md' },
  {
    ...REMINDER, node: 'J64xI', name: '7-1-B 通知ステップ編集',
    verdict: 'needs_fix', verdictNote: 'P1 通知ステップ編集の面が設計とそろわない', verdictSource: 'reminders-v6/design-qa.md',
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
    verdict: 'needs_fix', verdictNote: 'P1×5。(1) 失敗したのに「ありません」と書いている（要約カードは—通と正しく出すのに、通知実績の欄は「送る内容がありません 0通」と出る）。(2) 1440pxで列が切れる。(3) 内部IDが画面に出ている。(4) どのリマインダを見ているか分からない。(5) 通知の名前が出ていない。詳しくは reminders-v6/design-qa-execution-results-500.md。**t7UtYQ が手本で、5件のうち4件はそちらでは起きていない**', verdictSource: 'reminders-v6/design-qa-execution-results-500.md', verdictHead: '409f00bb',
    route: '/reminders/detail?id=reminder-1',
    states: {
      apis: ['**/api/reminders/*/runs*'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
  },
  {
    ...REMINDER, node: 'Y0Sn3', name: '7-1-I 削除確認', route: '/reminders',
    gap: 'pending',
    gapNote: '#498で未送信だけを取消し、送信済み履歴を残すsoft deleteと確認窓を実装済み。#514で一部失敗時に成功分と残りを分けて再試行可能にする。取り込み順は #498 → #514',
    status: 'unimplemented',
    why: 'developmentは物理削除で `friend_reminders` と送信済み `friend_reminder_deliveries` までCASCADEし、設計の「送信済み履歴は監査記録として残る」に反する。#498 head `ac288d48` は `deleted_at` と未来予定のcancelを追加し、#514 head `9a72dba6` は複数削除の部分失敗を再試行可能にした。統合後のheadで `Y0Sn3` を撮るまで未実装扱いを維持する',
  },
  {
    ...REMINDER, node: 'dC0yg', name: '7-1-J 一覧の状態（空・読込・エラー）', route: '/reminders',
    states: { apis: ['**/api/reminders*', '**/api/reminders/**', '**/api/list-stats*', '**/api/folders*'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: 'P2 文言だけが設計と違う（設計「表示できませんでした／再読み込みしても直らない場合はエラー報告へ。」、実装「リマインダの読み込みに失敗しました。もう一度お試しください。」＋「いまは読み込めていません。上の案内をご覧ください。」）。**中身は正しい。** 失敗のとき帯は—と「取得できませんでした」、一覧の中は空の文でなく読めていない旨を出す。ほかの機能の手本になる',
    verdictSource: 'reminders-v6/dC0yg-error-1920.png', verdictHead: '409f00bb',
  },

  // ── 機能8 自動応答 ──────────────────────────────────────
  /*
    設計は5段のウィザード（基本設定→どんなときに動くか→何を返すか→優先順位→確認）。
    実装は一覧の上に出る**1枚の窓**で、段も右の「設定内容」も無い。
  */
  { ...AUTO_REPLY, node: 'cmDfJ', name: '8-1 自動応答', verdict: 'needs_fix', verdictNote: 'P1 「条件が重なっている」を知らせる帯が無い（設計の4つめは「要確認（条件重複）」、実装は「未ヒット」）。上から順に最初に当てはまった1つだけが動く仕組みなので、重なりに気づく場所が要る', verdictSource: 'auto-replies-v6/design-qa.md' },
  {
    ...AUTO_REPLY, node: 'K7vg2', name: '8-1-A 自動応答ルール編集',
    verdict: 'needs_fix', verdictNote: 'P1 ルール編集の段が無い。設計の A・B・C（ルール編集／反応条件／応答とアクション）が、実装では一覧の上に出る1枚の窓に全部入っている。右の「設定内容」も無い', verdictSource: 'auto-replies-v6/design-qa.md',
    route: '/auto-replies/edit?id=ar-2',
  },
  {
    ...AUTO_REPLY, node: 'nzWIX', name: '8-1-B 反応条件',
    verdict: 'needs_fix', verdictNote: 'P1 8-1-B 反応条件が独立しておらず、8-1-A と同じ1枚の中にある', verdictSource: 'auto-replies-v6/design-qa.md',
    route: '/auto-replies/edit?id=ar-2',
  },
  {
    ...AUTO_REPLY, node: 'ivDoe', name: '8-1-C 応答とアクション',
    verdict: 'needs_fix', verdictNote: 'P1 8-1-C 応答とアクションが独立しておらず、8-1-A と同じ1枚の中にある', verdictSource: 'auto-replies-v6/design-qa.md',
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
    gapNote: '既存 `ConfirmDialog` にルール名、新しい受信への応答と後続処理が止まること、過去の実行履歴は残ることを表示する。`auto_reply_hits` は外部キーを持たず削除後も残るため新規DBは不要',
    status: 'unimplemented',
    why: '現行はブラウザの `confirm()` から同じDELETEを呼ぶだけで撮影できない。定義を消しても `auto_reply_hits` は設計どおり監査記録として残る。API契約を変えず、同じ削除操作の前に影響を読ませる共通確認窓へ置き換えられる。ただし `auto-replies/page.tsx` を触る #430・#450・#491 の統合順を先に解く',
  },
  {
    ...AUTO_REPLY, node: 'q8wSqO', name: '8-1-J 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/auto-replies*', '**/api/auto-replies/**', '**/api/folders*'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: 'P1 内部の言葉とDBの列名が画面に出ている（「silent rule のみ — match するが返信しない (同 keyword の automation rule 未登録)」「適用外 (line_account_id が別アカに固定)」「返信あり (inline)」、列見出しの「TEMPLATE」）。P1 失敗のときに帯が0件・0回・0件・0件と出る（未取得なので—にすべき）。一覧の中を「いまは読み込めていません」にしているのは正しい',
    verdictSource: 'auto-replies-v6/q8wSqO-error-1920.png', verdictHead: '93edbe17',
  },

  // ── 機能9 友だち追加時の配信 ────────────────────────────
  /*
    **設計と実装で、持ち物の数が違う。**
    設計は「流入リンクごとに初回案内を並べる一覧」＋5段のウィザード。
    実装は**アカウントに1枚**の設定（`FriendAddRouting`）で、
    ①はじめて追加した人 と ②以前からの友だち の2つに分けるだけ。
    流入リンクで出し分ける仕組みがそもそも無い。
  */
  { ...FRIEND_ADD, node: 'uLQQc', name: '9-1 友だち追加時の配信', verdict: 'needs_fix', verdictNote: 'P1 設計は「流入リンクごとに初回案内を並べる一覧」で、店頭QR・広告・紹介にそれぞれ別の初回案内を置いて優先順位で当てる。実装はアカウントに1枚の設定（FriendAddRouting）で、はじめて追加した人と以前からの友だち・ブロック解除した人の2つに分けるだけ。**流入リンクで出し分ける仕組みがそもそも無い**（page.tsx:712「流入元の記録は友だち追加のたびに必ず走るので、ここでは選びません。」）。作り込み不足ではなく別の形の機能。実装だけにある「どう振り分けられるか」の流れ図と注意の帯は、設定の効き方が読めるので残すべきもの', verdictSource: 'friend-add-v6/design-qa.md' },
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
  { ...FRIEND_ADD, node: 'txMO9', name: '9-1-D アクション追加', verdict: 'needs_fix', verdictNote: 'P1 アクション追加が別窓でなく札の列。設計の段の構造に対応していない', verdictSource: 'friend-add-v6/design-qa.md' },
  {
    ...FRIEND_ADD, node: 'U3SI5', name: '9-1-E プレビューとテスト',
    verdict: 'needs_fix', verdictNote: 'P1 プレビューとテストの面が設計とそろわない', verdictSource: 'friend-add-v6/design-qa.md',
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
  { ...WEBINAR, node: 'ZC13r', name: '10-1 ウェビナー', verdict: 'needs_fix', verdictNote: 'P1 一覧に申込人数・視聴人数が出ない。帯の3つ（申込・平均視聴率・平均視聴時間）がどれも—で、札に「一覧では数えられません」「視聴ログの集計は未対応」と書いてある。どのウェビナーが効いているかを一覧で比べられず、1本ずつ開いて覚えて比べることになる。WebinarAnalytics は1本ぶんを返せるので、足りていないのはまとめて数える口。P2 表でなく札の格子。左のフォルダの縦帯が無く「フォルダを追加」は押せない。CTA反応の帯が無い。「並び替え」が在るが押せない', verdictSource: 'webinars-v6/design-qa.md' },
  { ...WEBINAR, node: 'lvaY5', name: '10-1-A ウェビナーを作成', route: '/webinars/new', verdict: 'needs_fix', verdictNote: 'P1 作成の段（設計は複数段に分ける）が無く、1枚の画面になっている', verdictSource: 'webinars-v6/design-qa.md' },
  {
    ...WEBINAR, node: 'PV1Vh', name: '10-1-B 動画・公開設定', route: WEBINAR_EDIT,
    verdict: 'needs_fix', verdictNote: 'P1 10-1-B 動画・公開設定が独立しておらず、視聴後アクション（Xjk8q）と同じタブに混ざっている', verdictSource: 'webinars-v6/design-qa.md',
    steps: [{ click: 'いつ見られるようにするか' }],
  },
  {
    ...WEBINAR, node: 'd3rFGD', name: '10-1-C CTA・フォーム', route: WEBINAR_EDIT,
    verdict: 'needs_fix', verdictNote: 'P1 CTA・フォームの面が設計とそろわない。案内を送る仕組み（前日20:00・1時間前・開始時・未視聴者へ翌日10:00の見逃し案内）は画面にも口にも無く、grep で0件', verdictSource: 'webinars-v6/design-qa.md',
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
    verdict: 'needs_fix', verdictNote: 'P1 10-1-E 視聴後アクションが独立しておらず、10-1-B と同じタブに混ざっている', verdictSource: 'webinars-v6/design-qa.md',
    steps: [{ click: 'いつ見られるようにするか' }],
  },
  {
    ...WEBINAR, node: 'GB0NR', name: '10-1-F 公開ページプレビュー', route: WEBINAR_EDIT,
    gap: 'pending',
    gapNote: '#507 head `579fa25c` で実URLの公開ページを別窓で開く導線を実装済み。画像確認待ち',
    status: 'unimplemented',
    why: 'developmentではdisabledだが、#507に `data-design-node="GB0NR"` と公開URLの確認導線がある。#507 headの画像確認待ち',
  },
  {
    ...WEBINAR, node: 'D6yO7e', name: '10-1-G 公開前確認',
    gap: 'pending',
    gapNote: '#508 head `61eeb3c7` で動画・配信枠・長さを検査し、公開内容を読む確認窓を実装済み。取り込み順は #507 → #508',
    status: 'unimplemented', why: '#508で `ConfirmDialog` を使った公開前確認を実装済み。最新headの画像確認待ち',
  },
  {
    ...WEBINAR, node: 'TimXl', name: '10-1-H 公開完了',
    gap: 'pending',
    gapNote: '#508 head `61eeb3c7` で公開完了画面と公開後の導線を実装済み。取り込み順は #507 → #508',
    status: 'unimplemented', why: '#508に `/webinars/published` と `data-design-node="TimXl"` がある。画像確認待ち',
  },
  {
    ...WEBINAR, node: 'Q8sHa', name: '10-1-I 参加者管理', route: WEBINAR_EDIT,
    verdict: 'needs_fix', verdictNote: 'P1 参加者管理の面が設計とそろわない。1本ぶんの申込・視聴・CTAは WebinarAnalytics が返せるが、一覧では数えられない', verdictSource: 'webinars-v6/design-qa.md',
    steps: [{ click: '概要・分析' }],
  },
  {
    ...WEBINAR, node: 'yxyzQ', name: '10-1-J 分析', route: WEBINAR_EDIT,
    verdict: 'needs_fix', verdictNote: 'P1 10-1-J 分析が独立しておらず、10-1-I 参加者管理と同じタブに混ざっている', verdictSource: 'webinars-v6/design-qa.md',
    steps: [{ click: '概要・分析' }],
  },
  {
    ...WEBINAR, node: 'LKuAQ', name: '10-1-K 削除確認',
    gap: 'drop',
    gapNote: '物理削除はV6要件の除外対象。公開停止・アーカイブへ置き換え、申込・視聴・分析・監査は保持する。現行 `webinarApi.remove` は視聴履歴を物理削除する一方、申込記録を削除対象に含めず孤児化させるため、画面へそのまま接続しない',
    status: 'unimplemented',
    why: 'V6詳細要件 §11・§14 は視聴履歴の物理削除を禁止している。現行 `deleteWebinar` は viewer・funnel・コメント等を物理削除し、`webinar_registrations` は残すため、削除確認を足すだけでは履歴消失と孤児データを発生させる。編集画面の「削除」はCTAの札を1枚外すもので、ウェビナー本体ではない（`edit/page.tsx:764`）',
  },
  {
    ...WEBINAR, node: 'zCQXe', name: '10-1-L 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/webinars*', '**/api/webinars/**'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: 'P1 失敗の詳しい説明が「API error: 500」とそのまま出る。P1 ウェビナーの件数だけ0と出る（ほかの3枚は—。未取得なので—にそろえる）。一覧の中を赤い枠と「もう一度読み込む」にしているのは正しい',
    verdictSource: 'webinars-v6/zCQXe-error-1920.png', verdictHead: 'ed2e3633',
  },

  // ── 機能11 テンプレート ─────────────────────────────────
  /*
    設計のタブは6本（メッセージ／カルーセル／リッチメッセージ／質問／
    クーポン／リサーチ）。実装は5本で、**「質問」だけが無い。**
  */
  { ...TEMPLATE, node: 'W7LBc', name: '11-1 テンプレート', verdict: 'needs_fix', verdictNote: 'P1 種類のタブが5本で、設計の6本から「質問」が抜けている。質問は文のあとにボタンを2つ出し、押された選択肢ごとにタグ付与・シナリオ開始・フォームを分ける道具で、代わりにカルーセルのボタンや自動応答で受けると押した人を取りこぼす。P1 左の縦帯はテンプレートの category という文字から自動で生えているだけで /api/folders を一度も呼んでいない。作る・名前を変える・消すのどれもできない', verdictSource: 'templates-v6/design-qa.md' },
  {
    ...TEMPLATE, node: 'GFlD7', name: '11-1-A メッセージを作る',
    verdict: 'needs_fix', verdictNote: 'P1 メッセージを作る面が設計とそろわない。差し込みと吹き出しの上限、保存してテンプレート化の扱いが違う', verdictSource: 'templates-v6/design-qa.md',
    steps: [{ click: 'テンプレートを作る' }],
  },
  {
    ...TEMPLATE, node: 'FRkls', name: '11-1-B カルーセルを作る',
    verdict: 'needs_fix', verdictNote: 'P1 カルーセルを作る面が設計とそろわない', verdictSource: 'templates-v6/design-qa.md',
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
    verdict: 'needs_fix', verdictNote: 'P1 リッチメッセージを作る面が設計とそろわない', verdictSource: 'templates-v6/design-qa.md',
    steps: [{ click: 'リッチメッセージ' }, { click: 'リッチメッセージを作る' }],
  },
  {
    ...TEMPLATE, node: 'hsBtl', name: '11-1-E クーポンを作る',
    verdict: 'needs_fix', verdictNote: 'P1 クーポンそのものを作れない。入力欄は名前・特典内容の自由記入・クーポンを開くURLの3つだけ（broadcast-asset-manager.tsx:76）で、どこか別で作ったクーポンのURLを貼るだけ。設計の 画像1029×1029／使える期間／使い方のご案内／使える回数（1人1回・何回でも）／だれに見えるか／抽選（当たる確率・当選人数の上限）／クーポンコード／使われたときに実行すること が全部無い。**抽選の上限が無いまま配ると全員に当たる**', verdictSource: 'templates-v6/design-qa.md',
    steps: [{ click: 'クーポン' }, { click: 'クーポンを作る' }],
  },
  {
    ...TEMPLATE, node: 'J3GxEZ', name: '11-1-F リサーチを作る',
    verdict: 'needs_fix', verdictNote: 'P1 リサーチで質問を1問も作れない（説明とURLだけ）。設計は10問まで、種類（1つだけ選ぶ・いくつでも・自由に書く）と、答えの残し先（友だち情報欄・タグ）まで決める', verdictSource: 'templates-v6/design-qa.md',
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
    verdict: 'needs_fix', verdictNote: 'P2 設計の「先に差し替えてから削除する」流れが無い。設計は使用先を3つ挙げ、差し替え画面へ誘い、そのまま消すときは名前を打ち直させる。実装は使用中のテンプレートから削除の導線ごと外す作りで、危険は無い代わりに使用中のものを整理する手段が無い。窓にも使用先が出ない',
    verdictSource: 'templates-v6/M9cij-1920.png', verdictHead: '62ddaebe',
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
    /*
      **「…」を押さないと中身が写らない。** 開く前の絵を設計と並べても
      何も比べていない。ボタンの読み上げ名は `フォルダ「◯◯」を操作`
      （`components/shared/folder-panel.tsx:122`、PR #493 head `62ddaebe`）。
      **この部品は #493 にしか無い。** いまの画面確認サーバ（`6db5ad7f`）の
      木には入っていないので、撮るには #493 の木でサーバを起こす。
    */
    ...TEMPLATE, node: 'CzndJ', name: '11-1-H フォルダ操作',
    mode: 'viewport', height: 1080,
    steps: [{ click: 'フォルダ「お問い合わせ」を操作' }],
    verdict: 'needs_fix', verdictNote: 'P2 メニューの5項目（名前を変更・色を変える・並び順を上へ・並び順を下へ・フォルダを削除）は設計どおり（folder-panel.tsx:128-157、#493 head 62ddaebe）。ただし設計にある但し書き「削除しても、中のテンプレートは未分類に残ります。」がメニューに無い。開いた状態の撮影は #493 の木でサーバを起こさないとできないため、撮り方だけ先に入れた',
    verdictSource: 'templates-v6/CzndJ-1920.png + /private/tmp/line-harness-v6-feature11-folders apps/web/src/components/shared/folder-panel.tsx', verdictHead: '62ddaebe',
  },
  {
    ...TEMPLATE, node: 'NKyoA', name: '11-1-I 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/templates*', '**/api/broadcast-message-assets*'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: 'P1 失敗のときもタブの件数とフォルダ件数が0と出る（未取得なので—にすべき）。一覧の中を赤い枠で「テンプレートを読み込めませんでした／もう一度読み込む」にしているのは正しい。P2 区分のチップに「Flex」という作り手の言葉が出る',
    verdictSource: 'templates-v6/NKyoA-error-1920.png', verdictHead: '62ddaebe',
  },

  // ── 機能12 リッチメニュー ───────────────────────────────
  /*
    設計は3段（形とボタン→誰に出すか→公開のしかた）。実装は1枚もの。
    段は無いが**中身は同じ画面に全部ある**ので、同じ絵を3つの設計と
    突き合わせる形にする。
  */
  { ...RICH_MENU, node: 'GO8RQ', name: '12-1 リッチメニュー', verdict: 'needs_fix', verdictNote: 'P1 どれが出るかを決める「順番」が画面に出ない。リッチメニューは同じ友だちが複数に当てはまると**いちばん上の1つだけ**が出るのに、並び順の既定は「タップ数が多い順」（page.tsx:93）で、画面の並びと実際に出る順番が関係ない。targetingPriority はデータとして持っているのに一覧が一度も出していない（grep が0件）。出し分けを2件以上使い始めた時点で効いてくる。P2 表でなく札の格子。絞り込みの札が3つで「条件で出し分け」「管理画面の外」で絞れない。状態に「予約」が無い（status は draft と published の2つだけで、publishingAt は持っているのに予約中を出せない）。「保存した検索」が無い', verdictSource: 'rich-menus-v6/design-qa.md' },
  { ...RICH_MENU, node: 'XtfO3', name: '12-1-A メニューを作る・形とボタン', route: '/rich-menus/new', verdict: 'needs_fix', verdictNote: 'P1 形とボタンを決める段が無く、1枚の画面に混ざっている', verdictSource: 'rich-menus-v6/design-qa.md' },
  { ...RICH_MENU, node: 'kQ1bs', name: '12-1-B メニューを作る・誰に出すか', route: RM_EDIT, verdict: 'needs_fix', verdictNote: 'P1 12-1-B 誰に出すかが独立しておらず、同じ1枚の中に混ざっている', verdictSource: 'rich-menus-v6/design-qa.md' },
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
  { ...RICH_MENU, node: 'UMiJ9', name: '12-1-D メニューを作る・公開のしかた', route: RM_EDIT, verdict: 'needs_fix', verdictNote: 'P1 12-1-D 公開のしかたが独立しておらず、同じ1枚の中に混ざっている。日時を決めて出す「予約中」の状態を出せない', verdictSource: 'rich-menus-v6/design-qa.md' },
  { ...RICH_MENU, node: 'TL7tp', name: '12-1-E 管理画面の外のメニューを取り込む', verdict: 'needs_fix', verdictNote: 'P2 設計は別画面だが実装は一覧の中に埋め込み。**設計より近い場所にあるので悪い差ではない**。ただし絞り込みの札に「管理画面の外」が無く、絞れない', verdictSource: 'rich-menus-v6/design-qa.md' },
  {
    ...RICH_MENU, node: 'szXsT', name: '12-1-F リッチメニューの削除確認',
    gap: 'api',
    gapNote: '確認窓だけでは作れない。現在表示中の人数、次に表示されるメニュー、切替元、自動応答・オートメーション等の参照元を返す影響確認と、LINE取り下げの完了を保証する実行記録が要る。`force=true` は管理画面へ出さない',
    status: 'unimplemented',
    why: '設計 `szXsT` と要件 §5-9 は、表示中8,140人、次に出るメニュー、切替元、自動応答の参照を確認し、先にLINEから取り下げる二段階を求める。現行は公開中を409で止めるだけで、`?force=true` ならLINE残骸を許したままD1行を物理削除できる。影響内訳と取り下げ完了の契約が無いまま `ConfirmDialog` へ接続しない',
  },
  {
    ...RICH_MENU, node: 'RW5Tb', name: '12-1-G 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/rich-menu-groups*', '**/api/rich-menu-groups/**', '**/api/folders*'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: 'P1 失敗の知らせが「API error: 500」とそのまま出る（rich-menus/page.tsx:452 が受け取った文字をそのまま描く。ApiErrorの既定文が英語と数字）。P1 失敗のときメニューと出し分けが0件と出る（未取得なので—にすべき。今月のタップと最多タップは—と「集計を取れませんでした」で正しい）。**前に「帯に前の数が残る」と書いたのは誤りだった。** 当てはめが /api/rich-menu-groups/tap-stats に届いていなかっただけで、当てはめを直して撮り直したら—になった',
    verdictSource: 'rich-menus-v6/RW5Tb-error-1920.png + apps/web/src/app/rich-menus/page.tsx:452', verdictHead: '09dc476b',
  },

  // ── 機能13 回答フォーム ─────────────────────────────────
  /*
    設計は一覧・編集（3つのタブ）・集まった回答の3つ。実装は一覧と回答が
    同じ画面で、編集は別ルート。**「デザイン設定」は押せない状態で置いてある**
    （見た目をアプリにそろえる方針にしたため、と画面に書いてある）。
  */
  { ...FORM, node: 'EMBIK', name: '13-1 回答フォーム', verdict: 'needs_fix', verdictNote: 'P1 一覧の列に「回答の保存先」（友だち情報欄3・タグ2）が無い。このフォームに答えると友だちの何が書き換わるかを一覧で読めない。**どこへ書いているかは、消す前・変える前にいちばん要る情報**。実装の札は名前・回答数・最終回答だけで、保存先を知るには1つずつ編集画面を開いてブロックを見ることになる。P2 表でなく札の格子', verdictSource: 'forms-v6/design-qa.md' },
  { ...FORM, node: 'vCqUj', name: '13-1-A フォームを作る', route: FORM_EDIT, verdict: 'needs_fix', verdictNote: 'P1 フォームを作る面が設計とそろわない', verdictSource: 'forms-v6/design-qa.md' },
  {
    ...FORM, node: 'ava2n', name: '13-1-B フォームのデザイン設定', route: FORM_EDIT,
    gap: 'drop',
    gapNote: '**作らない決めが実装に明記**。「見た目をこのアプリのデザインにそろえる方針にしたため、色やフォントを選ぶ画面は作っていない」',
    status: 'unimplemented',
    why: '**確かめました（2026-08-28）。作らない決めです。** 「デザイン設定」は `disabled` を直接書いてあり（`form-submissions/edit/page.tsx:379-388`）、覚え書きに「フォームの見た目をこのアプリのデザインにそろえる方針にしたため、色やフォントを選ぶ画面は作っていない」とあります。**V6から外す候補**',
  },
  {
    ...FORM, node: 'cSqvP', name: '13-1-C フォームのオプション設定', route: FORM_EDIT,
    verdict: 'needs_fix', verdictNote: 'P1 オプション設定の面が設計とそろわない', verdictSource: 'forms-v6/design-qa.md',
    mode: 'viewport', height: 1080, steps: [{ click: 'オプション設定' }],
  },
  { ...FORM, node: 'v9tYhl', name: '13-1-D 集まった回答', steps: [{ click: '来店アンケート' }], verdict: 'needs_fix', verdictNote: 'P1 情報欄への書き込みが失敗した件数が出ない（設計は「3件は欄が消えていて書けていません」）。**答えは受け取れているのに友だち情報へ入っていない状態が、画面のどこにも出ない。** あとでリマインダが動かない形で表に出る。P1 「1件ずつ見る／まとめて見る」の切り替え、絞り込み、CSVで書き出す、帯4つ（回答／開いた人のうち答えた割合／情報欄への書き込み／次回予定が入った人）が無い', verdictSource: 'forms-v6/design-qa.md' },
  {
    ...FORM, node: 'gBp2J', name: '13-1-E フォームの削除確認',
    gap: 'api',
    gapNote: '確認窓だけでは作れない。削除前にフォーム名・公開状態・回答数・利用中の場所・開けなくなるURLを返す影響確認が要る。公開中・回答あり・利用中は物理削除せず、停止・保管へ移す契約と `status` / `deleted_at` が必要',
    status: 'unimplemented',
    why: '現行DELETEはフォーム本体とウェビナーCTAを物理削除する一方、回答は外部キーの実行環境により消えるか孤児化する。V6要件 §3-8 は、公開中・回答あり・利用中なら直接削除せず停止・保管へ移すよう要求しているため、一覧にDELETEとConfirmDialogだけを足さない',
  },
  {
    ...FORM, node: 'ZOPyc', name: '13-1-F 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/forms*', '**/api/forms/**'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: '以前のP0判定は撮影側の当てはめ漏れを含むため撤回し、#436 head `950073ab` の再比較待ち。コードには `ListState kind="error"`、再読み込み、回答一覧側の失敗分岐がある。APIを確実に失敗させた1440/1920画像で、空状態の作成誘導が同時に出ないことを確認するまで要修正を維持する',
    verdictSource: 'forms-v6/ZOPyc-error-1920.png + apps/web/src/app/form-submissions/page.tsx:354', verdictHead: '950073ab',
  },

  // ── 機能14 共通情報 ─────────────────────────────────────
  { ...COMMON_VAR, node: 'WuKzU', name: '14-1 共通情報', verdict: 'needs_fix', verdictNote: 'P1 一覧に「使われている場所」の数が出ない。共通情報は1か所直すと差し込んでいる全部の文が同時に変わるので、どこで使われているかが要る', verdictSource: 'common-vars-v6/design-qa.md' },
  { ...COMMON_VAR, node: 'gBtaK', name: '14-1-A 共通情報を編集', route: '/contents/vars/edit?id=cv-1', verdict: 'needs_fix', verdictNote: 'P1 どこが変わるか見えないまま保存する。設計は「保存すると、下の15か所すべてが すぐに変わります」「使われている場所 15か所（テンプレート12件・回答フォーム3件）」「差し込んだときの見え方（いまの文 → 保存したあとの文）」の3つで支えるが、実装の編集画面は 名前・フォルダ・差し込み名・値・更新スケジュール だけで**どこで使われているかが1つも出ない**（grep 影響|使われて が /contents/vars 配下で0件）。「会社名」を直すとき、何本のテンプレートの文が変わるのかを知らないまま保存することになる。設計は「予約中の配信にも効きます」とまで書いている。P1 文字数の上限を超えるものが分からない（設計は影響の一覧で「本文が 66 / 60 字」と出す）。共通情報を長くするとカルーセルの本文が上限を超えて壊れる', verdictSource: 'common-vars-v6/design-qa.md' },
  {
    ...COMMON_VAR, node: 'uNBlA', name: '14-1-B 変える前に影響を見る',
    gap: 'api',
    gapNote: '共通情報の差し込み先を1件ずつ引く口が要る',
    status: 'unimplemented',
    why: '差し込み先を1件ずつ並べて、変える前と後の文を見せる画面が無い（`grep 影響|使われて` が `/contents/vars` 配下で0件）。**文字数の上限を超える先も出ない**',
  },
  {
    ...COMMON_VAR, node: 'yPkWe', name: '14-1-C 共通情報の削除確認',
    gap: 'api',
    gapNote: '確認窓だけでは作れない。使用先と版、変更前後の文、予約中・公開中を返す影響確認、互換種類の代替候補、全使用先の差し替え、旧定義のアーカイブ、実行結果の記録が要る。#437の削除影響APIは件数と種類別集計までで、V6の差し替えは未実装',
    status: 'unimplemented',
    why: 'V6要件 §11 は使用中の物理削除を禁止し、代替への差し替え後に旧定義をアーカイブする。#437は使用中DELETEを409で止める安全柵を追加したが、代替選択・プレビュー・一括差し替え・版履歴・アーカイブは無い。ブラウザの `confirm()` を共通部品へ替えるだけでは正本の操作にならない',
  },

  // ── 機能15 登録メディア ─────────────────────────────────
  { ...MEDIA, node: 'g89Tc', name: '15-1 登録メディア', verdict: 'needs_fix', verdictNote: 'P1 使っている先が一覧で見えない。設計は札に「3か所で使用中」「どこでも使っていない」を出すが、実装は「使用箇所」のボタンを1つずつ押して開く形で、**消してよいファイルを探すのに6件あれば6回押す**。絞り込み札「使っていない」も無い', verdictSource: 'media-v6/design-qa.md' },
  {
    ...MEDIA, node: 'voJtX', name: '15-1-A メディアの詳細と差し替え',
    verdict: 'needs_fix', verdictNote: 'P1 差し替えができない（grep 差し替え が /contents 配下で0件）。設計の詳細は「差し替える」が主役で、名前とURLは変わらず、使っている3か所すべてが新しい画像に変わり、予約中の配信にも効く。実装で同じことをするには消して入れ直すことになるが、**URLが変わるので使っている先が全部切れる**。商品写真を1枚だけ新しくするのは日常の作業。P1 使用中でも消せる（409が返ると「それでも削除しますか？」で消せる。page.tsx:183）。設計は「使われているあいだは削除できません。先にこの3か所から外してください。」。どちらが正しいかは決めごとだが、**いまは消したあとに何が壊れたかを知る場所が無い**', verdictSource: 'media-v6/design-qa.md',
    mode: 'viewport', height: 1080, steps: [{ click: '夏の定番セット.jpgの使用箇所' }],
  },
  {
    /*
      設計の `eXAJP` は一覧と同じ文言。実装も**一覧の上にドロップ枠が
      常に出ている**ので、同じ絵で突き合わせる。
    */
    ...MEDIA, node: 'eXAJP', name: '15-1-B ファイルを入れる',
    verdict: 'needs_fix', verdictNote: 'P1 ファイルを入れる面が独立しておらず、一覧と同じ画面にある', verdictSource: 'media-v6/design-qa.md',
  },
  {
    ...MEDIA, node: 'YfTfJ', name: '15-1-C メディアの削除確認',
    gap: 'api',
    gapNote: '確認窓だけでは作れない。使用先の完全な台帳、差し替え互換性の事前確認、一括差し替え、アーカイブ、未使用・未公開・履歴なしだけを削除するジョブが要る。現行の使用先取得と409停止は安全側だが、V6の「別の画像に差し替え」はまだ実行できない',
    status: 'unimplemented',
    why: 'V6要件 §10〜§12 は、使用先を開く・全使用先を別素材へ差し替える・アーカイブする3択と、復旧可能な削除ジョブを要求している。#438 は使用中削除を409で止めるところまで実装したが、差し替えと版・アーカイブの口は無い。ブラウザの `confirm()` を共通部品へ替えるだけでは正本の操作にならない',
  },
  {
    ...MEDIA, node: 'h8pBZr', name: '15-1-D 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/media*', '**/api/media/**'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: 'P1 失敗のときに赤い帯と同時に「ファイルがまだありません。」を出す。持っているファイルが消えたように見える。赤い帯を出しているぶん回答フォームよりはましだが、一覧の中は空の文でなく読めていない旨にすべき',
    verdictSource: 'media-v6/h8pBZr-error-1920.png', verdictHead: '166f0c43',
  },

  // ── 機能16 成果とアフィリエイト ─────────────────────────
  /*
    設計のタブは4本（アフィリエイター／案件／成果承認／支払い）。
    実装は5本で、**「支払い」が無く**、代わりに「成果地点（CV）」と
    「レポート」がある。支払いの2枚（`njLGA` `GqFTV`）は行き先が無い。
  */
  { ...AFFILIATE, node: 'PouPn', name: '16-1 成果とアフィリエイト', route: '/conversions?tab=affiliates', verdict: 'needs_fix', verdictNote: 'P1 帯4つ（今月の成果42件／承認待ち8件 合計¥96,000／確定した報酬¥312,000 8/31締め9/30払い／ほか）が無い。P1 「支払い」のタブが無い（grep 振込|締め が0件）。まだ払っていない額・次の締め・次の支払日・振込先が未登録の人を、画面から知る方法が無い。**成果を認めるところまではできて、そこから先が無い**', verdictSource: 'affiliates-v6/design-qa.md' },
  { ...AFFILIATE, node: 'GH8VL', name: '16-1-A 案件', route: '/conversions?tab=offers', verdict: 'needs_fix', verdictNote: 'P1 案件の面が設計とそろわない。報酬の決め方が「案件ごとの決まった額」を主にできない', verdictSource: 'affiliates-v6/design-qa.md' },
  { ...AFFILIATE, node: 'n5VVTb', name: '16-1-B 成果承認', route: '/conversions?tab=approvals', verdict: 'needs_fix', verdictNote: 'P1 成果承認の面が設計とそろわない。承認したあと支払いへつなぐ先が無い', verdictSource: 'affiliates-v6/design-qa.md' },
  {
    ...AFFILIATE, node: 'njLGA', name: '16-1-C 支払い',
    gap: 'api',
    gapNote: '締め日・支払日・振込先・未払い残高の表が要る',
    status: 'unimplemented',
    why: '「支払い」のタブが無い。締め日・支払日・振込先・未払い残高を扱う場所がどこにも無い（`grep 振込|締め` が0件）',
  },
  { ...AFFILIATE, node: 'xqT1Z', name: '16-1-D アフィリエイターを登録する', route: '/affiliates/new', verdict: 'needs_fix', verdictNote: 'P1 報酬が「売上 × 率」でしか出ない（tabs.tsx:193）。設計の払い方は「案件ごとの決まった額」が基本で、AffiliateOffer.rewardAmount は持っているのに一覧の報酬だけが見ていない。**決まった額で払う人は一覧でずっと ¥0 に見える**（固定データの合同会社ノースは18件の成果で¥0）', verdictSource: 'affiliates-v6/design-qa.md' },
  {
    ...AFFILIATE, node: 'jwrbf', name: '16-1-E アフィリエイターの成果内訳',
    verdict: 'needs_fix', verdictNote: 'P1 成果内訳の面が設計とそろわない。報酬が率でしか出ないので内訳も合わない', verdictSource: 'affiliates-v6/design-qa.md',
    route: '/conversions?tab=affiliates', mode: 'viewport', height: 1136,
    /* 表の行は `onClick` だけで、押せる役を持っていない。文字で探す。 */
    steps: [{ click: '田中 明', role: 'text' }],
  },
  { ...AFFILIATE, node: 'GPWzq', name: '16-1-F 案件をつくる', route: '/affiliate-offers/new', verdict: 'needs_fix', verdictNote: 'P1 案件をつくる面で、報酬の決め方（案件ごとの決まった額）を主にできない', verdictSource: 'affiliates-v6/design-qa.md' },
  {
    ...AFFILIATE, node: 'QX70l', name: '16-1-G アフィリエイターを削除する確認',
    gap: 'drop',
    gapNote: '物理削除確認はV6から除外する。紹介者は停止・アーカイブし、過去成果・承認・未払い・支払い記録を保持する。個人情報削除は識別情報の匿名化として別要件にする',
    status: 'unimplemented',
    why: '要件 §1・§10・§15 は一般UIからの物理削除と、過去の支払い記録を消すことを禁止している。設計 `QX70l` の「記録ごと削除」は正式要件と矛盾する。#440側も `DELETE /api/affiliates/:id` を405 `PHYSICAL_DELETE_DISABLED` に変え、停止は `PUT { isActive: false }` としているため、この削除画面を実装しない',
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
  { ...MILEAGE, node: 's98Vfw', name: '17-1 マイル', verdict: 'needs_fix', verdictNote: 'P2 帯の言葉が設計より薄い。設計は「マイルを持っている友だち1,284人／全体の62%。持っていない人786人」「たまっているマイル486,200／会社としての『あとで返すぶん』です」と、割合・未保有数・意味まで書く。実装は「マイル対象者1,284人」「保有マイル合計486,200mile」で、割合と未保有数と意味の説明が無い。**未取得と0の描き分けは正しい**（残高0の人は0、最終行動が無い人は—。「もうすぐ消えるマイル 未取得 — mile 失効ロットを接続後に表示」）', verdictSource: 'mileage-v6/design-qa.md' },
  { ...MILEAGE, node: 'N46cQ', name: '17-1-A たまる決めごと', route: '/mileage?tab=earning-rules', verdict: 'needs_fix', verdictNote: 'P2 たまる決めごとの面が設計とそろわない細部が残る。**止める・再開する操作と「動いています／止めています」は #441 で入って解決している**', verdictSource: 'mileage-v6/design-qa.md' },
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
    verdict: 'needs_fix', verdictNote: 'P1 「だれが」の列が無く、手で動かした記録を誰がやったか追えない（設計は自動／本人／担当者名を出す）。残高の列も無い。帯4つ（この30日の記録・手で動かした分・取り消し・反映を待っている）が無い。「マイルを手で増やす・減らす」と「履歴をCSVで書き出す」の導線が無い。P2 絞り込みが設計のチップ（すべて/付いた/使った/手で動かした/取り消し）でなくセレクト6つ。ページ送りが無い。日付欄が mm/dd/yyyy になるのは撮影側のブラウザ言語の癖',
    verdictSource: 'mileage-v6/MvZm5-1920.png', verdictHead: '05c5b103',
  },
  { ...MILEAGE, node: 'BmoGY', name: '17-1-D たまる決めごとをつくる', route: '/mileage/earning-rules/new', verdict: 'structure_match_data_pending', verdictNote: '構造一致・データ未接続', verdictSource: 'mileage-v6/design-qa.md' },
  {
    /*
      **#441 で `/mileage/friends/detail` が入った。**
      実装側に `data-design-node="HIU5O"` の印が付いている。
    */
    ...MILEAGE, node: 'HIU5O', name: '17-1-E 友だちのマイル明細',
    route: '/mileage/friends/detail?id=friend-1', mode: 'page',
    verdict: 'needs_fix', verdictNote: 'P1 設計の右側が丸ごと無い（ランクの進み・ゴールドになった日・次のランクまでの差／9/30に消えるマイルの警告と「期限が近い人に知らせる」導線／この人がつながっている場所／つながる先）。「何でたまったか」（たまる決めごとごとの回数・たまったマイル・割合・いちばん最近）も無い。履歴に残高の列と「だれが」の列が無い。P2 帯の中身が設計と違う（設計はいまの残高・これまでにためた・使った・9/30に消える）。なお「30日以内に失効 — mile（未取得）」は未取得の出し方として正しく、ほかの画面の手本になる',
    verdictSource: 'mileage-v6/HIU5O-1920.png', verdictHead: '0ca45f98',
  },
  {
    /*
      **#494（head `0ca45f98`）で入った。** 友だちのマイル明細
      （`HIU5O`）の右上「マイルを手で増やす・減らす」から窓が開く。
      オーナーか管理者にしか出ない（`staff.me()` の `role` で分ける）。
      窓は `position: fixed` なので `page`（全面）では撮れない。
    */
    ...MILEAGE, node: 'vz0Ji', name: '17-1-F マイルを手で増やす・減らす',
    verdict: 'needs_fix', verdictNote: 'P1 手で増やす・減らす操作が無い。**間違って付いたマイルを直せない**', verdictSource: 'mileage-v6/design-qa-score-495.md',
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
    verdict: 'needs_fix', verdictNote: 'P1 層の境目が設計と違う（設計 ふつう30〜69点・低い29点以下／実装 ふつう40〜69点・低い39点以下）。同じ点数の人が別の層に入る。P1 「内訳を見る」が無く、なぜその点数かを追えない。帯ごとの「この帯の人を見る」「この帯に配信する」も、文だけでボタンが無い。P2 呼び名が設計の「帯」でなく「層」。注意文から「マイル残高はスコアで増えも減りもしません」が落ちている。「点数が変わった理由は未取得」と正直に出しているのは正しい',
    verdictSource: 'mileage-v6/z3PB2-normal-1920.png', verdictHead: '7d890d3b',
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
  { ...INFLOW, node: 'Q4bkTg', name: '18-1 流入と計測', route: '/inflow-links?tab=links', verdict: 'needs_fix', verdictNote: 'P1 タブに件数が付かない（設計は流入経路24／広告連携3）。帯4つの作りが違う（設計は流入元24本／今月312人・経路が分かる289人／クリック8,420回／平均の追加率6.4%）。左のフォルダの縦帯が無い（ジャンルはあるが別の作り）。「まとめて操作」「CSVで書き出す」が無い', verdictSource: 'inflow-v6/design-qa.md' },
  { ...INFLOW, node: 'IhSBB', name: '18-1-A サイトスクリプト', route: '/inflow-links?tab=script', verdict: 'needs_fix', verdictNote: 'P1 サイトスクリプトの面が設計とそろわない。18-1 全体の差（タブに件数が付かない・帯4つの作りが違う・左のフォルダの縦帯が無い・まとめて操作/CSVが無い）がここにも効く', verdictSource: 'inflow-v6/design-qa.md' },
  { ...INFLOW, node: 'v0HaI', name: '18-1-B 広告連携', route: '/inflow-links?tab=ads', verdict: 'needs_fix', verdictNote: 'P1 「Yahoo!広告 つないでいません」から実際につなげない。押すと「接続を作る画面は準備中です」で止まる。設計はそこから接続を作らせる', verdictSource: 'inflow-v6/design-qa.md' },
  { ...INFLOW, node: 'TEVk8', name: '18-1-C 流入リンクをつくる', route: '/inflow-links/new', verdict: 'needs_fix', verdictNote: 'P1 流入リンクをつくる面が設計とそろわない', verdictSource: 'inflow-v6/design-qa.md' },
  { ...INFLOW, node: 'JupxW', name: '18-1-D 流入元の詳細', route: '/inflow-links/detail?ref=summer-ig', verdict: 'needs_fix', verdictNote: 'P1 流入元の詳細の面が設計とそろわない', verdictSource: 'inflow-v6/design-qa.md' },
  {
    ...INFLOW, node: 'UIaM7', name: '18-1-E 流入リンクの削除確認',
    gap: 'api',
    gapNote: '確認窓だけでは作れない。投稿・広告・自動処理・成果対応の使用先、過去流入数、転送先候補を返す影響確認と、停止・アーカイブ・別リンクへの転送を行う契約が要る。履歴がある経路は物理削除しない',
    status: 'unimplemented', why: '設計 `UIaM7` と要件 §4-6 は、URL停止、別リンクへの転送、過去の流入・友だち・成果・広告送信履歴の保持を求める。現行 `DELETE /api/entry-routes/:id` は影響確認なしでD1行を物理削除するだけで、停止・アーカイブ・転送・参照中の削除防止を保証しない。ブラウザの `confirm()` を共通窓へ替えるだけでは要件を満たさない',
  },
  {
    ...INFLOW, node: 'BMmxU', name: '18-1-F 一覧の状態（空・読込・エラー）',
    verdict: 'needs_fix', verdictNote: 'P1 一覧の状態に共通部品（ListState）を使っておらず、読込・空・失敗の言い分けが設計とそろわない。ほかの機能は同じ部品へ寄せている', verdictSource: 'inflow-v6/design-qa.md',
    route: '/inflow-links?tab=links',
    states: { apis: ['**/api/entry-routes*', '**/api/entry-routes/**', '**/api/analytics/ref-summary*'], kinds: ['loading', 'empty', 'error'] },
  },
  /*
    **判定を改めた（PR #443 head `f372ff30`）。**
    「成果を広告へ返す仕組みが無い」と書いていたが、独立したタブが無い
    だけで、**中身は「広告連携」タブに入っている。** 返した記録も、
    クリックの種類（fbclid）も、失敗の理由も出る。
  */
  { ...INFLOW, node: 'BuVDB', name: '18-2 広告とのつなぎ（成果の対応付け）', route: '/inflow-links?tab=ads', verdict: 'needs_fix', verdictNote: 'P1 「成果地点と、広告に返す名前の対応」が無い。対応が付いていない成果地点は広告へ返せないのに、**返せていないことに気づく場所がどこにも無い**。P1 「失敗したものをまとめてやり直す」が無い（試行・次の再試行は—のまま）。P2 帯が「広告側へ返した成果 1件」だけ（設計は 送った866／待っている12／断られた7／やり直して成功23）', verdictSource: 'inflow-v6/design-qa.md' },
  { ...INFLOW, node: 'Im2b1', name: '18-2-A 広告への送信履歴', route: '/inflow-links?tab=ads', verdict: 'needs_fix', verdictNote: 'P1 18-2-A 送信履歴が独立した画面として無く、18-2 の1枚の中に混ざっている', verdictSource: 'inflow-v6/design-qa.md' },

  // ── 機能19 コンバージョン ───────────────────────────────
  { ...CONVERSION, node: 'ZrpKn', name: '19-1 コンバージョン', route: '/conversions?tab=points', verdict: 'needs_fix', verdictNote: 'P2 「何が起きたら数えるか」にきっかけの名前（EC連携の「注文が確定」／回答フォームの送信）が出ず、種別と数え方のチップになっている。CSVで書き出す、中身を見る、使う場所を足す が無い。**「使う場所を足す」が無いので、作った成果地点を分析へつなぐ導線がこの画面に無い**。期間の選択も無い。成果地点名が長いと…で切れる（設計は折り返す）。**未取得と0件の描き分けは正しい**（金額を持たないものは「金額なし」、使われていないものは「どこからも使われていません」）', verdictSource: 'conversions-v6/design-qa.md' },
  { ...CONVERSION, node: 'GUxsj', name: '19-1-A コンバージョン レポート', route: '/conversions?tab=report', verdict: 'needs_fix', verdictNote: 'P1 レポートの面が設計とそろわない。詳しくは conversions-v6/design-qa.md の「GUxsj レポート — P1」', verdictSource: 'conversions-v6/design-qa.md' },
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
    verdict: 'needs_fix', verdictNote: 'P2 使っている場所を挙げるところまでは同じだが、設計は場所ごとに「何が止まるか」（紹介リンク11本が実質止まる／自動返信が動かなくなる／分析の線が消える）と「開く」の導線を付ける。実装は文だけで導線が無い。設計の3択（数えるのをやめる／別の成果地点に差し替えてから削除する／このまま削除する）のうち「数えるのをやめる」だけを出す作りで、消せない代わりに安全。過去の成果と金額を「そのまま残るもの」として出しているのは正しい',
    verdictSource: 'conversions-v6/d8d3Mz-1920.png', verdictHead: 'ccbd0975',
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
  { ...ANALYTICS, node: 'QQ1SR', name: '20-1-C 使われ方', route: '/analytics?tab=usage', verdict: 'needs_fix', verdictNote: 'P1 設計の帯4つと「片づける」が無い。**最終利用が日本時間で出るのと、一度も使っていないものを—にするのは #445 で直って解決している**', verdictSource: 'analytics-v6/design-qa.md' },
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
  { ...ANALYTICS, node: 'dfwD4', name: '20-2-C 保存した分析', route: '/analytics?tab=saved', verdict: 'needs_fix', verdictNote: 'P1 設計の帯5つと絞り込みが無い。**一覧の「集計状態」列（利用可能／一部集計／取得不可／—）は #445 で入って解決している**', verdictSource: 'analytics-v6/design-qa.md' },

  // ── 機能21 NEN配信 ──────────────────────────────────────
  /* タブ4本は設計とそろっている（配信フロー／NENコラム／ペット／配信履歴）。 */
  { ...NEN, node: 'VLMGH', name: '21-1 NEN配信', verdict: 'needs_fix', verdictNote: 'P1 画面の名前がメニューと違う（メニューと上の帯は「NEN配信」、見出しは「フォロー配信」）。押した名前と着いた先の名前が違うと、着いた場所が合っているか確かめられない。P1 押せない操作が理由なしに3つ置いてある（マニュアル・並び替え・フォルダを追加。3つとも disabled）。さらに上の帯に押せる「マニュアル」があり、同じ名前が2つあって片方だけ押せる', verdictSource: 'nen-v6/design-qa.md' },
  { ...NEN, node: 'DEX0k', name: '21-1-A NENコラム', steps: [{ click: 'NENコラム' }], verdict: 'needs_fix', verdictNote: 'P1 コラムの状態が英語のまま出る（scheduled / sent / draft。page.tsx:422）。設計は「出したもの／下書き／予約ずみ」。#446 が配信ジョブで直したのと同じ形で、jobStatusLabel と同じ当てはめをコラムにも置けば済む', verdictSource: 'nen-v6/design-qa.md' },
  { ...NEN, node: 'q4lajm', name: '21-1-B ペット・記念日', steps: [{ click: 'ペット・誕生日' }], verdict: 'needs_fix', verdictNote: 'P1 帯4つ（登録864匹・友だち1,284人のうち62%／今月誕生日72匹／誕生日配信の開封94.6%／クーポン利用38.2%）が無い。一覧の「次の配信」列（9/1に誕生日クーポン／送れません）と「これまでの配信」列（6回）が無い。LINEプレビューが無い。クーポンの決めごととペットの一覧は在る', verdictSource: 'nen-v6/design-qa.md' },
  { ...NEN, node: 'WeXbL', name: '21-1-C NEN配信の履歴', steps: [{ click: '配信履歴' }], verdict: 'structure_match_data_pending', verdictNote: '構造一致・データ未接続', verdictSource: 'nen-v6/design-qa.md' },
  {
    ...NEN, node: 'HpKyF', name: '21-1-D NEN配信の中身を編集する',
    verdict: 'needs_fix', verdictNote: 'P1 きっかけが ec.order.delivered のまま生で出る（edit/campaign-editor.tsx:298-301）。設計は「注文が届いたとき」。pet.birthday も同じ。P1 誕生日配信では「何日後に送るか」の欄が効かないのに出ている。一覧は「誕生日の3日前 10:00」と出るのに編集画面は「0日後」に見える。campaignKey === birthday_coupon のときは日数の欄を隠し、一覧が使っている formatCampaignTiming をそのまま置けばよい', verdictSource: 'nen-v6/design-qa.md',
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
  { ...PHOTO, node: 'Qu6Vk', name: '22-1 写真審査', verdict: 'needs_fix', verdictNote: 'P0 写真審査の一覧が設計とそろわない（元の判定を引き継いでいる。中身は photos-v6/design-qa.md を見る）', verdictSource: 'photos-v6/design-qa.md' },
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
  { ...EC, node: 'eI3gs', name: '23-1 EC連携', verdict: 'needs_fix', verdictNote: 'P1 結びつかなかった注文が、どこにも出てこない。ECの注文にはLINEの友だちが誰なのか書かれておらず、メールか電話で結びつけて、どちらも一致しなかった注文が「会員のつき合わせ」に並ぶ設計。実装にはそれを集めて見る場所が無い。設計は候補（電話番号が同じ／確からしさ とても高い）と「結びつけると増える売上 ¥312,400（この24件ぶん。分析にも入ります）」まで出す。**いま結びつかなかった注文は、買ってくれた事実がLINE側に何も残らないまま**で、購入後の配信も成果地点もマイルも動かない。P1 つなぎ先を画面から変えられない（page.tsx:174「接続先や突合キーを画面から変える口が無い」）', verdictSource: 'ec-v6/design-qa.md' },
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
  { ...LINE_NOTIFY, node: 'festr', name: '24-1 LINE通知', verdict: 'needs_fix', verdictNote: 'P1 送った記録が残らない（いつ・だれに・どのお知らせを送ったか）。届かなかったものを追うタブも無い', verdictSource: 'line-notify-v6/design-qa.md' },
  {
    ...LINE_NOTIFY, node: 'Q55bb', name: '24-1-A お知らせの中身を編集する',
    verdict: 'needs_fix', verdictNote: 'P1 中身を編集する面が設計とそろわない。差し込みと、届く文の見え方の確認が足りない', verdictSource: 'line-notify-v6/design-qa.md',
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
    /*
      **設計から「開封」を外しました（2026-08-29）。**
      LINEは友だち単位の既読を返しません。設計は「開かれた 3,682通・96.2%」
      「開いていない 140」「読まれた」列を持っていましたが、**どの口からも
      取れない数**です。列は「押された」に変え、短縮URLで数えられるものだけ
      残しました。案内文にも理由を書いてあります。
      控えは `/Volumes/My Passport/Github/pencil-backups/2026-08-29-0400-af63242d.pen-content`。

      **#504 の実装も同じ結論に立っています。**
      「個人の既読は、現在の記録からは取得できません」と画面に出し、
      それを見張る試験まで付いています。
    */
    ...LINE_NOTIFY, node: 'Se65i', name: '24-1-C お知らせの記録',
    gap: 'api',
    gapNote: 'いつ・だれに・どのお知らせを送ったかの記録が要る。読む元は ec_events と messages_log(source=ec_transactional)。**開封は作らない**',
    status: 'unimplemented',
    why: 'いつ・だれに・どのお知らせを送ったかの記録が無い。押された数も出ない。**#504 で実装中**',
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
  { ...AUTOMATION, node: 'gief7', name: '25-1 オートメーション', route: '/automations', verdict: 'needs_fix', verdictNote: 'P1 帯4つ（動いているもの14本／この30日に動いた8,420回／失敗した6回／減らせた手作業およそ70時間）が無い。とくに「減らせた手作業」は、この機能を使い続ける理由を数で出すもの。P1 見本から作る導線が無い（grep 見本 が /automations 配下で0件）。空の作成画面から始めるのと、動く形を1つ手元に置いてから直すのとでは使い始めるまでの距離が違う', verdictSource: 'automations-v6/design-qa.md' },
  { ...AUTOMATION, node: 'Rv8Jv', name: '25-1-A オートメーションをつくる', route: '/automations/new', verdict: 'needs_fix', verdictNote: 'P1 つくる面が設計とそろわない。見本から始める道が無い', verdictSource: 'automations-v6/design-qa.md' },
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
    states: { apis: ['**/api/automations*', '**/api/automations/**'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: 'P1 失敗のときに赤い帯と同時に「オートメーションがありません。「新規ルール」から作成してください。」を出し、作成を誘う。押せば同じルールをもう1つ作る。ルールの数も0件と出る（未取得なので—にすべき）。P2 誘い文の「新規ルール」と実際のボタン名「ルールを作成」が違う。**#516 で直す差分が出ている（未取り込み）**',
    verdictSource: 'automations-v6/Vdbv5-error-1920.png', verdictHead: '75b010fc',
  },
  { ...AUTOMATION, node: 'xOpDs', name: '25-2 共通アクション', route: '/common-actions', verdict: 'needs_fix', verdictNote: 'P2 実装は設計にかなり近い。版（v4）と呼び出し元、古い版のまま呼んでいる先まである。差は、設計がオートメーションと共通アクションを同じタブ帯（5本）にしているのに実装は別ページ（/automations と /common-actions）であること、帯（共通アクション14／呼び出し元38・5機能から／今月2,847回・失敗6／古い版のまま要確認2）が無いこと', verdictSource: 'automations-v6/design-qa.md' },
  { ...AUTOMATION, node: 'py5CG', name: '25-2-A 共通アクションをつくる', route: '/common-actions/new', verdict: 'needs_fix', verdictNote: 'P2 共通アクションをつくる面は設計に近い。差は「複製して作る」の扱いと、上のタブ帯の位置', verdictSource: 'automations-v6/design-qa.md' },
  { ...AUTOMATION, node: 'syWp4', name: '25-2-B 共通アクションの版と使われている場所', route: '/common-actions/versions?id=ca-1', verdict: 'needs_fix', verdictNote: 'P2 版と使われている場所は設計に近く、古い版のまま呼んでいる先まで出せている。差は帯と、タブ帯の位置', verdictSource: 'automations-v6/design-qa.md' },

  // ── 機能26 外部連携 ─────────────────────────────────────
  /*
    設計のタブは4本（こちらから送る6／こちらで受け取る3／やり取りの記録／見本14）。
    実装は2本（受信 (Incoming)／送信 (Outgoing)）で、記録も見本も無い。
  */
  {
    ...WEBHOOK, node: 'k3WxrO', name: '26-1 外部連携',
    verdict: 'needs_fix', verdictNote: 'P1 タブの言葉が英語混じり（設計は「こちらから送る6／こちらで受け取る3／やり取りの記録／見本14」、実装は「受信 (Incoming)／送信 (Outgoing)」）。「やり取りの記録」と「見本」のタブが無い', verdictSource: 'webhooks-v6/design-qa.md',
    steps: [{ click: '送信 (Outgoing)' }],
  },
  { ...WEBHOOK, node: 'M0Gb7', name: '26-1-A こちらで受け取る', verdict: 'needs_fix', verdictNote: 'P1 こちらで受け取る面が設計とそろわない。見本から作る道が無い', verdictSource: 'webhooks-v6/design-qa.md' },
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
    verdict: 'needs_fix', verdictNote: 'P1 失敗のときに赤い帯と同時に「受信Webhookがありません。「新規Webhook」から作成してください。」を出し、作成を誘う。P2 タブが「受信 (Incoming)」「送信 (Outgoing)」と英語を括弧で足しており、誘い文の「新規Webhook」と実際のボタン名「Webhookを追加」も違う。**#515 で直す差分が出ている（未取り込み）**',
    verdictSource: 'webhooks-v6/f8SBSh-error-1920.png', verdictHead: '0389226d',
  },

  // ── 機能27 予約管理 ─────────────────────────────────────
  /*
    設計は台帳（時間×担当の格子）と、電話の代理予約が4枚。
    実装は一覧＋詳細で、**「予約を追加」は押せない**
    （「管理画面から予約を代理で入れる仕組みは準備中です」`bookings/page.tsx:289`）。
  */
  { ...BOOKING, node: 'TV2DI', name: '27-1 予約管理', verdict: 'needs_fix', verdictNote: 'P1 台帳が時間（縦）× 担当（横）の格子になっていない。設計は9:00の行に佐々木・山本・中川の3列があり、どこが空いているかが面で分かる。P1 電話で受けた予約がこの台帳に載らない（「予約を追加」は在るが押せない。bookings/page.tsx:289「管理画面から予約を代理で入れる仕組みは準備中です」）。設計の帯は「今日の予約12件・LINEから9・電話3」で**4件に1件は電話**。載らないので、今日の件数が本当の数にならず、電話とLINEの予約がぶつかっても気づけず、前日・当日のお知らせも送れない', verdictSource: 'booking-v6/design-qa.md' },
  {
    ...BOOKING, node: 'TnDbq', name: '27-1-A 予約の詳細',
    verdict: 'needs_fix', verdictNote: 'P1 予約の詳細の面が設計とそろわない。代理で入れた予約をLINEの予約と同じ扱いにする道（前日・当日のお知らせ、成果地点「予約が入った」を数える）が無い', verdictSource: 'booking-v6/design-qa.md',
    mode: 'viewport', height: 1136, steps: [{ click: '高橋 直人', role: 'text' }],
  },
  /*
    **判定を改めた（PR #459 head `ba0bf62d`）。** 代理予約の画面ができた
    （`/booking/bookings/new`）。ただし**LINEの友だちに限る**。
    「LINE未連携の電話客は、顧客台帳の受け皿ができるまで登録できません。」
  */
  { ...BOOKING, node: 'cpdDi', name: '27-1-B 電話の予約を入れる', route: '/booking/bookings/new',
    verdict: 'needs_fix', verdictNote: 'P1 電話の予約を入れる画面なのに、電話番号もお名前も入れられない。設計は「お名前（LINEにいない方）／電話番号／ペットの名前」を持ち、LINE未連携の人をそのまま登録できる。実装はLINEの友だち検索だけで、未連携は登録できないと断っている（断り方は正直で正しい。足りないのは顧客台帳の受け皿）。P1 お客様に何を送るかを選べない（設計は 受付をすぐLINEに送る／前日19:00に思い出してもらう／当日8:00に「本日おまちしています」の3つのチェック。実装は説明が2つ並ぶだけ）。P2 空き確認の緑帯（何分かかり何時まで押さえるか）、LINEプレビュー、この方について（来店回数・前回の申し送り）、つながる先、保存前の注意文が無い',
    verdictSource: 'booking-v6/cpdDi-1920.png', verdictHead: 'ba0bf62d',
  },
  { ...BOOKING, node: 'SbuUI', name: '27-1-C 今週の予約', steps: [{ click: '今週' }], verdict: 'needs_fix', verdictNote: 'P1 今週の予約の面が設計とそろわない。時間×担当の格子でないため、空きが面で分からない', verdictSource: 'booking-v6/design-qa.md' },
  {
    ...BOOKING, node: 'GFDqW', name: '27-1-D 代理予約・内容確認',
    gap: 'pending',
    gapNote: '#459 head `ba0bf62d` に入力→内容確認→登録完了→競合回復の4段が実装済み。`confirm` 状態を操作して画像確認する',
    status: 'unimplemented', why: '以前の比較は入力状態だけを撮り「確認なし」と誤判定した。同じheadのコードには `Step = input | confirm | done | conflict` と `data-design-node="GFDqW"` があるため、操作を通した再比較待ち',
  },
  {
    ...BOOKING, node: 'GfceK', name: '27-1-E 代理予約・登録完了',
    gap: 'pending',
    gapNote: '#459 head `ba0bf62d` の `done` 状態に実装済み。登録成功レスポンスを返して画像確認する',
    status: 'unimplemented', why: '以前の比較は完了状態まで操作していなかった。同じheadに `data-design-node="GfceK"` があるため再比較待ち',
  },
  {
    ...BOOKING, node: 'Lg8ff', name: '27-1-F 代理予約・予約枠の重なりと入力エラー',
    gap: 'pending',
    gapNote: '#459 head `ba0bf62d` で予約枠の重なり判定と `slot_conflict` / `slot_not_available` の回復画面を実装済み。競合レスポンスで画像確認する',
    status: 'unimplemented', why: '以前の比較は競合レスポンスを返さず未実装と誤判定した。同じheadに `data-design-node="Lg8ff"` とWorkerの競合判定があるため再比較待ち',
  },

  // ── 機能28 予約設定 ─────────────────────────────────────
  /*
    設計のタブは4本（メニュー8／受付枠／休業日／予約のルール）。
    実装はメニューと担当スタッフの2タブで、受付枠と休業日は
    `/booking/staff/shifts` の別ルートにある。
  */
  { ...BOOKING_SET, node: 'QSLEH', name: '28-1 予約設定', verdict: 'needs_fix', verdictNote: 'P1 タブの分けかたが違う。設計は「メニュー8／受付枠／休業日／予約のルール」を1つの帯に並べるが、実装はメニューと担当スタッフの2タブで、**受付枠と休業日は /booking/staff/shifts の別ルート**。予約管理の画面からは飛べるが、予約設定の画面のタブには出てこない。「予約のルール」（先の予約が取れる範囲・締め切り・キャンセル期限）は BookingMenu が持っている（booking_window_days / cutoff_hours_before / cancel_deadline_hours_before）のに、**メニューごとに散っていてまとめて見る場所が無い**。P2 帯が設計と違う（設計は 出しているメニュー6つ／いちばん選ばれた トリミング小型犬142件／受け付けている時間9:00〜19:00／先の予約が取れる範囲60日先まで）。枠の稼働率が—なのは、受付時間の総枠数を数える仕組みが無いためで、正直な出し方', verdictSource: 'booking-settings-v6/design-qa.md' },
  { ...BOOKING_SET, node: 'tksPc', name: '28-1-A 受付枠と休業日', route: '/booking/staff/shifts', verdict: 'needs_fix', verdictNote: 'P1 受付枠と休業日が予約設定のタブではなく /booking/staff/shifts の別ルートにある', verdictSource: 'booking-settings-v6/design-qa.md' },
  { ...BOOKING_SET, node: 'GhOb3', name: '28-1-B 予約メニューをつくる', route: '/booking/menus/new', verdict: 'needs_fix', verdictNote: 'P1 予約メニューをつくる面が設計とそろわない。予約のルールをメニューの中だけで決める形になっている', verdictSource: 'booking-settings-v6/design-qa.md' },
  {
    ...BOOKING_SET, node: 'W6465r', name: '28-1-C 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/booking/admin/menus*', '**/api/booking/admin/staff*'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: 'P1 失敗の知らせが「API error: 500」とそのまま出る。P1 赤い帯と同時に「まだメニューがありません。上の「メニューを追加」から登録してください。」を出し、帯も0件・0人・0件と数える（未取得なので—にすべき）。P2 「旧デザインでは「メニュー」と「スタッフ」が別ページに分かれていました。」という作り替えの覚え書きが、運用の人に見える場所へ残っている',
    verdictSource: 'booking-settings-v6/W6465r-error-1920.png', verdictHead: 'bd8efa54',
  },

  // ── 機能29 イベント予約 ─────────────────────────────────
  { ...EVENT, node: 'ugP5y', name: '29-1 イベント予約', verdict: 'needs_fix', verdictNote: 'P1 帯が「数」で「次に何をするか」になっていない。設計の3つめ「あと少しで満席 2回（声をかけると埋まります）」と4つめ「申し込みが少ない 1回（8/31の回。あと3日です）」は、そのまま行動になる帯。実装の「定員の充足 55%」は全体の平均で、**どの回が危ないかは分からない**', verdictSource: 'events-v6/design-qa.md' },
  { ...EVENT, node: 'MKrPY', name: '29-1-A イベントをつくる', route: '/events/new', verdict: 'needs_fix', verdictNote: 'P1 イベントをつくる面が設計とそろわない。キャンセル待ちを受ける設定はできるが、待っている人を数える場所が無い', verdictSource: 'events-v6/design-qa.md' },
  { ...EVENT, node: 'i5SN2j', name: '29-1-B 申込者の一覧', route: '/events/bookings?id=ev-1', verdict: 'needs_fix', verdictNote: 'P1 キャンセル待ちの人を数えられない（events/bookings/page.tsx:212「event_bookings に「キャンセル待ち」という状態が無い。イベント側に waitlist_enabled はあるが、待っている人を数える場所がまだない」）。設計はそこを主役に置き「キャンセル待ち3人（1人 取り消すと1人 回ります）」「24時間 返事がなければ次の方に回ります」と出す。**満席の回で取り消しが出たとき、次に誰へ声をかければいいのか分からない**', verdictSource: 'events-v6/design-qa.md' },
  {
    ...EVENT, node: 'k5m5Bc', name: '29-1-C 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/events/admin/events*', '**/api/events/admin/events/**'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: 'P1 失敗の知らせが「API error: 500」とそのまま出る。P1 赤い帯と同時に「イベントがまだありません／最初のイベントを作成」を出し、帯も0件・0人・0件と数える（未取得なので—にすべき）',
    verdictSource: 'events-v6/k5m5Bc-error-1920.png', verdictHead: '6bb950f3',
  },

  // ── 機能30 ログインユーザー ─────────────────────────────
  /*
    設計のタブは4本（いまいる人8／招待中2／入った記録／権限のかたまり5）。
    実装は1枚もの。
  */
  { ...STAFF, node: 'e3jz3', name: '30-1 ログインユーザー', verdict: 'needs_fix', verdictNote: 'P1 一覧に「最後に入った」の列が持てない。StaffMember は createdAt / updatedAt / inviteStatus は持つが **lastLoginAt を持たない**。設計の帯「90日 入っていない 1人（辞めた方かもしれません）」も同じ理由で出せない。**辞めた人のログインが生きたまま残る、という形で表に出る**。実装の帯の「最終ログイン」は全体でいちばん新しい1件で、人ごとではない', verdictSource: 'staff-v6/design-qa.md' },
  {
    ...STAFF, node: 'EOTS4', name: '30-1-A 見せる範囲を決める',
    verdict: 'needs_fix', verdictNote: 'P1 見せる範囲を決める面が設計とそろわない', verdictSource: 'staff-v6/design-qa.md',
    mode: 'viewport', height: 1080, steps: [{ click: '高田 誠', role: 'text' }],
  },
  /*
    **判定を改めた（PR #475 head `15febf7f`）。** 「入った記録」のタブができた。
    ただしタブは2本（ログインユーザー／入った記録）で、設計の4本のうち
    「招待中」「権限のかたまり」はまだ無い。
  */
  { ...STAFF, node: 'jwVlo', name: '30-1-B 入った記録', route: '/staff?tab=audit',
    verdict: 'needs_fix', verdictNote: 'P1 「入った記録」が記録の一覧ではない。staff/page.tsx:114 が記録ではなくログインユーザーを繰り返し、1人につき1行「最後の操作」を出すだけなので、過去の操作を追えない。設計は4,286件を新しい順に並べる。P1 記録できる操作が5種類（ログイン・ログアウト・ログイン失敗・個人情報を表示・CSVを書き出し。ACTION_LABEL）しかなく、設計の「テンプレートを消しました」「マイルを手で増やしました」「一斉配信を出しました」「外部連携を止めました」は口が持っていない。P2 「対象」と「元の値 → 新しい値」の列が無く、何がどう変わったか分からない。いつもと違う場所からのログインを赤く出す扱いも無い。帯・絞り込みチップ・CSV・ページ送りも無い',
    verdictSource: 'staff-v6/jwVlo-1920.png + apps/web/src/app/staff/page.tsx:114', verdictHead: '15febf7f',
  },
  { ...STAFF, node: 'I3ZSrU', name: '30-1-C 人を招待する', route: '/staff/new', verdict: 'needs_fix', verdictNote: 'P1 人を招待する面が設計とそろわない。招待の状態（招待中・期限切れ）と、見せる範囲を招待時に決める流れが設計どおりに並んでいない', verdictSource: 'staff-v6/design-qa.md' },

  // ── 機能31 機能設定 ─────────────────────────────────────
  { ...FEATURE_SET, node: 'c4R6F', name: '31-1 機能設定', verdict: 'needs_fix', verdictNote: 'P2 区分ごとの箱・グループごと切替・「必須」の錠前・右のプレビュー・初期値に戻す/保存・オフにしてもデータは残る説明は設計どおり。実装の説明はむしろ設計より具体的（APIも動いたままで管理画面から隠れるだけ、と書いてある）。差は並べ替えの置き場所ほか4点で、詳しくは settings-v6/design-qa.md', verdictSource: 'settings-v6/design-qa.md' },

  // ── 機能32 運用状態 ─────────────────────────────────────
  /* タブ3本は設計とそろっている（健全性チェック／緊急コントロール／更新履歴）。 */
  { ...OPERATIONS, node: 'UgonK', name: '32-1 運用状態・健全性チェック', route: '/emergency?tab=health', verdict: 'needs_fix', verdictNote: 'P1 健全性の6項目（LINE接続・月間配信数ほか）を、項目ごとに「確認する内容／結果／いまの数字／目安／最後の確認／中身を見る」で常に並べる形になっていない。「5分ごとに自動確認」「次は11:50に自動で確かめます」も無い', verdictSource: 'operations-v6/design-qa.md' },
  { ...OPERATIONS, node: 'b3HfZ', name: '32-1-A 緊急コントロール', route: '/emergency?tab=control', verdict: 'needs_fix', verdictNote: 'P1 止める前に、何件・何人に効くかが出ない。設計は「予約中の一斉配信 1件（8/28 20:00 ／ 対象8,486人）」「シナリオ配信 4本 ／ 486人が進行中」「リマインダ 10本 ／ 明日の予約12件ぶん」と数で出す。実装は「停止対象を実行直前に取得します。」と書くだけで、**押すまで何を止めることになるのか分からない**。緊急停止は急いでいるときに押すものなので、そこを数で確かめられる必要がある。タブ3本・止めるものの選択・対象アカウント・停止理由・復旧は設計どおり', verdictSource: 'operations-v6/design-qa.md' },
  { ...OPERATIONS, node: 'UhC2O', name: '32-1-B 更新履歴', route: '/emergency?tab=history', verdict: 'needs_fix', verdictNote: 'P1 緊急操作の履歴が localStorage（この端末に保存された履歴）で、画面にもそう書いてある。設計は「だれが いつ 何を止めたかが残ります」「消せません」と決めている。**端末を変えると読めず、消せてしまう**。P2 帯が設計と違う（設計は 止めた回数3回／いちばん長かった停止70分／管理画面の更新28回／いまの版 2026.08.25-1）。表の列（いつ・だれが・止めたもの・対象・理由・戻した）もそろわない', verdictSource: 'operations-v6/design-qa.md' },
  {
    ...OPERATIONS, node: 'U0BwS', name: '32-1-C 緊急停止の最終確認',
    verdict: 'needs_fix', verdictNote: 'P2 最終確認の窓と「確認のため『停止』と入力」は設計どおりで、**押し間違いでは起きない形になっている（設計に無い上乗せ）**。残る差は、止める対象の件数・人数が窓にも出ないこと', verdictSource: 'operations-v6/design-qa.md',
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
  { node: 'QKx8Q', feature: 4, name: '4-4 保存した検索', dir: 'friend-attributes-v6', route: '/tags?tab=searches', mode: 'page', verdict: 'needs_fix', verdictNote: 'P1 設計の帯4つが無い（保存した条件12件・上限50件／配信で使用中5件／該当者0人2件／今月の呼び出し84回）。P2 友だち情報の項目名がキーのまま。eq の言い回しが設計とそろわない。**使用先・該当と、条件が eq mark-1 と出ていた件は #421 で直って解決している**', verdictSource: 'friend-attributes-v6/design-qa-searches-421.md' },

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
    verdict: 'needs_fix', verdictNote: 'P1 対応マークとシナリオが、いまもIDの手入力。P1 50件の上限と共有の意味が編集画面に出ない', verdictSource: 'friend-attributes-v6/design-qa-searches-421.md',
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
  6: [
    { pr: 497, head: '84e5bab9', on: '2026-08-28', screens: ['FpgxH'], note: 'Claudeが作ったDraft。#495 の上に積んである' },
    {
      pr: 503, head: '6db5ad7f', on: '2026-08-28',
      screens: ['q76C35', 'zZ9fA', 'XQfMD', 'p97Tf', 'Bw0zt', 'vW4Es', 'u6gHt', 'EGMb1', 'xkRDb', 'TmHjF'],
      note: '固定データ（配信の帯・1件の配信）を足して撮り直した。**`FpgxH` は #497 の絵に戻した。** 機能ごと撮り直すと、別のPRで直った1枚が直る前に戻る',
    },
  ],
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
  5: [
    { pr: 503, head: '6db5ad7f', on: '2026-08-28', screens: ['M2b2B'], note: '新しい口は足さず既存の統計を読む' },
    {
      pr: 503, head: '6db5ad7f', on: '2026-08-28', screens: ['xfYLn', 'hz9ti'],
      note: '撮り方が別の画面に当たっていたので直して撮り直した。固定データの `reachRate` を直したので `NaN%` も消えた',
    },
  ],
  25: [{ pr: 502, head: '75b010fc', on: '2026-08-28', screens: ['DkPY0'], note: '#502 は #500 を含む。新しい表は作らず既存の automation_runs を読む' }],
  18: [{ pr: 443, head: 'f372ff30', on: '2026-08-28' }],
  19: [{ pr: 444, head: 'ccbd0975', on: '2026-08-28' }],
  20: [{ pr: 445, head: '787a4b46', on: '2026-08-28' }],
  21: [{ pr: 446, head: '4307088d', on: '2026-08-28' }],
  22: [{ pr: 447, head: '65adbc59', on: '2026-08-28' }],
}
