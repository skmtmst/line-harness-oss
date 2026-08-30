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
    verdict: 'structure_match_data_pending', verdictNote: '**#419 `c84baa63` で撮った。** 「今日やること」の札は 対応が必要な受信 **5件**（LINE 1・メール 4／最長 6日7時間50分）／写真審査 **1件**（確認待ち1・ポイント付与あり）／今日の予約 **0件**（次回 09:00）／出荷予定 **0件**（EC通知から算出）。**数えて0のものは `0件`** で出し、空の札には「出荷予定はまだありません。ECから注文や定期便の通知を受け取ると、ここに並びます。」と**次に何が起きれば埋まるか**を書く。壊れ値・内部語は0件、1440・1920とも横スクロール0。**設計との突き合わせは、通知パネルの実データがつながってから**（#419 がその接続。パネルは押して開く形なので、この行では開いていない）', verdictSource: 'dashboard-v6/vUXKb.txt',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
    verdictHead: 'c84baa63',
  },
  {
    node: 'ZN0ov', feature: 1, name: '1-1-1 ダッシュボード編集',
    verdict: 'structure_match_data_pending', verdictNote: '**#419 `c84baa63` で撮った。** 壊れ値・内部語は0件、1440・1920とも横スクロール0。設計との突き合わせは通知パネルの実データがつながってから', verdictSource: 'dashboard-v6/ZN0ov.txt',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
    steps: [{ click: 'ダッシュボード編集' }],
    verdictHead: 'c84baa63',
  },
  {
    node: 'JN6mQ', feature: 1, name: '1-1-2 友だち追加QR',
    verdict: 'structure_match_data_pending', verdictNote: '**#419 `c84baa63` で撮った。** 壊れ値・内部語は0件、1440・1920とも横スクロール0。設計との突き合わせは通知パネルの実データがつながってから', verdictSource: 'dashboard-v6/JN6mQ.txt',
    dir: 'dashboard-v6', route: '/', mode: 'viewport', height: 1668, clock: DASHBOARD_CLOCK,
    steps: [{ click: 'QRを表示' }],
    verdictHead: 'c84baa63',
  },
  {
    node: 'NjK9q', feature: 1, name: '1-1-3 対応受信の表示件数を開く',
    verdict: 'structure_match_data_pending', verdictNote: '**#419 `c84baa63` で撮った。** 壊れ値・内部語は0件、1440・1920とも横スクロール0。設計との突き合わせは通知パネルの実データがつながってから', verdictSource: 'dashboard-v6/NjK9q.txt',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
    steps: [{ click: '表示件数' }],
    verdictHead: 'c84baa63',
  },
  {
    node: 'Alekb', feature: 1, name: '1-1-4 通知パネルを開く',
    verdict: 'structure_match_data_pending', verdictNote: '**#419 `c84baa63` で撮った。** 壊れ値・内部語は0件、1440・1920とも横スクロール0。設計との突き合わせは通知パネルの実データがつながってから', verdictSource: 'dashboard-v6/Alekb.txt',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
    steps: [{ click: '通知' }],
    verdictHead: 'c84baa63',
  },

  // ── 機能2 受信箱 ────────────────────────────────────────
  { ...INBOX, node: 'xGLVe', name: '2-1 受信箱', steps: OPEN_CHAT, verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮り、設計の記述と突き合わせた。** 一覧・トーク・顧客情報の3カラムは設計どおり。**前に挙げた4点のうち3点が直っている**（見出しのアバターが頭文字を出す／副題の並び／担当と対応が専用の選び口になった）。P2 残る差はトークの見出し行に集まる——★が無い、シナリオの札にアイコンが無く日時が札の中、受信の吹き出しに最小幅が無い。P2 見出しの副題に**本名がまだ出ない**（この部品が友だちの詳細を持っていないため。データ未接続）。1440・1920とも横スクロール0', verdictSource: 'inbox-v6/xGLVe.txt + inbox-v6/design-qa.md' , verdictHead: 'c275749d' },
  {
    ...INBOX, node: 'NfgOs', name: '2-2 テンプレート選択',
    steps: [...OPEN_CHAT, { click: '▧ テンプレートを選択' }],
    verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮った。** P2 テンプレート選択の面が設計とそろわない（絞り込みと、選んだあとの差し込みの見え方）。1440・1920とも横スクロール0',
    verdictSource: 'inbox-v6/NfgOs.txt + inbox-v6/design-qa.md', verdictHead: 'c275749d',
  },
  {
    ...INBOX, node: 'H3lAOB', name: '2-3 顧客情報パネル非表示',
    steps: [...OPEN_CHAT, { click: '顧客情報を閉じる' }],
    verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮った。** 顧客情報パネルを閉じた形は出る。P2 設計との差は、閉じたときのトーク幅の広がり方。1440・1920とも横スクロール0',
    verdictSource: 'inbox-v6/H3lAOB.txt + inbox-v6/design-qa.md', verdictHead: 'c275749d',
  },
  {
    ...INBOX, node: 'Xi4x9', name: '2-4 右パネル表示設定',
    steps: [...OPEN_CHAT, { click: '表示項目' }],
    verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮った。** P2 右パネルの表示設定が設計とそろわない（項目ごとの出し入れ）。1440・1920とも横スクロール0',
    verdictSource: 'inbox-v6/Xi4x9.txt + inbox-v6/design-qa.md', verdictHead: 'c275749d',
  },
  // 未読の会話が並んだ状態。開かずにそのまま撮る。
  { ...INBOX, node: 'f0zn6', name: '2-5 新着・担当者別未読',
    verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮った。** P2 新着・担当者別未読の面が設計とそろわない（担当ごとの束ね方）。1440・1920とも横スクロール0',
    verdictSource: 'inbox-v6/f0zn6.txt + inbox-v6/design-qa.md', verdictHead: 'c275749d',
  },
  {
    ...INBOX, node: 'NWbuF', name: '2-6 テンプレート・全フォルダ展開',
    steps: [...OPEN_CHAT, { click: '▧ テンプレートを選択' }, { click: 'フォルダ' }],
    verdict: 'needs_fix', verdictNote: '**P2 テンプレート選択のフォルダ分けが無い。** ルート `/chats`（トーク→「▧ テンプレートを選択」）。設計はフォルダで絞ってから選ぶ。実装は「フォルダ」の押し口が本文に無い（撮影の段が「フォルダ」を押せず0件）。**撮影の段が古い**ので、開いたあとの面はまだ撮れていない——段を直してから詰める。1440・1920とも横スクロール0',
    verdictSource: 'inbox-v6/design-qa.md', verdictHead: 'c275749d',
  },
  {
    ...INBOX, node: 'B7CER8', name: '2-7 内部メモ入力',
    steps: [...OPEN_CHAT, { click: '内部メモ' }],
    verdict: 'needs_fix', verdictNote: '**P2 内部メモの面が設計とそろわない。** ルート `/chats`（トークを開いて「内部メモ」）。設計はメモに**書いた人と時刻**が残り、あとから誰が書いたか分かる。取得元：`inbox-v6/B7CER8.txt`。1440・1920とも横スクロール0。**この行の撮影は、いまトークを開く前で止まっている**（開いたあとの面を撮るには段の直しが要る）',
    verdictSource: 'inbox-v6/B7CER8.txt', verdictHead: 'c275749d',
  },
  /*
    2-8 / 2-9 / 2-10 は「プルダウンを開いた状態」。素のセレクトのままだと
    開いた中身がブラウザ任せで**画像に写らない**ので、専用の部品へ替えた
    （`components/chats/inbox-dropdown.tsx`）。
    2-8 は一覧の絞り込み、2-9 は会話の見出し、2-10 は対応マーク。
  */
  {
    ...INBOX, node: 'YZaDK', name: '2-8 担当者プルダウンを開く',
    /* **「担当者で絞り込む」は選ぶ口**（ボタンではない）。 */
    steps: [{ select: '担当者で絞り込む', label: 'Kenta' }],
    verdict: 'needs_fix', verdictNote: '**P2 担当者の絞り込みが素の `<select>` のまま。** ルート `/chats`。選択肢は すべて／未割り当て／Masato／Kenta。設計は担当ごとの未読数を添えた専用の選び口（「Kenta 3」のように、選ぶ前に**どこに何件たまっているか**が分かる形）。実装は名前だけで数が出ない。帯は 要返信1件（最長1時間12分待ち）／自分が担当0件／今日の受信0件／メール0件／期限超過1件 と**数えて0を `0件` で出す**のは正しい。取得元：`inbox-v6/YZaDK.txt`。1440・1920とも横スクロール0',
    verdictSource: 'inbox-v6/YZaDK.txt', verdictHead: 'c275749d',
  },
  {
    ...INBOX, node: 'L35UOV', name: '2-9 担当者変更を開く',
    steps: [...OPEN_CHAT, { click: '担当者を変える' }],
    verdict: 'needs_fix', verdictNote: '**P2 担当者の変更が、設計の専用の選び口になっていない。** ルート `/chats`。**#492 の前の記録では「担当者を変える」ボタンがあったが、いまは無い**（撮影の段が0件）。担当の変更は右上の選び口へ移ったとみられる。段を直してから詰める。1440・1920とも横スクロール0',
    verdictSource: 'inbox-v6/design-qa.md', verdictHead: 'c275749d',
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
    verdict: 'needs_fix', verdictNote: '**P2 `NWbuF` と同じ面の続き。** ルート `/chats`。**撮影の段が古く**「フォルダ」を押せない（0件）。段を直してから詰める。1440・1920とも横スクロール0',
    verdictSource: 'inbox-v6/design-qa.md', verdictHead: 'c275749d',
  },
  { ...INBOX, node: 'w72a2', name: '2-12 絞り込みを開く', steps: [{ click: '絞り込み' }],
    verdict: 'needs_fix', verdictNote: '**P2 絞り込みの面。** ルート `/chats`。**撮影の段が古く**「絞り込み」を押せない（0件）。本文には「絞り込み」の語があるので、押せる形が変わったとみられる。段を直してから詰める。**この画面は束3の手本**（押せないときに理由を書く形）として記録してある。1440・1920とも横スクロール0',
    verdictSource: 'inbox-v6/design-qa.md', verdictHead: 'c275749d',
  },
  { ...INBOX, node: 'ASsb3', name: '2-13 保存した検索を開く', steps: [{ click: '保存した検索' }],
    verdict: 'needs_fix', verdictNote: '**P1 保存した検索の中身と件数が出ず、名前だけ並ぶ。** ルート `/chats`（「保存した検索」）。設計は名前の下に**条件（対応マーク・期限など）と、いま何件あたるか**を出す。**中身が見えないと、どれを押せばよいか名前から推測することになる。** P2 よく使うの★と「…」（名前を変える・消す）が無く、削除が赤字で直に並ぶ——**押し間違いが起きやすい並び**。取得元：`inbox-v6/ASsb3.txt`。1440・1920とも横スクロール0',
    verdictSource: 'inbox-v6/ASsb3.txt', verdictHead: 'c275749d',
  },
  /*
    2-14 → 2-15 → 2-16 → 2-17 は一続きの流れ。
    「この条件を保存」で `Ln4zS` のモーダルを開き、名前を入れて保存する。
    エラーは空のとき・同じ名前のときで文を変える。
  */
  {
    ...INBOX, node: 'ANgda', name: '2-14 保存した検索名を入力',
    steps: [{ click: '保存した検索' }, { click: 'この条件を保存' }],
    verdict: 'needs_fix', verdictNote: 'P1 「保存する条件」が読むだけで変えられない（設計は対応マーク・期限・受信経路・担当者の4つを選び直せる。実装は 対応マーク／担当者／受信経路 の3行が値を表示するだけ）。期限の行が無い。P2 「よく使うに追加」の切替と「件数は自動更新される」注記が無い。**#555 `e873eeb9` で撮り直したが、この窓の作りは変わっていない**（#555 は未入力エラーの出し方だけを直した。そちらは `AuSDY` を見る）',
    verdictSource: 'inbox-v6/ANgda-1440.png', verdictHead: 'e873eeb9',
  },
  {
    ...INBOX, node: 'tBlkL', name: '2-15 保存した検索・保存完了',
    steps: [
      { click: '保存した検索' }, { click: 'この条件を保存' },
      { fill: '検索名', text: '未対応・期限超過' }, { click: 'この条件を保存', nth: 1 },
    ],
    verdict: 'needs_fix', verdictNote: '**P0は #513 で解決した。** 保存に失敗したとき、窓は「保存しました」へ進まず、窓の中に文を出して開いたまま残る。APIの番号（405）も素通ししていない。**#555 `e873eeb9` で撮り直した**——失敗の文が赤い帯（`Notice tone="error"`）に替わり、`AuSDY` `LHjwD` と同じ見え方でそろった。ただし**設計のこのNodeは「保存完了」の画面**で、画面確認では書き込みを常に405で止める決めごとのため、完了の絵そのものは撮れない。窓の作りの残る差は `ANgda` と同じ（保存する条件を窓の中で変えられない・期限の行が無い・よく使うに追加が無い）',
    verdictSource: 'inbox-v6/tBlkL-1440.png + apps/web/src/components/chats/saved-view-dialog.tsx', verdictHead: 'e873eeb9',
  },
  {
    ...INBOX, node: 'AuSDY', name: '2-16 保存した検索名・未入力エラー',
    steps: [
      { click: '保存した検索' }, { click: 'この条件を保存' },
      { click: 'この条件を保存', nth: 1 },
    ],
    verdict: 'needs_fix', verdictNote: '**#555 `e873eeb9` で、記録していたP2が両方直った。** 未入力のとき **赤い帯**（`Notice tone="error"`、×印つき）で「検索名を入力してください」と出し、**保存ボタンは押せなくなる**（`disabled={saving || nameMissing}`）。入力欄も赤枠になり `aria-invalid`／`aria-describedby` が付くので、読み上げでも同じことが伝わる。設計の「赤い帯の注意書きと、押せない保存ボタン」とそろった。1440・1920とも横スクロール0。P2 残るのは `ANgda` と同じ窓の作り（保存する条件を窓の中で変えられない・期限の行が無い）',
    verdictSource: 'inbox-v6/AuSDY-1440.png', verdictHead: 'e873eeb9',
  },
  {
    ...INBOX, node: 'LHjwD', name: '2-17 保存した検索名・重複エラー',
    steps: [
      { click: '保存した検索' }, { click: 'この条件を保存' },
      { fill: '検索名', text: 'VIPかつ未契約' }, { click: 'この条件を保存', nth: 1 },
    ],
    verdict: 'needs_fix', verdictNote: '**#555 `e873eeb9` で、重複エラーも入力欄の下の文から赤い帯へ変わった**（同じ `Notice` を使うため）。設計の「赤い帯」とそろった。保存ボタンは押せたままだが、これは正しい——名前を変えれば保存できるので、押せなくする理由がない（未入力とは違う）。1440・1920とも横スクロール0。P2 文言はまだ設計と違う（設計「同じ名前の保存した検索があります。別の名前を入力してください。」／実装「同じ名前の検索がすでにあります。別の名前にしてください」）',
    verdictSource: 'inbox-v6/LHjwD-1440.png', verdictHead: 'e873eeb9',
  },

  // ── 機能3 友だち ────────────────────────────────────────
  { ...FRIENDS, node: 'PhxG6', name: '3-1 友だち',
    verdict: 'needs_fix', verdictNote: '**P2 友だち一覧の作りが設計とそろわない。** ルート `/friends`。タブは 友だち一覧／重複検出／統合ユーザー／UID移行 で、帯に 有効友だち・ブロック非表示・未対応・今月の追加。設計との差は列の並びと絞り込みの位置。**#520 で失敗のときの帯が `—人` になった**（束1・束4は解決済み）。取得元：`friends-v6/PhxG6.txt`。1440・1920とも横スクロール0',
    verdictSource: 'friends-v6/PhxG6.txt', verdictHead: 'c275749d',
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
    verdict: 'needs_fix', verdictNote: '**P2 詳細条件の組み立てが設計とそろわない。** ルート `/friends`（詳細条件）。設計は入れ子の and/or を作れる。取得元：`friends-v6/Igi72.txt`。1440・1920とも横スクロール0',
    verdictSource: 'friends-v6/Igi72.txt', verdictHead: 'c275749d',
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
    verdict: 'needs_fix', verdictNote: '**P2 友だち詳細が設計とそろわない。** ルート `/friends/detail?id=friend-1`。撮った本文は「追加 2026/8/13／非表示／ブロック／個別トークを開く」。設計は来店回数・前回の申し送り・つながる先をその場で出す。取得元：`friends-v6/I6UAdr.txt`。1440・1920とも横スクロール0',
    verdictSource: 'friends-v6/I6UAdr.txt', verdictHead: 'c275749d',
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
    verdict: 'needs_fix', verdictNote: '**#520 `4848a8f3` で、束1と束4の完了条件を満たした。** 失敗のとき帯は **有効友だち `—人`／ブロック・非表示 `—人`／未対応 `—人`／今月の追加 `—人`** で、補助の数も `—`。**「友だち一覧 0件」と数えなくなった**（未取得と0件を区別している）。読込・空・失敗が分かれる。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の一覧の作り（列と絞り込みの並び）はこの直しの外。**#520 は `codex/development` 直結の根元PR**なので、親の統合を待たずに取り込める',
    verdictSource: 'friends-v6/bzDn6-error.txt', verdictHead: '4848a8f3',
  },
  { ...FRIENDS, node: 'YzxU1', name: '3-2 重複検出', route: '/friends?tab=duplicates',
    verdict: 'needs_fix', verdictNote: '**P2 重複検出の面が設計とそろわない。** ルート `/friends?tab=duplicates`。帯は 友だち総数231／ユニ…。設計は候補ごとに根拠と確信度を出して1件ずつ判定する（`InCDe` が未実装で、その手前まで）。取得元：`friends-v6/YzxU1.txt`。1440・1920とも横スクロール0',
    verdictSource: 'friends-v6/YzxU1.txt', verdictHead: 'c275749d',
  },
  {
    ...FRIENDS, node: 'InCDe', name: '3-2-A 重複候補詳細・統合前確認',
    route: '/friends?tab=duplicates', gap: 'api',
    gapNote: '集計口だけでは作れない。候補ID、友だち2件、根拠、確信度、pending/linked/different/deferred/invalidated、判定者・理由・履歴を持つ `identity_candidates` と候補詳細・判定APIが要る',
    status: 'unimplemented',
    why: '現行 `/api/duplicates/stats` はアカウント別件数と重複マトリックスだけを返し、候補行・根拠・判定状態を返さない。正式要件 §9・§11・§14 が候補台帳と判定APIを要求しているため、画面の導線追加だけでは完成しない',
  },
  {
    /*
      **中身は `/users` の画面**（`app/friends/page.tsx:426` が
      `MergedUsersPage` を埋め込む）。#565 が変えたのはそちらのファイル。
      空・読込・失敗も見る。
    */
    ...FRIENDS, node: 'r7eSi', name: '3-3 統合ユーザー', route: '/friends?tab=merged',
    states: {
      apis: ['**/api/users-grouped*', '**/api/duplicates/stats*'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
    verdict: 'needs_fix', verdictNote: '**#565 `ea2e730d` で、記録していたP1が直った。通常・読込・空・失敗を撮り、押して確かめた。** ①**内部の統合キーが消えた**——`identity-0` も `url_token` / `uid` / `solo` も本文に0件。②**設計の7列になった**——統合ユーザー／連絡先／紐付くアカウント／UID／最終接触／重複配信／操作。③**複数アカウントを配信済みと決めつけない**——重複配信は「要確認」「対象外」で、紐付きは「要確認」「UIDで連携」「未連携」。④**未取得と0件を分ける**——連絡先の無いところは `—`（メール未登録は「未登録」）、失敗のとき件数は **`—人`**、空のときは **「0人中 0〜0人」**。⑤**「詳細を見る」は実際に開く**——押すと同じ行の下に 登録アカウント詳細（アカウントごとのUIDと登録日）・メール（フォーム回答）・電話（フォーム回答）・連携の状態 が出て、ボタンは「閉じる」に変わる。新しい口は呼ばない（既に読んだ値を開くだけ）。⑥**「再計算」は本当に読み直す**——`GET /api/users-grouped?...&refresh=1` を投げる。1440・1920とも横スクロール0。`undefined` / `NaN` / `API error` は無い。**P2 失敗のとき、上の4枚（統合ユーザー・紐付く友だち・重複している行・重複率）が空の箱のまま**になり、読み込み中と見分けがつかない。`SummaryBar` は `stats` が `null` のとき骨組みだけを描き、失敗の状態を持っていない（`components/users/summary-bar.tsx:29`）。表のほうは `—人` と断っているので、帯もそろえてほしい。P2 統合ユーザーを作る導線はまだ無い',
    verdictSource: 'friends-v6/r7eSi-normal.txt + r7eSi-error.txt', verdictHead: 'ea2e730d',
  },
  {
    ...FRIENDS, node: 'w8W4Eh', name: '3-3-A 統合ユーザー詳細',
    route: '/friends?tab=merged', gap: 'api',
    gapNote: '元の友だちを残した非破壊リンク、解除履歴、項目ごとの採用値と出所、配信優先順位を扱う `friend_identity_links`・`user_profile_values`・`user_delivery_priorities` と詳細APIが要る',
    status: 'unimplemented',
    why: '現行の統合一覧は集計表示までで、設計が求める友だちの関連付け・解除、プロフィール競合、採用元、配信優先順位を保存・更新する口が無い。正式要件 §10・§11・§14 が新しい履歴付きモデルを要求している',
  },
  {
    ...FRIENDS, node: 'vtBCu', name: '3-4 UID移行', route: '/accounts?tab=migration',
    gap: 'api',
    gapNote: '異なるLINEプロバイダー間のUID自動変換はできない。検証済み対応表の取込、dry-run、競合判断、本移行、照合、切り戻しを持つ `uid_migration_runs/items` とowner・二者確認APIが要る',
    status: 'unimplemented',
    why: '`/accounts` の権限を通すだけでは、設計のdry-run・全競合判断・影響確認・切り戻しを実行できない。正式要件 §12・§14 が専用run/itemと実行APIを要求し、LINE APIだけでは対応表を作れないと明記している',
  },

  // ── 機能5 シナリオ配信 ──────────────────────────────────
  { ...SCENARIO, node: 'TC1b1', name: '5-1 シナリオ配信', route: '/scenarios',
    verdict: 'needs_fix', verdictNote: '**#529 が `codex/development` 直結へ張り替わり、head も `4cb2b0d9` → `a3511980` へ動いた。撮り直していない**——`scenarios/page.tsx` の blob が同一。束6の完了条件を満たす：読了済 728人 に **「登録合計 1,756人のうち 41%」** と母数を明記する（728÷1,756＝41%で合う）。購読中にも「現在配信中・重複を含む」と断りが付く。**#427 単体ではこの直りが入らない**（#427 も直結へ張り替わったため）ので、取り込み順は **#427 → #529**。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の一覧の作り（シナリオごとの離脱地点、フォルダの色）はこの直しの外',
    verdictSource: 'scenarios-v6/TC1b1.txt', verdictHead: 'a3511980',
  },
  { ...SCENARIO, node: 'cCB7r', name: '5-1-A シナリオ作成・配信方式', route: '/scenarios/mode?id=scenario-0',
    verdict: 'needs_fix', verdictNote: '**#569 `92f03199` で配信方式の選択が入った。** 「シナリオ「新規登録7日間フォロー」を作成しました。続けて配信方式を選んでください。」と、**いま何が済んで次に何をするか**を書く。段の表示（✓シナリオ情報 → 2 配信方式 → 3 1通目）があり、「あとから変更できますが、**設定済みのステップは作り直しになります**」と、戻れないわけではないが手戻りが出ることを先に断る。内部語・壊れ値は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計は配信方式ごとの見本（何日後・何時・くり返し）をその場で見せる。実装は選ぶところまで',
    verdictSource: 'scenarios-v6/cCB7r.txt', verdictHead: '92f03199',
  },
  { ...SCENARIO, node: 'kk8dz', name: '5-1-B シナリオ作成・1通目設定', route: '/scenarios/first-step?id=scenario-0',
    verdict: 'needs_fix', verdictNote: '**P2 ステップの作成が設計とそろわない。** ルート `/scenarios/new`。撮った本文は「ステップの作成／シナリオの名前と、い…」の1枚。設計は 名前 → 配信方式 → 1通目 の段で、**#569 が配信方式の段（`cCB7r`）を足した**ので、取り込み後に段が通るか見直す。取得元：`scenarios-v6/kk8dz.txt`。1440・1920とも横スクロール0',
    verdictSource: 'scenarios-v6/kk8dz.txt', verdictHead: 'c275749d',
  },
  { ...SCENARIO, node: 'bV5Vs', name: '5-1-C シナリオ編集', route: EDIT,
    verdict: 'needs_fix', verdictNote: '**#427 `5f09837c` で撮り直した。`NaN%` は0件**（到達率の直し自体は #534 `0158ba8e`。#427 でも壊れていない）。内部語・`undefined`・`Invalid Date` も0件。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 一覧に配信対象の列が無く、配信後がどの行も `—`。設計の注意帯（作成しただけでは配信されません…）が無い',
    verdictSource: 'scenarios-v6/bV5Vs-1440.png', verdictHead: '5f09837c',
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
    verdict: 'needs_fix', verdictNote: '**#530 `2568c474` で束3の完了条件を満たした。** 本文から `cron` が消えた（数えて0件）。以前は「**cron** が 5 分粒度のため…」と、動かしている仕組みの名前がそのまま出ていた。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の通の編集（分岐の作り、送信後アクションの並び）はこの直しの外',
    verdictSource: 'scenarios-v6/xfYLn.txt', verdictHead: '2568c474',
  },
  {
    ...SCENARIO, node: 'r6Gzsu', name: '5-1-E シナリオ・配信条件を開く', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: '条件なし' }],
    verdict: 'needs_fix', verdictNote: '**P2 シナリオ編集の1枚に、複数のNodeが同居している。** ルート `/scenarios/detail?id=scenario-0`。`hz9ti`（送信後アクション）`EvVO5`（開始条件）`g2UNV`（一括テスト送信）と**同じ1枚**。設計はそれぞれ別の窓や段。取得元：`scenarios-v6/r6Gzsu.txt`。1440・1920とも横スクロール0',
    verdictSource: 'scenarios-v6/r6Gzsu.txt', verdictHead: 'c275749d',
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
    verdict: 'needs_fix', verdictNote: '**P1 選べる動作が設計の8つのうち5つ。** ルート `/scenarios/detail?id=scenario-0`（アクション）。設計は テキスト送信・テンプレート送信・タグ操作・友だち情報操作・シナリオ操作・リマインダ操作・対応マーク/表示操作・イベント予約操作 の8つ。**テキスト送信・テンプレート送信・リマインダ操作・イベント予約操作が無い。** 実行の順番も、動作ごとの条件分岐も、保存済みセットの呼び出しも、「発動2回目以降も各動作を実行」も無い。取得元：`scenarios-v6/hz9ti.txt`。1440・1920とも横スクロール0',
    verdictSource: 'scenarios-v6/hz9ti.txt', verdictHead: 'c275749d',
  },
  {
    ...SCENARIO, node: 'dqFft', name: '5-1-G シナリオ・ステップ削除確認', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: 'この通を削除する' }],
    verdict: 'needs_fix', verdictNote: '**#553 `2fdded68` でブラウザ標準の `confirm` が画面内の確認窓（`ConfirmDialog`）に替わった。** 撮った絵に、設計の3つがそのまま入っている：**どの通か**（「1通目を削除しますか？」）、**何が一緒に消えるか**（「1通目と、その配信対象・送信後アクションが削除されます。」）、**何が残るか**（「到達済みの履歴は監査記録として残ります。」）。加えて「この操作は取り消せません。」。ボタンは「キャンセル」と赤い「この通を削除」で、`Y0Sn3` `Gy9OK` と同じ部品・同じ形。失敗時の文も「この通を削除できませんでした。状態を読み直してから、もう一度お試しください。」と画面の言葉になった。1440・1920とも横スクロール0。**P1 ただし同じファイルの「シナリオごと削除」はまだブラウザ標準の `confirm`**（`scenario-detail-client.tsx:470`）。購読中の人数は本文に入るが、窓の見た目は揃っていない。束5に残す',
    verdictSource: 'scenarios-v6/dqFft-1440.png', verdictHead: '2fdded68',
  },
  {
    ...SCENARIO, node: 'EvVO5', name: '5-1-H シナリオ・開始条件を開く', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: '変更' }],
    verdict: 'needs_fix', verdictNote: '**P1 設計の「シナリオの開始条件」の窓が無い。** ルート `/scenarios/detail?id=scenario-0`（変更）。設計はきっかけ6種類（友だち追加・タグ追加・フォーム回答・予約確定・手動開始・API/Webhook）を選ぶ面、開始する友だちの条件、初回のみ/毎回の選択、一致人数の再計算（一致124人・すでに購読中8人・新規開始予定116人）を持つ。**実装は設定欄のトリガーの選び口1つ。** 「何人が新しく始まるか」を押す前に見られない。取得元：`scenarios-v6/EvVO5.txt`。1440・1920とも横スクロール0',
    verdictSource: 'scenarios-v6/EvVO5.txt', verdictHead: 'c275749d',
  },
  {
    /*
      **窓は編集画面ではなく一覧に出る。** 行の「停止」「再開」を押すと
      `ConfirmDialog` が開く（`scenarios/page.tsx:267` の
      `data-design-node="RUxNf"`）。設計は編集画面からの開始を描いているが、
      実装は一覧から状態を変える形なので、そこは差として残る。
    */
    ...SCENARIO, node: 'RUxNf', name: '5-1-I シナリオ・配信開始確認',
    route: '/scenarios', mode: 'viewport', height: 1080,
    steps: [{ click: '再開' }],
    verdict: 'needs_fix',
    verdictNote: '**#521 で確認窓が入り、未実装ではなくなった。** 「「休眠ユーザー復帰」を開始しますか？／現在の購読中は0人です。配信内容は3通です。現在届く人はいません。開始後に登録された友だちから配信対象になります。」と、いま届く人がいないことまで言う。P1 設計の中身が入っていない。開始対象の人数・開始タイミング・配信ステップ数・終了後の一覧が無い。配信前チェック4項目（開始条件が設定されています／すべてに配信タイミングがあります／テスト送信が完了しています／LINE公式の送信枠を超えていません）が無い。「開始後に起きること」（条件に一致した人が購読を開始／停止するまで次のステップへ進む／開始・停止・編集は監査履歴とSlackへ記録）が無い。確認のチェックも無い。P2 設計は編集画面から開始するが、実装は一覧の行から状態を変える',
    verdictSource: 'scenarios-v6/RUxNf-1920.png', verdictHead: '7d5d74fd',
  },
  {
    /*
      **`?started=1` で開く。** 一覧の確認窓で開始が成功したときだけ
      `router.push(...&started=1)`（`scenarios/page.tsx:170-175`。
      `if (!response.success) throw` の後ろにある）。URLで開けるので、
      書き込みを405で止めたままでも完了の面を撮れる。
    */
    ...SCENARIO, node: 'NrBkW', name: '5-1-J シナリオ・配信開始完了',
    route: '/scenarios/detail?id=scenario-0&started=1', mode: 'page',
    verdict: 'needs_fix',
    verdictNote: '**#522 で完了の知らせが入り、未実装ではなくなった。** 「配信を開始しました。条件を満たした友だちから順に配信します。」＋「開始後の結果を見る」。**設計の「新規開始予定116人へ」を出さないのは正しい判断**で、契約試験も `not.toContain(\'開始予定116人\')` で見張っている（その時点で取れない数を作らない）。P2 リンク名が設計の「開始履歴を確認」でなく「開始後の結果を見る」。設計は状態カードが「配信中／2026/08/23 15:20 開始」へ変わり、開始条件に「新規開始予定116人」が出るが、実装の状態カードは「配信可」のまま。**ただしこれは `?started=1` でURLから開いた撮り方の都合**で、実際に開始すれば固定データ側も変わる',
    verdictSource: 'scenarios-v6/NrBkW-1920.png',
    verdictHead: '3c88b8bd',
  },
  {
    ...SCENARIO, node: 'g2UNV', name: '5-1-K シナリオ・テスト送信', route: EDIT,
    mode: 'viewport', height: 1080, /* **#427 で「一括テスト送信」が1つになった**（前は2つあり2番目を押していた）。 */
    steps: [{ click: '一括テスト送信' }],
    verdict: 'needs_fix', verdictNote: '**#427 `5f09837c` で一括テスト送信が入り、撮れるようになった。** 以前は同じ名前のボタンが2つあり2番目を押していたが、1つに整理された（撮影の段もあわせて直した）。内部語・壊れ値は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計のテスト送信は送信先を選び、結果を1通ずつ確かめる。実装は一括で送るところまで',
    verdictSource: 'scenarios-v6/g2UNV-1440.png', verdictHead: '5f09837c',
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
    verdict: 'needs_fix', verdictNote: '**#519 `a8e00234` で、束1と束4の完了条件を満たした。** 失敗のとき帯は **シナリオ `—`／購読中 `—`** で、札ごとに「取得できませんでした」と理由を書く。本文も「シナリオがありません。「＋ シナリオを作成」から作ってください。」を出さなくなり、**持っているシナリオが消えたようには見えない**。読込・空・失敗が分かれる。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の一覧の作り（シナリオごとの到達の推移、フォルダの扱い）はこの直しの外',
    verdictSource: 'scenarios-v6/q5G45-error.txt', verdictHead: 'a8e00234',
  },

  // ── 機能6 一斉配信 ──────────────────────────────────────
  { ...BROADCAST, node: 'q76C35', name: '6-1 一斉配信', route: '/broadcasts',
    verdict: 'needs_fix', verdictNote: '**#557 `697cee2c` で帯の未取得が直った。返事を差し替えて実際に確かめた。** 集計が**失敗**したときは4つとも **`—`**（`undefined` も `0` も出ない）、**一部だけ欠けた**ときは揃っている分だけ実値で欠けた分だけ `—`（今月の配信 12件・到達 1,842通 に対し 予約中 `—`・失敗 `—`）、**実値0**のときは `0件` `0通` `0%`。以前の「開封（率）の未取得が `-` で `—` でない」と「`broadcast-kpis.tsx:40` が欠けた項目をそのまま文へ繋ぐ」は、`buildBroadcastKpiCards()` が `?? null` で受けて `BroadcastKpiValue` が `null` を `—` に描く形になり、両方とも解けた。1440・1920とも横スクロール0。P2 帯の4枚が設計（予約中・下書き・今月の配信・平均開封率）と違い、今月の配信・到達・平均開封率・失敗になっている。列の並びも違う。フォルダごとの「…」（名前を変える・消す）が無い。日付欄が `mm/dd/yyyy` になるのは撮影側のブラウザの癖',
    verdictSource: 'broadcasts-v6/q76C35-1920.png + apps/web/src/components/broadcasts/broadcast-kpi-values.tsx', verdictHead: '697cee2c',
  },
  { ...BROADCAST, node: 'zZ9fA', name: '6-1-A 一斉配信を作成', route: NEW_BC,
    verdict: 'needs_fix', verdictNote: 'P1 節の番号が画面の並びと合っていない（上から 1.送る相手 → 3.送る内容 → 2.送る時間）。設計の5段の進み表示（基本設定・対象者・メッセージ・送信設定・確認）が無く、1枚の長い画面になっている。配信方法（新しいメッセージを作成／テンプレートを選択／過去の配信を複製）と「最近の配信」からの複製が無い。社内メモが無い。P2 右の設定内容（配信対象・配信日時・送信数・配信後）が無く、配信名の字数（14 / 60文字）も出ない。送信対象の未取得が「−」で「—」でない',
    verdictSource: 'broadcasts-v6/zZ9fA-1920.png', verdictHead: '6db5ad7f',
  },
  {
    ...BROADCAST, node: 'cPk8A', name: '6-1-B 対象条件', route: NEW_BC,
    /*
      **「詳細条件で絞り込んで配信する」を選ばないと保存の口が開かない。**
      条件がひとつも無いうちは「この条件を保存」が押せない（押せない理由も
      吹き出しに書いてある）。設計の見どころは**保存と呼び出しの2つの口**
      なので、そこまで進めてから撮る。
    */
    steps: [{ click: '詳細条件で絞り込んで配信する', role: 'text', after: 700 }],
    verdict: 'needs_fix',
    verdictNote: '**#550 `f7c5a99e` で「保存した条件から選ぶ」がつながり、未実装ではなくなった。** 「詳細条件で絞り込んで配信する」を選ぶと、条件の下に **「この条件を保存」「保存した条件から選ぶ」** の2つが出る。**押せないときは理由を吹き出しで言う**（アカウント未選択なら「先にLINEアカウントを選んでください」、条件が空なら「詳細条件を1つ以上入力してください」）。空の条件は `pruneCondition` で落ちるので、**誰にも届かない条件を保存できない**。`w72a2` と同じ、正直な押せなさ。読み込む口は `/api/saved-searches?format=segment_v1` で、受信箱の「保存した検索」とは**同じ道でも別の型**（混ぜると受信箱の条件で配信することになる）。1440・1920とも横スクロール0。P2 送信対象の未取得が `-人` で、`—` でそろっていない。P2 設計の対象条件の面（保存済み条件の一覧をその場に出す、条件ごとの見込み人数）はまだ窓の中',
    verdictSource: 'broadcasts-v6/cPk8A-1440.png',
    verdictHead: 'f7c5a99e',
  },
  { ...BROADCAST, node: 'XQfMD', name: '6-1-C メッセージ編集', route: NEW_BC,
    verdict: 'needs_fix', verdictNote: '**P1 本文の上限が設計と違う。** ルート `/broadcasts/new`。設計は1通5,000字・合計22,500字・最大5通で、4,500字を超えると自動分割。実装は 0/500・吹き出しは最大3。**長い本文が書けず、書けても分割されない。** P1 ボタンの編集（最大4つ、ラベルと押したときの動作）が無い。URLの扱いの表（サイト名・URL・計測）が無い。保存してテンプレート化、配信後のアクションが無い。P2 種類がタブでなく選び口。取得元：`broadcasts-v6/XQfMD.txt`。1440・1920とも横スクロール0',
    verdictSource: 'broadcasts-v6/XQfMD.txt', verdictHead: 'c275749d',
  },
  {
    /*
      **設計は重なる窓だが、実装は本文の下に開く欄。**
      見えている範囲だけ撮ると、開いた中身が画面の外に残る。
      ここは `page` で撮って、開いた欄まで写す。
    */
    ...BROADCAST, node: 'p97Tf', name: '6-1-D テンプレート選択', route: NEW_BC,
    mode: 'page', steps: [{ click: 'テンプレートから選ぶ' }],
    verdict: 'needs_fix', verdictNote: '**P2 カードの補足に内部の語 `text` が出る（束3）。** ルート `/broadcasts/new`。設計は日本語の種類名。取得元：`broadcasts-v6/p97Tf.txt`。1440・1920とも横スクロール0',
    verdictSource: 'broadcasts-v6/p97Tf.txt', verdictHead: 'c275749d',
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
    verdict: 'needs_fix', verdictNote: '**「押すたびに配信が1件残る」は #543 で解決した。** 実物の persistBroadcastDraft を動かして確かめた。テスト3回＋本番予約で **create は1回、あとは同じ id への update**（本番予約も同じ id を使う）。アカウントを切り替えたときだけ別の下書きへ分ける。P1 送信先を選べないのは残る。設計は「テスト送信先を選択」の窓で相手を選び、テスト履歴と確認項目（改行と文字切れ・画像/ボタンの表示・変数の差し込み・リンクの遷移）と「本番の送信枠を消費しません」を見せる。撮った絵で送信が失敗しているのは、モックが書き込みを405で返すためで実装の不具合ではない',
    verdictSource: 'broadcasts-v6/h0kahp-1920.png + apps/web/src/components/broadcasts/broadcast-form.tsx:514', verdictHead: '819895dd',
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
    verdict: 'needs_fix', verdictNote: '**P2 送る時間の面が設計とそろわない。** ルート `/broadcasts/new`。設計は 今すぐ／予約／くり返し を段で選び、予約なら送信直前の再集計を断る。取得元：`broadcasts-v6/vW4Es.txt`。1440・1920とも横スクロール0',
    verdictSource: 'broadcasts-v6/vW4Es.txt', verdictHead: 'c275749d',
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
    /*
      **`/broadcasts/reserved?id=` で開く。** `status === 'scheduled'` かつ
      `scheduledAt` があるときだけ出る（無ければ「予約状態を確認できませんでした」）。
      固定データの `broadcast-0` が予約済みなので、そこを見る。
    */
    ...BROADCAST, node: 'bPF0s', name: '6-1-I 一斉配信・予約完了',
    route: '/broadcasts/reserved?id=broadcast-0', mode: 'page',
    /* 押した先の確認窓。**窓はビューポートで撮る**（`fullPage` だと下へ流れる）。 */
    variants: [{
      suffix: '-cancel', mode: 'viewport',
      steps: [{ click: '予約を取り消す', after: 900 }],
    }],
    verdict: 'needs_fix',
    verdictNote: '**#510 → #561 `51827fe1` で、前に挙げたP1がほぼ埋まった。** STEP1〜5の進み表示が入り（基本設定・対象者・メッセージ・送信設定・確認）、右390pxの「次にできること」に**予約を取り消す**が入り、予約した内容に「状態 予約中」の行が付いた。**押した先まで動かして確かめた**：確認窓は題・説明・管理名・送信予定を出し、押すと `POST /api/broadcasts/broadcast-0/cancel` が飛び、返事は `status:\'draft\'` `scheduledAt:null`、窓が閉じて `/broadcasts/detail?id=broadcast-0` へ移る。画面にも「取り消しても配信内容は下書きとして残ります。」と書いてある。**未取得と実値0も分かれる**（preflight を差し替えて確認。返らない＝「（人数は未取得）」、0＝「0人」）。段組みは実寸で 694px / **390px**。1440・1920とも横スクロール0。P2 409のとき「通信を確認して」と出る。日本語で内部の言葉は出ないが、通信は切れておらず状態が変わっただけ。用意されている「予約の状態が変わっています。」は `fetchApi` が投げるため届かない（`Lg8ff` と同じ形。`ApiError.status` で分ける）。P2 人数が読めないときの見出しが「人数を送信前に再集計してへ配信します」と切れる。P2 設計の「次にできること」のうち、テスト送信と複製はまだ無い。Slackへ通知する旨の案内も無い',
    verdictSource: 'broadcasts-v6/bPF0s-1920.png + broadcasts-v6/bPF0s-cancel-561.md',
    verdictHead: '51827fe1',
  },
  { ...BROADCAST, node: 'u6gHt', name: '6-1-J 結果詳細', route: '/broadcasts/detail?id=broadcast-2',
    verdict: 'needs_fix', verdictNote: '**#531 `1a943082` で束3と束6の完了条件を満たした。** ①内部の言葉が消えた——「1通（**carousel**）」が日本語になり、`carousel` `flex` `image` `text` はいずれも0件。②**桁の合わない数を並べなくなった**——以前は 送信624・到達624 と並べて**開封2,410**（62.4%）と出し、どちらの母数か言わなかった。いまは **開封 `—件`／クリック `—件`** で、理由を3つ書く：「開封は LINE の集計値です。個人単位では取れないため『誰が読んだか』は分かりません」「配信対象が20人未満のときは、LINE側の仕様で開封数・クリック数が表示されません」「クリックは短縮URL経由の実測値です。LINE側の集計値とは数字がずれることがあります」。アカウント別も「記録していません」と断る。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計のタブ（クリック・友だち・エラー・配信内容）、ボタンごとの反応、CSVで書き出す が無い',
    verdictSource: 'broadcasts-v6/u6gHt.txt', verdictHead: '1a943082',
  },
  {
    ...BROADCAST, node: 'EGMb1', name: '6-1-K 削除確認', route: '/broadcasts',
    mode: 'viewport', height: 1080, steps: [{ click: '削除' }],
    verdict: 'needs_fix', verdictNote: '**#554 `875a9ed3` でブラウザ標準の `confirm` が画面内の確認窓（`ConfirmDialog`）に替わった。** **どの配信かを名前で言う**：「「8月キャンペーンのお知らせ」を削除しますか？」。本文は「削除すると配信設定と確認画面から消えます。**予約中の配信は中止され**、この操作は取り消せません。」で、消えるもの・止まるもの・戻せないことの3つが揃う。ボタンは「キャンセル」と赤い「削除する」。失敗の文も「この配信を削除できませんでした。状態を読み直してから、もう一度お試しください。」と画面の言葉になり、削除の口は `if (!result.success) throw` で成否を見る（`tBlkL` のP0と同じ取りこぼしをしていない）。削除の口は下書きと予約中の行にしか出ないので、送信済みを消せる道は無い。1440・1920とも横スクロール0。P2 帯の下の日付欄が `mm/dd/yyyy` と英語書式で出るのは**撮影側のブラウザの癖**で、実装の不具合ではない',
    verdictSource: 'broadcasts-v6/EGMb1-1440.png', verdictHead: '875a9ed3',
  },
  {
    ...BROADCAST, node: 'sqFXf', name: '6-1-L 対象条件を編集', route: NEW_BC,
    /* 保存する窓と、呼び出す窓。**窓はビューポートで撮る。** */
    mode: 'viewport', height: 1080,
    steps: [
      { click: '詳細条件で絞り込んで配信する', role: 'text', after: 700 },
      { click: '保存した条件から選ぶ', after: 900 },
    ],
    variants: [{
      suffix: '-save', mode: 'viewport',
      steps: [
        { click: '詳細条件で絞り込んで配信する', role: 'text', after: 700 },
        /*
          **条件が揃うまで「この条件を保存」は押せない。**
          空の欄を足しただけでは `pruneCondition` で落ちる。保存済みを
          いったん読み込んで、**呼び出して保存し直す**道を通す。
        */
        { click: '保存した条件から選ぶ', after: 900 },
        { click: 'この条件を使う', after: 900 },
        { click: 'この条件を保存', after: 900 },
      ],
    }],
    verdict: 'needs_fix',
    verdictNote: '**#550 `f7c5a99e` で保存と呼び出しの2つの窓が入り、未実装ではなくなった。実際に押して撮った。** 呼び出す窓は「保存した対象条件から選ぶ／選ぶと、この画面の詳細条件へ読み込みます。」で、行ごとに名前と**共有の別**（「運用者と共有」／「自分だけ」）と「この条件を使う」。押すと詳細条件へ入り、「「直近30日で反応した友だち」の条件を読み込みました。」と出る。保存する窓は「この対象条件を保存／次の一斉配信でも同じ条件を呼び出せます。」で、名前欄（例文つき、80字まで）と「同じLINEアカウントを扱う運用者と共有する／外すと、自分だけが呼び出せます。」。読込中・失敗も `ListState` で分かれる。1440・1920とも横スクロール0。P2 設計の「使われている場所」（`usedIn`）と、呼ばれている条件を消せないこと（`canDelete`）が窓に出ていない。型は返ってきているので、出す場所だけの話',
    verdictSource: 'broadcasts-v6/sqFXf-1440.png + broadcasts-v6/sqFXf-save-1440.png',
    verdictHead: 'f7c5a99e',
  },
  {
    ...BROADCAST, node: 'xkRDb', name: '6-1-M フォルダ操作', route: '/broadcasts',
    mode: 'viewport', height: 1080, steps: [{ click: 'フォルダを追加' }],
    verdict: 'needs_fix', verdictNote: '**P2 一覧のフォルダまわりが設計とそろわない。** ルート `/broadcasts`。フォルダごとの「…」（名前を変える・消す）が無い。取得元：`broadcasts-v6/xkRDb.txt`。1440・1920とも横スクロール0',
    verdictSource: 'broadcasts-v6/xkRDb.txt', verdictHead: 'c275749d',
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
    verdict: 'needs_fix', verdictNote: '**P1 空・失敗のとき帯の補助行に `undefined` が出る。** ルート `/broadcasts`。口を空で返すと **「今月の配信 — 件／予約中 undefined」「到達 — 通／失敗 undefined」** となる（値そのものは `—` に落ちるが、**補助の行だけ守りが無い**）。**これは #557 `697cee2c` が直すP1で、development にはまだ入っていない**——#557 では `buildBroadcastKpiCards()` が `?? null` で受け、`stats?.scheduled == null ? \'—\'` と分ける。撮影ハーネスは `undefined` を見つけて撮影を止めた（絵として残していない）。**推奨修正**：#557 の取り込み。取得元：口を空にして再現。1440・1920とも横スクロール0',
    verdictSource: 'broadcasts-v6/TmHjF-normal.txt', verdictHead: 'c275749d',
  },

  // ── 機能7 リマインダ ────────────────────────────────────
  /*
    設計は5段の作成ウィザード（基本設定→対象者→通知ステップ→送信設定→確認）。
    実装は `/reminders/new` の1枚もので、段の縦帯も右の「設定内容」も無い。
    **段ごとの画面が無いので、設計の A〜G は1枚ずつには対応しない。**
  */
  { ...REMINDER, node: 'M1EXwB', name: '7-1 リマインダ', route: '/reminders', verdict: 'needs_fix', verdictNote: 'P1 失敗の帯が無い（設計の4つめは「失敗 2通（要確認）」、実装は「今月の配信」）。P1 状態で絞る札4つ（有効のみ・下書き・停止中・失敗あり）が無い。P1 列に「基準日」「予定」「最終送信」が無い（実装は 配信方式・きっかけ・送る内容・フォルダ・稼働・登録日）。P2 送信予定の単位が設計の「通」でなく「人」。並び順・表示件数が無い。P2 状態が2つしか出せない。Reminder.isActive が真偽値ひとつなので、下書きと停止中を分けられない。**#498 → #514 で行ごとのごみ箱が入り、設計と同じ位置になった**（前は下の「選択したリマインダを削除」だけだった）', verdictSource: 'reminders-v6/M1EXwB-1920.png' , verdictHead: 'c275749d' },
  { ...REMINDER, node: 'uJP22', name: '7-1-A リマインダを作成', route: '/reminders/new', verdict: 'needs_fix', verdictNote: '**画面全体は要修正のまま。** P1 作成の段の構造が無い。設計は段ごとに 対象の絞り込み・停止条件・配信予定の下見・テスト送信・最終確認へ進むが、実装にあるのは1段目の入力だけ（段の実装は #551 が別に進めている。`s7T2dz` ほか5枚を見る）。**画面全体の一致判定は行っていない。** ／ **#429 の受入条件だけは確認済み**（新head `0f612926`。**撮り直していない**——`reminders/new/page.tsx` `edit/page.tsx` `lib/api.ts` の blob が旧head `838116b4` と同一で、差分は Worker の `feature-settings.ts` と試験と反映履歴だけ）。①既存フォルダを選べる（`api.folders.list(\'reminder\')` の結果を `<option>` に並べる）②選んだ `folderId` が保存の口へ渡る（`api.reminders.create({ folderId: folderId || null })`）③再読み込みが動く（`foldersReloadToken` を増やして読み直す。失敗のときだけ「フォルダを再読み込み」が出る）④**取得できて0件と、取得失敗を混ぜない**——`foldersLoadState` が `loading|ready|error` の3つで、失敗のときは選べなくして「フォルダを読み込めませんでした。未取得と0件を区別するため、選択を止めています。」と書く。0件のときは「未分類」だけが選べる ⑤**別アカウントのフォルダは混ざりようがない**——`folders` 表に `line_account_id` が無く（`bootstrap.sql:899`）、`getFolders` も `WHERE kind = ?` だけ。**アカウント別フォルダという概念が設計に無い**ので、混ぜる余地が無い（「正しく絞れている」ではない）', verdictSource: 'reminders-v6/design-qa.md + #429 head 0f612926 のコード' , verdictHead: '0f612926' },
  {
    ...REMINDER, node: 'J64xI', name: '7-1-B 通知ステップ編集',
    verdict: 'needs_fix', verdictNote: 'P1 通知ステップ編集の面が設計とそろわない', verdictSource: 'reminders-v6/design-qa.md',
    route: '/reminders/edit?id=reminder-3',
    verdictHead: '9a72dba6',
  },
  {
    ...REMINDER, node: 's7T2dz', name: '7-1-C 対象と終了条件',
    route: '/reminders/edit?id=reminder-3&stage=target', mode: 'page',
    verdict: 'needs_fix',
    verdictNote: '**#551 `44692a37` で対象と停止条件の段が入り、未実装ではなくなった。** `/reminders/edit?id=…&stage=target` で開く。上に5段の進み（1.対象と停止条件／2.届く予定／3.テスト送信／4.最終確認／5.公開完了）。**「終了・停止条件」が実装された**——予約・イベントがキャンセルされた／対応マークが完了になった／基準日から何日か過ぎた／ブロックされた、の4つで、型（`ReminderStopConditions`）と一致する。**押せない理由も先に書く**（「タグを選ぶまで公開前チェックは通りません。」）。1440・1920とも横スクロール0。P2 設計の対象の絞り込みは、タグのほかに友だち情報・登録日も選べる。実装はタグだけ',
    verdictSource: 'reminders-v6/s7T2dz.txt',
    verdictHead: '44692a37',
  },
  {
    ...REMINDER, node: 'JCz6J', name: '7-1-D 配信予定プレビュー',
    route: '/reminders/edit?id=reminder-3&stage=preview', mode: 'page',
    verdict: 'needs_fix',
    verdictNote: '**#551 `44692a37` で配信予定プレビューが入り、未実装ではなくなった。** `POST /api/reminders/:id/preview` の返事をそのまま描く（**ブラウザで時刻を再計算していない**——これが未実装のままだった理由。画面とWorkerで別々に計算すると「画面では届くのに送られない」が起きる）。1通目 前日19:00 → 2026/09/02 19:00、2通目 当日08:00 → 2026/09/03 08:00。見込みは 対象 124人・7日以内 38通・30日以内 162通・重なり 0件。型（`ReminderPreviewResult`）は各通に `state`（`scheduled` / `past` / `duplicate`）を持ち、**過去になる通と重なる通を隠さない**作りになっている。1440・1920とも横スクロール0。P2 設計は「条件で外れる通」「取消時に止まる通」も予定表の中で色分けする。実装は状態の欄を持つが、その2つを出す絵はまだ確かめていない',
    verdictSource: 'reminders-v6/JCz6J.txt',
    verdictHead: '44692a37',
  },
  {
    ...REMINDER, node: 'W98zZQ', name: '7-1-E テスト送信確認',
    route: '/reminders/edit?id=reminder-3&stage=test', mode: 'page',
    verdict: 'needs_fix',
    verdictNote: '**#551 `44692a37` でテスト送信の段が入り、未実装ではなくなった。** **この節を止めていた条件が満たされている**——画面が「本番の登録 **増えません**／配信予定 **作りません**」と、実登録も予定も動かさないことを書いており、口も `POST /api/reminders/:id/test-send` の専用口。以前は一斉配信・シナリオのテスト口を借りるしかなく、リマインダの基準日・版・予定時刻を確かめられなかった。テストの状態は 結果「届きました」・確認した日時 2026/08/28 18:12 で、済んでいないときは「テスト送信が必要です」に変わる。1440・1920とも横スクロール0。P2 設計はテスト受信先を画面で選べる。実装は「登録済みのテスト受信先」へ送る',
    verdictSource: 'reminders-v6/W98zZQ.txt',
    verdictHead: '44692a37',
  },
  {
    ...REMINDER, node: 's6Vvp', name: '7-1-F 最終確認',
    route: '/reminders/edit?id=reminder-3&stage=confirm', mode: 'page',
    verdict: 'needs_fix',
    verdictNote: '**#551 `44692a37` で最終確認が入り、未実装ではなくなった。** 公開前チェック5項目（基準日が決まっています／すべての通に送る時刻があります／テスト送信が終わっています／止める条件があります／届く人がいます）が 確認済み・注意 で並ぶ。**未取得を0にしない**——除外人数は `—人` と出る（型の `audience.excluded` が `null`。返事を差し替えて確かめた）。**版を固定することも書いてある**：「公開しても、すでに登録済みの友だちが使う版は変わりません。新版は、公開後に新しく対象になった友だちから使われます。」。見出しに `v2` が出て、どの版を公開するのかが分かる。1440・1920とも横スクロール0。P2 チェックが `warning` でも「公開できます」と出る。注意の内容によっては止めたほうがよい場合がある',
    verdictSource: 'reminders-v6/s6Vvp.txt',
    verdictHead: '44692a37',
  },
  {
    ...REMINDER, node: 'PSmHo', name: '7-1-G 有効化完了',
    route: '/reminders/edit?id=reminder-3&stage=confirm', mode: 'page',
    /* 公開を押した先。**確認から実際に進める。** */
    steps: [{ click: 'この内容で公開', after: 1500 }],
    verdict: 'needs_fix',
    verdictNote: '**#551 `44692a37` で有効化完了が入り、未実装ではなくなった。確認から実際に「この内容で公開」を押して撮った。** 公開版 v2・対象 124人・次の予定 2026/09/02 19:00 で、**確認の段と数が食い違わない**（同じ `audience`）。次の予定は届く予定の1通目と一致する。「これから新しく対象になった友だちには、v2 の内容で届きます。」と、公開が既存の購読者に及ばないことを書く。行き先は「一覧へ戻る」「実行結果を見る」。**公開の返事が無いときは `—人` `—` に落ちる**作りで、固定値で埋めていない。1440・1920とも横スクロール0。P2 設計の完了画面は監視先（Slack）と、最初の実行までの残り時間も出す',
    verdictSource: 'reminders-v6/PSmHo.txt',
    verdictHead: '44692a37',
  },
  {
    /*
      **PR #500（head `409f00bb`）で `/reminders/detail` が入った。**
      7機能で共通に使う `ExecutionRunListItem`（9項目）と、
      リマインダの書込台帳だけが持つ `domainStatus` の両方を返す。
      **表は1本にせず、読む口の契約でそろえる形。**
    */
    ...REMINDER, node: 'GC4St', name: '7-1-H 実行結果',
    verdict: 'needs_fix', verdictNote: '**#511 `4bc71249` で束3の完了条件を満たした。** 実行結果に内部IDが出ていたのが、`reminder-` `rr-` `friend-` を数えて**すべて0件**になった。`undefined` も0件。通常・読込・空・失敗の4状態が `data-list-state` で分かれる。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の実行結果（通ごとの内訳、失敗の理由別のまとめ）はこの直しの外', verdictSource: 'reminders-v6/GC4St-normal.txt', verdictHead: '4bc71249',
    route: '/reminders/detail?id=reminder-1',
    states: {
      apis: ['**/api/reminders/*/runs*'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
  },
  {
    /*
      **削除の窓は一覧の行から開く。** ボタンの読み上げ名は
      `<リマインダ名>を削除`（`reminders/page.tsx:548`）。
      #514 は #498 を含むので、積み順を守って #514 の head で撮る。
    */
    ...REMINDER, node: 'Y0Sn3', name: '7-1-I 削除確認', route: '/reminders',
    mode: 'viewport', height: 1080,
    steps: [{ click: 'を削除' }],
    verdict: 'needs_fix',
    verdictNote: '**#498 `f30890f2`（`codex/development` 直結へ張り替え済み）で、束5の形はできている。実際に押して確かめた。** 窓は `ConfirmDialog` で、ブラウザ標準の窓は**0回**。題に名前が入り（「「予約前日のご案内」を削除しますか？」）、本文に3つが揃う——「削除すると**未送信の通知予定はすべて取り消されます**。**送信済みの履歴は監査記録として残り**、この操作は**取り消せません**。」。**失敗しても窓は閉じない**（削除の口を405にして確認）。**P1 ただし窓の中に出る文が `API error: 405` という内部の言葉。** `reminders/page.tsx:230` の `setDeleteError(caught instanceof Error ? caught.message : \'削除に失敗しました\')` が、APIの文をそのまま窓へ流している（束2）。#554 の `EGMb1` は「この配信を削除できませんでした。状態を読み直してから、もう一度お試しください。」と画面の言葉にしていて、そこだけ揃っていない。**推奨修正**：`caught.message` を使わず、決まった一文を出す。1440・1920とも横スクロール0',
    verdictSource: 'reminders-v6/Y0Sn3-1440.png',
    verdictHead: 'f30890f2',
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
  { ...AUTO_REPLY, node: 'cmDfJ', name: '8-1 自動応答', verdict: 'needs_fix', verdictNote: '**#566 `d0680774` で束3の完了条件を満たした。** `silent rule` `automation rule` `line_account_id` `inline` `TEMPLATE` `keyword` `match` `silent` `flex` `image` を数えて**すべて0件**。**#540（実行結果側）では直らない**——#540 と #566 は同じ `auto-reply-runs` の上の兄弟で、一覧の言葉を直しているのは #566。実際に #540 `857cebc5` で撮ると7語とも残っていた。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の一覧の作り（ルールごとの当たり方の推移）はこの直しの外', verdictSource: 'auto-replies-v6/cmDfJ.txt' , verdictHead: 'd0680774' },
  {
    ...AUTO_REPLY, node: 'K7vg2', name: '8-1-A 自動応答ルール編集',
    verdict: 'needs_fix', verdictNote: '**P2 自動応答の編集が段になっていない。** ルート `/auto-replies/edit?id=ar-2`。撮った本文は「自動応答を編集／決めた言葉が届いたときに、自動で返します。」の1枚で、`nzWIX` `ivDoe` と同居。設計は 一致条件 → 返信内容 → 送信後の動き の段。取得元：`auto-replies-v6/K7vg2.txt`。1440・1920とも横スクロール0', verdictSource: 'auto-replies-v6/K7vg2.txt',
    route: '/auto-replies/edit?id=ar-2',
    verdictHead: 'c275749d',
  },
  {
    ...AUTO_REPLY, node: 'nzWIX', name: '8-1-B 反応条件',
    verdict: 'needs_fix', verdictNote: '**#491 → #544 `6053c271` で撮った**（#544 は #491 を含む）。内部語・壊れ値は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の編集は段ごとに 一致条件・返信内容・送信後の動き へ進む。実装との差は段の口がつながってから見る', verdictSource: 'auto-replies-v6/nzWIX.txt',
    route: '/auto-replies/edit?id=ar-2',
    verdictHead: '6053c271',
  },
  {
    ...AUTO_REPLY, node: 'ivDoe', name: '8-1-C 応答とアクション',
    verdict: 'needs_fix', verdictNote: '**#491 → #544 `6053c271` で撮った**（#544 は #491 を含む）。内部語・壊れ値は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計との差は、送信後の動きの並びと、条件の組み立て。段の口がつながってから見る', verdictSource: 'auto-replies-v6/ivDoe.txt',
    route: '/auto-replies/edit?id=ar-2',
    verdictHead: '6053c271',
  },
  {
    ...AUTO_REPLY, node: 'U9hzqH', name: '8-1-D 競合と優先順位',
    gap: 'api',
    gapNote: '`GET /api/auto-replies/conflicts` とsimulateが要る。候補、実際に勝つルール、勝つ理由、優先順位変更後の差を同じ評価器から返す',
    status: 'unimplemented',
    why: '`priority` の一覧だけでは、完全一致・部分一致・全メッセージ・時間帯・友だち条件の包含関係を判定できない。現行routeに競合／simulate APIが無く、画面側で推測するとWebhook本番評価と食い違う',
  },
  {
    ...AUTO_REPLY, node: 'g46ja', name: '8-1-E 自動応答テスト',
    gap: 'api',
    gapNote: '`POST /api/auto-replies/test` のdry-runが要る。評価順、一致・不一致理由、勝ったルール、返信、実行予定アクション、抑止理由を返し、状態を更新しない',
    status: 'unimplemented',
    why: '画面側でキーワード一致だけを再現しても、曜日・時間・友だち条件・クールダウン・担当者対応中・競合の本番評価と一致しない。現行routeにdry-run APIが無い',
  },
  {
    ...AUTO_REPLY, node: 'Yj6CQ', name: '8-1-F 最終確認',
    gap: 'api',
    gapNote: '下書き・validate・conflicts・test・publishが要る。競合とループ防止をサーバーで確認し、公開版を固定してから有効化する',
    status: 'unimplemented', why: '現行の編集窓は保存すると即時に本番ルールを更新する。設計が確認する競合2件、推定ヒット、テスト完了、公開版を返すAPIが無く、確認窓だけでは安全に有効化できない',
  },
  {
    ...AUTO_REPLY, node: 'e6iJG', name: '8-1-G 有効化完了',
    gap: 'api',
    gapNote: '`publish` の返事（公開版、優先順位、監視、競合解消結果）を受けて完了画面を出す。8-1-Fと同じ契約で作る',
    status: 'unimplemented', why: '現行saveは公開結果を返さない。8-1-Fのdraft/validate/publish APIが前提',
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
    /*
      **窓は一覧の行の「削除」から開く**（`auto-replies/page.tsx:610-618`）。
      #544 は #491 を含むので、積み順を守って #544 の head で撮る。
    */
    ...AUTO_REPLY, node: 'Gy9OK', name: '8-1-I 削除確認',
    mode: 'viewport', height: 1080,
    steps: [{ click: '削除' }],
    verdict: 'needs_fix',
    verdictNote: '**#491 → #544 で削除確認が入り、未実装ではなくなった。** 「自動応答「営業時間外の自動返信」を削除しますか？／新しく届くメッセージへの自動返信と、タグ付けなどの後続処理が止まります。過去の実行履歴は削除されません。この操作は元に戻せません。」。**何が止まり、何が残り、戻せないことの3つを言う**という Y0Sn3 と同じ形で、束5の手本になる。P2 設計との差は絵記号（⚠とごみ箱）',
    verdictSource: 'auto-replies-v6/Gy9OK-1920.png',
    verdictHead: '6053c271',
  },
  {
    ...AUTO_REPLY, node: 'q8wSqO', name: '8-1-J 一覧の状態（空・読込・エラー）',
    /* **通常も撮る。** 内部の言葉は行の上に出るので、行が無い3状態だけでは見えない。 */
    states: { apis: ['**/api/auto-replies*', '**/api/auto-replies/**', '**/api/folders*'], kinds: ['normal', 'loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: '**#566 `d0680774` で、記録していたP1が2つとも直った。通常・読込・空・失敗を別々に撮って確かめた。** ①**内部の言葉が9つとも消えた**（`silent` `match` `automation rule` `line_account_id` `inline` `template`/`TEMPLATE` `raw text` `flex` `image`。通常状態の本文を数えて全部0）。凡例は「このルールから返信」「自動処理を通じて返信」「返信内容が設定されていないため、何もしません」「このLINEアカウントでは使いません」に、種類は「文章・画像・カード・カルーセル…」に、テンプレート欄は「この画面で設定」／ひな形の名前に、一致は「一部一致／完全一致」になった。**内部IDの代替表示もしない**——読めないアカウントは `lineAccountId.slice(0,8)` ではなく「アカウント名を確認できません」、読めないひな形は「(未知 xxxxxx)」ではなく「名前を確認できません」。②**失敗のとき帯が `—` になる**（ルール —件／今月のヒット —回／営業時間外の応答 —件／未ヒット —件）。しかも札ごとに理由を書く（「ルール数を取得できませんでした」）。**前の数を残さない**ことも確かめた——先に読めた状態（5件・552回・累計3,979）から失敗させると、どの数も残らず `—` になる（`setItems([])` を読み込みの前に置いている）。**ヒット数が1行でも欠けたら合計を出さない**（`hits !== undefined` を全行で見る）作りで、少ない合計を実値として見せない。4状態とも `data-list-state` で分かれ、1440・1920とも横スクロール0。`undefined` / `Invalid Date` / `NaN` / `API error` / `Failed to fetch` はどこにも無い。P2 設計との残る差（ルールごとの当たり方の推移、複数アカウントの出し分けの面）は未確認',
    verdictSource: 'auto-replies-v6/q8wSqO-normal.txt + q8wSqO-error.txt', verdictHead: 'd0680774',
  },

  // ── 機能9 友だち追加時の配信 ────────────────────────────
  /*
    **設計と実装で、持ち物の数が違う。**
    設計は「流入リンクごとに初回案内を並べる一覧」＋5段のウィザード。
    実装は**アカウントに1枚**の設定（`FriendAddRouting`）で、
    ①はじめて追加した人 と ②以前からの友だち の2つに分けるだけ。
    流入リンクで出し分ける仕組みがそもそも無い。
  */
  { ...FRIEND_ADD, node: 'uLQQc', name: '9-1 友だち追加時の配信', verdict: 'needs_fix', verdictNote: '**#431 `2ab18c88` で撮った。** 「友だちに追加されたときに何を配信するかを決めます。**はじめての人と、以前からの友だち・ブロックを解除した人で分けられます。**」と、2つの相手を先に説明する。1つめの節に「このアカウントを**一度も友だち追加したことがない人**が対象です。」と、誰が入るかを書く。壊れ値・内部語は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計は配信内容の下見と、送る条件の重なりをその場で見せる', verdictSource: 'friend-add-v6/uLQQc.txt' , verdictHead: '2ab18c88' },
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
  { ...FRIEND_ADD, node: 'txMO9', name: '9-1-D アクション追加', verdict: 'needs_fix', verdictNote: '**#431 `2ab18c88` で撮った。** 壊れ値・内部語は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計との差（配信内容の下見、条件の重なり）は `uLQQc` と同じ', verdictSource: 'friend-add-v6/txMO9.txt' , verdictHead: '2ab18c88' },
  {
    ...FRIEND_ADD, node: 'U3SI5', name: '9-1-E プレビューとテスト',
    verdict: 'needs_fix', verdictNote: '**#431 `2ab18c88` で撮った。** 壊れ値・内部語は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計との差は `uLQQc` と同じ', verdictSource: 'friend-add-v6/U3SI5.txt',
    mode: 'viewport', height: 1080, steps: [{ click: 'テスト実行' }],
    verdictHead: '2ab18c88',
  },
  {
    ...FRIEND_ADD, node: 'ec9vg', name: '9-1-F 最終確認',
    gap: 'api',
    gapNote: '`friend-add-rules` のdraft、validate、conflicts、test、publishと冪等キーが要る。流入条件・初回案内・アクション・二重送信防止を確認し、公開版を固定する',
    status: 'unimplemented', why: '現行はアカウント単位のJSONを「保存」で即時反映する。設計の対象見込み、二重経路、テスト完了、公開版を保証するAPIが無く、正式要件 §7 のrule/validate/publish契約が未実装',
  },
  {
    ...FRIEND_ADD, node: 'quhg6', name: '9-1-G 有効化完了',
    gap: 'api',
    gapNote: '`publish` の返事（公開版、対象見込み、二重送信防止、監視先）を受けて完了画面を出す。9-1-Fと同じ契約で作る',
    status: 'unimplemented', why: '現行PUTは公開結果や版を返さない。9-1-Fのdraft/validate/publish実装が前提',
  },
  {
    ...FRIEND_ADD, node: 'P2J0Te', name: '9-1-H 実行結果',
    route: '/friend-add-settings/runs', mode: 'page',
    states: { apis: ['**/api/friend-add-routing/events*', '**/api/friend-add-routing/events/**'], kinds: ['normal', 'loading', 'empty', 'error'] },
    verdict: 'needs_fix',
    verdictNote: '**#506 で実行結果の画面が入り、未実装ではなくなった。** 未取得の扱いが設計より丁寧で、上の案内に「LINE公式アカウントの通常URLや公式QRから追加された場合、正確な流入経路は取得できません。**取得できない記録は0件にせず「経路は取得できません」と表示します。**」と書き、実際に行でもそう出る。処理できなかった行の処理日時は「—」。P1 設計の右側3枚（稼働状況＝状態・二重送信防止・最終配信・平均送信0.8秒／要テスト＝未送信3件とテストの導線／担当者シナリオ開始＝テスト待ち8・対応中21・完了7）が無い。「流入経路別の内訳」（予約128回59.8%／Webサイト54回25.2%／紹介キャンペーン32回15.0%）も無い。実行結果をCSVで書き出す、配信を一時停止 の導線も無い。P2 帯4つの中身が設計と違う（設計は 直近28日の追加214人／累計配信1,842通／シナリオ開始198件／エラー3件）',
    verdictSource: 'friend-add-v6/P2J0Te-normal-1920.png',
    verdictHead: '5dc99107',
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
  { ...WEBINAR, node: 'ZC13r', name: '10-1 ウェビナー', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮り、設計の記述と突き合わせた。** **P1 どのウェビナーが効いているかを一覧で比べられない。** 設計は行ごとに **申込184人 / 視聴142人** を出す。実装の帯は 申込 `—`「一覧では数えられません」／平均視聴率 `—`「申込者のうち」／平均視聴時間 `—`「視聴ログの集計は未対応」の3つとも `—`。**断り方は正しい**（数えていないものを0にしない）が、比べるには1本ずつ「概要・分析を見る」を開いて覚えておくことになる。6本あれば6回開く。`WebinarAnalytics` は1本ぶんを全部返せるので、**足りないのはまとめて数える口だけ**。P2 設計は表、実装は札の格子で作りが違う。1440・1920とも横スクロール0、壊れ値・内部語0件', verdictSource: 'webinars-v6/ZC13r.txt + webinars-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...WEBINAR, node: 'lvaY5', name: '10-1-A ウェビナーを作成', route: '/webinars/new', verdict: 'needs_fix', verdictNote: '**P1 作成の段が無い。** ルート `/webinars/new`。撮った本文の見出しは「ウェビナーを作る／録画と配信枠を設定すると、友だちが『◯』…」の1枚で、設計の 基本 → 動画・公開設定 → CTA・フォーム → 通知 → 視聴後 → 公開前確認 という段が無い。**段の終わり（公開前確認 `D6yO7e`・公開完了 `TimXl`）が未実装**なので、作り終えたかどうかを画面が言えない。**推奨修正**：#508 が `D6yO7e` を実装済みなので、#507 → #508 の取り込み後に段を通す。取得元：`webinars-v6/lvaY5.txt`。1440・1920とも横スクロール0', verdictSource: 'webinars-v6/lvaY5.txt' , verdictHead: 'c275749d' },
  {
    ...WEBINAR, node: 'PV1Vh', name: '10-1-B 動画・公開設定', route: WEBINAR_EDIT,
    verdict: 'needs_fix', verdictNote: '**P2 動画・公開設定が1枚に同居している。** ルート `/webinars/edit?id=wb-1`。撮った本文は「ウェビナーの編集／動画セミナーの公開設定と、視聴中・視聴後…」で始まり、**`d3rFGD`（CTA・フォーム）`Xjk8q`（視聴後アクション）と同じ1枚**。設計はそれぞれ別の段。**同じ画面を3つのNodeで指しているので、どこを直したか追いにくい。** 取得元：`webinars-v6/PV1Vh.txt`。1440・1920とも横スクロール0', verdictSource: 'webinars-v6/PV1Vh.txt',
    steps: [{ click: 'いつ見られるようにするか' }],
    verdictHead: 'c275749d',
  },
  {
    ...WEBINAR, node: 'd3rFGD', name: '10-1-C CTA・フォーム', route: WEBINAR_EDIT,
    verdict: 'needs_fix', verdictNote: '**P2 CTA・フォームが `PV1Vh` と同じ1枚の中にある。** ルート `/webinars/edit?id=wb-1`。設計は別の段。取得元：`webinars-v6/d3rFGD.txt`。1440・1920とも横スクロール0', verdictSource: 'webinars-v6/d3rFGD.txt',
    steps: [{ click: '見ている途中に出すもの' }],
    verdictHead: 'c275749d',
  },
  {
    ...WEBINAR, node: 'Ho8z4', name: '10-1-D 通知・リマインド', route: WEBINAR_EDIT,
    steps: [{ click: '通知とリマインド' }],
    verdict: 'needs_fix',
    verdictNote: '**#546 で通知とリマインドが入り、未実装ではなくなった。** 設計が求めた4つ（申込直後の受付確認／前日20:00／開始1時間前／開始時、および未視聴者へ翌日10:00の見逃し案内）と視聴完了のお礼まで揃い、**設計より細かく編集できる**（設計は畳んだ行、実装は1つずつ切り替えと時刻の欄）。「日程を選び直したときは、前の回の未送信予定を取り消し、新しい回へ作り直します。」も書いてある。P2 STEP1〜5の進み表示が無い。設定サマリーの中身が違う（設計は 対象完了・リマインド・対象184人・タグ「配信済み」を追加、実装は 通知6種類・送信待ち42件・送信済み138件・送れなかったもの2件。実装のほうが運用に効く）。テスト送信と公開ページを見るが押せない（設計は押せる）。下書き保存と「視聴後アクションへ」の導線が無い。時刻が08:00 PM/10:00 AMと英語書式になるのは撮影側のブラウザ言語の癖',
    verdictSource: 'webinars-v6/Ho8z4-1920.png',
    verdictHead: 'de0848b9',
  },
  {
    ...WEBINAR, node: 'Xjk8q', name: '10-1-E 視聴後アクション', route: WEBINAR_EDIT,
    verdict: 'needs_fix', verdictNote: '**P2 視聴後アクションが `PV1Vh` と同じ1枚の中にある。** ルート `/webinars/edit?id=wb-1`。設計は別の段。取得元：`webinars-v6/Xjk8q.txt`。1440・1920とも横スクロール0', verdictSource: 'webinars-v6/Xjk8q.txt',
    steps: [{ click: 'いつ見られるようにするか' }],
    verdictHead: 'c275749d',
  },
  {
    ...WEBINAR, node: 'GB0NR', name: '10-1-F 公開ページプレビュー', route: WEBINAR_EDIT,
    mode: 'viewport', height: 1080,
    verdict: 'needs_fix',
    verdictNote: '**#507 で公開ページを見る導線が実データへつながった。** ただし撮った head では**押せない**まま（`<Button data-design-node="GB0NR" disabled title={previewUnavailableReason}>`）。LIFF IDが確認できないアカウントでは理由付きで止める作りで、**押せて何も起きないより良い**。P1 押せる状態の絵は、LIFF IDを持つ固定データを用意しないと撮れない。設計は押せる',
    verdictSource: 'webinars-v6/GB0NR-1920.png',
    verdictHead: '61eeb3c7',
  },
  {
    ...WEBINAR, node: 'D6yO7e', name: '10-1-G 公開前確認',
    gap: 'pending',
    gapNote: '#508 head `61eeb3c7` で動画・配信枠・長さを検査し、公開内容を読む確認窓を実装済み。取り込み順は #507 → #508',
    status: 'unimplemented', why: '#508で `ConfirmDialog` を使った公開前確認を実装済み。最新headの画像確認待ち',
  },
  {
    /*
      **`/webinars/published?id=` で開く。** 公開の口が実際に返したIDだけを
      渡す作りで（`webinar-form.tsx` の `updated.data.id`）、
      `status !== 'active'` のときは完了として出さない。
    */
    ...WEBINAR, node: 'TimXl', name: '10-1-H 公開完了',
    route: '/webinars/published?id=webinar-1', mode: 'page',
    verdict: 'needs_fix',
    verdictNote: '**#507 → #508 で公開完了が入り、未実装ではなくなった。** 「公開しました」＋公開状態・公開URL・動画の長さ43分・配信枠2件。**出せないものを出さない**のが良い：「所属するLINE公式アカウントのLIFF IDを確認できないため、公開ページのボタンは出していません。」と理由を添えて隠す。「公開後の申込数や視聴結果は、編集画面の「概要・分析」で確認できます。」も書いてある。完了画面へ渡すIDは公開の口が実際に返したものだけ（契約試験が `?status=success` を禁じている）。P2 設計との細かな差は未確認（設計 TimXl の面と1枚ずつ並べるのは次の回）',
    verdictSource: 'webinars-v6/TimXl-1920.png',
    verdictHead: '61eeb3c7',
  },
  {
    ...WEBINAR, node: 'Q8sHa', name: '10-1-I 参加者管理', route: WEBINAR_EDIT,
    verdict: 'needs_fix', verdictNote: '**P2 参加者管理が `yxyzQ`（分析）と同じ1枚の中にある。** ルート `/webinars/edit?id=wb-1`。設計は別の画面。取得元：`webinars-v6/Q8sHa.txt`。1440・1920とも横スクロール0', verdictSource: 'webinars-v6/Q8sHa.txt',
    steps: [{ click: '概要・分析' }],
    verdictHead: 'c275749d',
  },
  {
    ...WEBINAR, node: 'yxyzQ', name: '10-1-J 分析', route: WEBINAR_EDIT,
    verdict: 'needs_fix', verdictNote: '**P2 分析が `Q8sHa` と同じ1枚の中にある。** ルート `/webinars/edit?id=wb-1`。1本ぶんの申込・視聴・CTAは `WebinarAnalytics` から出せている。**一覧側でまとめて数える口が無い**ので `ZC13r` の帯が `—` のままになる（同じ根）。取得元：`webinars-v6/yxyzQ.txt`。1440・1920とも横スクロール0', verdictSource: 'webinars-v6/yxyzQ.txt',
    steps: [{ click: '概要・分析' }],
    verdictHead: 'c275749d',
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
    verdict: 'needs_fix', verdictNote: '**#524 `a6c35ee0` で束4の完了条件を満たした。** 失敗のとき帯は **ウェビナー `—件`／公開中 `—`／申込 `—`** で、ウェビナーだけ `0件` と数えていた差は解消した。読込・空・失敗が分かれる。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の一覧の作り（回ごとの申込の推移、視聴後のフォロー配信の状態）はこの直しの外',
    verdictSource: 'webinars-v6/zCQXe-error.txt', verdictHead: 'a6c35ee0',
  },

  // ── 機能11 テンプレート ─────────────────────────────────
  /*
    設計のタブは6本（メッセージ／カルーセル／リッチメッセージ／質問／
    クーポン／リサーチ）。実装は5本で、**「質問」だけが無い。**
  */
  { ...TEMPLATE, node: 'W7LBc', name: '11-1 テンプレート', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮った。** P2 種類のタブが設計より1つ少ない（**「質問」が無い**。#572 で `NNDMR` として入ったので、取り込み後に数え直す）。P2 フォルダを作る導線は #493 が担当。1440・1920とも横スクロール0', verdictSource: 'templates-v6/W7LBc.txt + templates-v6/design-qa.md' , verdictHead: 'c275749d' },
  {
    ...TEMPLATE, node: 'GFlD7', name: '11-1-A メッセージを作る',
    verdict: 'needs_fix', verdictNote: '**P2 メッセージを作る面が設計とそろわない。** ルート `/templates`。**タブに件数は付いている**（メッセージ22／カルーセル24／リッチメッセージ10／クーポン6／リサーチ4）。設計との差は本文の上限（1通5,000字・合計22,500字・最大5通・4,500字で自動分割）、ボタンの編集（最大4つ・ラベルと動き）、URLの扱いの表（サイト名・URL・計測）。取得元：`templates-v6/GFlD7.txt`。1440・1920とも横スクロール0', verdictSource: 'templates-v6/GFlD7.txt',
    steps: [{ click: 'テンプレートを作る' }],
    verdictHead: 'c275749d',
  },
  {
    ...TEMPLATE, node: 'FRkls', name: '11-1-B カルーセルを作る',
    verdict: 'needs_fix', verdictNote: '**P2 カルーセルを作る面が設計とそろわない。** ルート `/templates`（カルーセル→カードセットを作る）。設計との差はカードごとの並べ替えと画像の比率の指定。取得元：`templates-v6/FRkls.txt`。1440・1920とも横スクロール0', verdictSource: 'templates-v6/FRkls.txt',
    steps: [{ click: 'カルーセル' }, { click: 'カードセットを作る' }],
    verdictHead: 'c275749d',
  },
  {
    /*
      **#572 で「質問」ができた。** ルートは `/templates/questions/new`。
      `?id=` が無いので読み込みは走らず、通常状態がそのまま出る。
      **使用先は 0 と言わず「保存後にシナリオから選べます」**（`:214`）。
    */
    ...TEMPLATE, node: 'NNDMR', name: '11-1-C 質問を作る',
    route: '/templates/questions/new', mode: 'page',
    verdict: 'needs_fix',
    verdictNote: '**#572 `e4ab641f` で「質問」ができ、未実装ではなくなった**（種類のタブに質問が無く `gap: \'api\'` だった）。ルートは `/templates/questions/new`。**画面**：上部バーだけに「質問を作る」（本文はパンくずのみで重複なし）、管理名＋フォルダ（既存フォルダを補完）、**質問と選択肢の2カラム**（`xl:grid-cols-2`。先頭の選択肢だけ開き、他は見出しで開閉する仕様）、LINEプレビュー、答えをどこに残すか、この質問を使う場所、下部追従バー（「下書きはシナリオの選択肢に出ません。」＋ キャンセル／下書きに保存／テンプレートを保存）。1440・1920とも横スクロール0、`undefined` / `NaN` / 内部IDは0件。**動作を4つとも通した**：①「下書きに保存」は `POST /api/templates` に `questionStatus:"draft"` を送る、②「テンプレートを保存」は `"published"`、③**下書きと公開済みを同じ一覧に入れると、シナリオの選択肢には公開済みだけが出る**（`scenario-detail-client.tsx:339`）、④**回答先が保たれる**——公開済みを開いて保存し直すと `addTagIds` `removeTagIds` `field` `scenario` が選択肢ごとにそのまま送られ、開き直しても変わらない（`answerTarget` という欄は無く、回答先は選択肢ごとに分かれて入る）。**配信**：即時配信は専用の契約テストがあり、質問は `text`＋`flex` の2通で送られ記録も2件（**ふつうのテキストへ潰れない**）。土台の `buildQuestionMessages` も7件で押さえてある。**P2 使用先が取れないと「シナリオ 0通」と出る**——`usages` が失敗しても `usageCount` が初期値0のままで、未取得の状態を持たない（`questions/new/page.tsx:71`）。**P2 テスト送信の経路に、質問での契約テストが無い**（`scenario-test-send.ts:44` は即時配信と同じ `buildQuestionMessages` を呼ぶのでコード上は同じ。試験だけが片側にしかない）。**P2 `<main>` が入れ子**（画面の外枠と `questions/new/page.tsx:145` の2つ）。1ページに1つにしてほしい',
    verdictSource: 'templates-v6/NNDMR-1440.png + apps/worker 契約テスト43件',
    verdictHead: 'e4ab641f',
  },
  {
    ...TEMPLATE, node: 'j9ixI', name: '11-1-D リッチメッセージを作る',
    verdict: 'needs_fix', verdictNote: '**P2 リッチメッセージを作る面が設計とそろわない。** ルート `/templates`（リッチメッセージ→作る）。設計との差は領域の分け方の見本を選ぶところ。取得元：`templates-v6/j9ixI.txt`。1440・1920とも横スクロール0', verdictSource: 'templates-v6/j9ixI.txt',
    steps: [{ click: 'リッチメッセージ' }, { click: 'リッチメッセージを作る' }],
    verdictHead: 'c275749d',
  },
  {
    ...TEMPLATE, node: 'hsBtl', name: '11-1-E クーポンを作る',
    verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮り、設計の記述と突き合わせた。P1 クーポンそのものが作れない。** 実装の入力欄は **名前・特典内容の自由記入・クーポンを開くURL の3つだけ**（`broadcast-asset-manager.tsx:76`）で、**どこか別で作ったクーポンのURLを貼るだけ**。設計が持つ 画像（1029×1029）／使える期間／**使える回数（1人1回・何回でも）**／だれに見えるか／抽選（確率・当選上限）／クーポンコード／使われたときに実行すること は**どれも無い**（本文を数えて「使える回数」「使用期限」「1人あたり」いずれも0件）。**クーポンは配ったあとに効き方が変わるもの**なので、回数と期間が無いと配ったあとに止められない。1440・1920とも横スクロール0', verdictSource: 'templates-v6/hsBtl.txt + templates-v6/design-qa.md',
    steps: [{ click: 'クーポン' }, { click: 'クーポンを作る' }],
    verdictHead: 'c275749d',
  },
  {
    ...TEMPLATE, node: 'J3GxEZ', name: '11-1-F リサーチを作る',
    verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮った。P1 リサーチも名前とURLしか作れない**（`hsBtl` と同じ作り）。設計の**選択肢**と**集計**は本文を数えて0件。**答えを受け取る先が無いまま「リサーチ」と名乗っている**ので、押した人の答えがどこにも残らない。1440・1920とも横スクロール0', verdictSource: 'templates-v6/J3GxEZ.txt + templates-v6/design-qa.md',
    steps: [{ click: 'リサーチ' }, { click: 'リサーチを作る' }],
    verdictHead: 'c275749d',
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
    states: { apis: ['**/api/templates*', '**/api/templates/**', '**/api/broadcast-message-assets*'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: '**#528 `1b95452d` で束4の完了条件を満たした。** 失敗のとき、上のタブ（メッセージ／カルーセル／リッチメッセージ／クーポン／リサーチ）もフォルダ（すべて／よく使う／未分類）も**件数がすべて `—`** になる。以前は0を数えていた。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計のタブは「質問」を含む6本で、質問は #572 で別に入った。並びと数えかたの突き合わせはそちらの取り込み後',
    verdictSource: 'templates-v6/NKyoA-error.txt', verdictHead: '1b95452d',
  },

  // ── 機能12 リッチメニュー ───────────────────────────────
  /*
    設計は3段（形とボタン→誰に出すか→公開のしかた）。実装は1枚もの。
    段は無いが**中身は同じ画面に全部ある**ので、同じ絵を3つの設計と
    突き合わせる形にする。
  */
  { ...RICH_MENU, node: 'GO8RQ', name: '12-1 リッチメニュー', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮り、設計の記述と突き合わせた。P1 どれが出るかを決める『順番』が画面に出ない。** リッチメニューは**同じ友だちが複数に当てはまったとき、いちばん上の1つだけ**が出る。つまり順番がそのまま「お客さまに何が見えるか」。設計は3つで支える——見出しの「出す順番を変える」／「上にあるものが優先されます。同じ友だちが複数のメニューに当てはまるときは、いちばん上の1つだけが出ます。」の断り／並び順の既定を「出す順番（自分で決めた順）」にする。**実装はどれも無い**（本文を数えて「評価順」「順番」「上から順」「優先」すべて0件）。並び順の既定は「タップ数が多い順」（`page.tsx:93`）なので、**画面に出ている並びは実際に出る順番と関係が無い**。上から2番目に見えるメニューが最後に判定されることがある。`targetingPriority` はデータとして持っているのに、画面が一度も出していない。P2 設計は表、実装は札の格子。1440・1920とも横スクロール0', verdictSource: 'rich-menus-v6/GO8RQ.txt + rich-menus-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...RICH_MENU, node: 'XtfO3', name: '12-1-A メニューを作る・形とボタン', route: '/rich-menus/new', verdict: 'needs_fix', verdictNote: '**P2 形とボタンが1枚に同居している。** ルート `/rich-menus/new`。撮った本文は「リッチメニューを作る／名前と土台のレイアウトを決め…」で、`kQ1bs`（誰に出すか）`UMiJ9`（公開のしかた）と**同じ1枚**。設計は段で分ける。**`GO8RQ` のP1（出る順番が見えない）と同じ根で、ここでも優先の説明が無い。** 取得元：`rich-menus-v6/XtfO3.txt`。1440・1920とも横スクロール0', verdictSource: 'rich-menus-v6/XtfO3.txt' , verdictHead: 'c275749d' },
  { ...RICH_MENU, node: 'kQ1bs', name: '12-1-B メニューを作る・誰に出すか', route: RM_EDIT, verdict: 'needs_fix', verdictNote: '**P1 出し分けの条件を決める画面なのに、当てはまったときにどれが優先されるかが出ない。** ルート `/rich-menus/edit?id=rmg-1`。`XtfO3` `UMiJ9` と同じ1枚の中にある。**`targetingPriority` は持っているのに画面が出さない**（`GO8RQ` と同じ根）。**推奨修正**：この節に「上にあるものが優先されます」の断りと、いまの順番を出す。取得元：`rich-menus-v6/kQ1bs.txt`。1440・1920とも横スクロール0', verdictSource: 'rich-menus-v6/kQ1bs.txt' , verdictHead: 'c275749d' },
  {
    /*
      **#509 で `/rich-menus/connections?id=` が入った。**
      既存の pages / areas から切替のつながりを解析する。
      `NXdDk` は同じ画面の「つながりが無い」状態。
    */
    ...RICH_MENU, node: 'DIUbO', name: '12-1-C 切替メニューのつながり',
    route: '/rich-menus/connections?id=rmg-1', mode: 'page',
    verdict: 'needs_fix',
    verdictNote: '**#509 で切替のつながりが入り、未実装ではなくなった。** 設計がいちばん心配していた「戻れない」を実際に見つける。トップ（入口）→商品を見る／予約する、商品を見る→トップへ戻る（**入口へ戻れます**）、予約する（**入口へ戻れません**・赤い!）。上に「1件の確認事項があります。公開する前に、入口からの行き先と戻り道を確認してください。」。**「矢印は保存済みの切替ボタンです。番号や内部IDは表示しません。」と、内部IDを出さないことを画面で宣言している。** 切替先が下書きのままかも「LINEへ未公開」で分かる。P2 設計の「よくある事故」3つのうち、**切替先だけ『誰に出すか』が違う**は見ていない。設計は線の図、実装はカードの並び',
    verdictSource: 'rich-menus-v6/DIUbO-1920.png',
    verdictHead: 'e148615c',
  },
  {
    ...RICH_MENU, node: 'NXdDk', name: '12-1-C-A つながりなし',
    route: '/rich-menus/connections?id=rmg-2', mode: 'page',
    verdict: 'needs_fix',
    verdictNote: '**#509 でつながりなしの状態も入った。** 「切替のつながりはありません／このメニューには、別ページへ切り替えるボタンがまだありません。」＋「メニューのボタンを編集」。上に「ページを切り替えるボタンを作ると、ここで行き先と戻り道を確認できます。」。**空を失敗と混ぜず、次にやることを出している。** P2 設計との細かな差は未確認',
    verdictSource: 'rich-menus-v6/NXdDk-1920.png',
    verdictHead: 'e148615c',
  },
  { ...RICH_MENU, node: 'UMiJ9', name: '12-1-D メニューを作る・公開のしかた', route: RM_EDIT, verdict: 'needs_fix', verdictNote: '**P2 公開のしかたが `XtfO3` と同じ1枚の中にある。** ルート `/rich-menus/edit?id=rmg-1`。設計は別の段。取得元：`rich-menus-v6/UMiJ9.txt`。1440・1920とも横スクロール0', verdictSource: 'rich-menus-v6/UMiJ9.txt' , verdictHead: 'c275749d' },
  { ...RICH_MENU, node: 'TL7tp', name: '12-1-E 管理画面の外のメニューを取り込む', verdict: 'needs_fix', verdictNote: '**P2 管理画面の外のメニューが、設計では別画面だが実装は一覧の中の節。** ルート `/rich-menus`。取り込みと削除はできる。取得元：`rich-menus-v6/TL7tp.txt`。1440・1920とも横スクロール0', verdictSource: 'rich-menus-v6/TL7tp.txt' , verdictHead: 'c275749d' },
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
    verdict: 'needs_fix', verdictNote: '**#523 `47e7846e` は束3（内部の言葉）の直しで、束4は半分しか満たしていない。** タップ側は直った——今月のタップ `—`「集計を取れませんでした」、最多タップ `—`「まだ押されていません」。**P1 しかし失敗のとき メニュー `0件`／公開中 `0`／出し分け `0件` と数える。** 原因は帯が `groups` から直に数えているため（`rich-menus/page.tsx:349` の `groups.filter(...).length`）。読み込みに失敗すると `groups` が `[]` になり、**持っているメニューが1つも無いように見える**。`tapStats` だけ `—` の逃げ道を持ち（`:355,368`）、`groups` 側には無い。**推奨修正**：読込状態（`loading|ready|error`）を持ち、`ready` 以外は件数を `—` にする（`q76C35` `q8wSqO` と同じ形）。P2 失敗を知らせる文が本文に出ず、「タグ条件で出し分けているメニューはありません」だけが残る。1440・1920とも横スクロール0',
    verdictSource: 'rich-menus-v6/RW5Tb-error.txt', verdictHead: '47e7846e',
  },

  // ── 機能13 回答フォーム ─────────────────────────────────
  /*
    設計は一覧・編集（3つのタブ）・集まった回答の3つ。実装は一覧と回答が
    同じ画面で、編集は別ルート。**「デザイン設定」は押せない状態で置いてある**
    （見た目をアプリにそろえる方針にしたため、と画面に書いてある）。
  */
  { ...FORM, node: 'EMBIK', name: '13-1 回答フォーム', verdict: 'needs_fix', verdictNote: '**画面全体は要修正のまま。** P1 一覧の列に「回答の保存先」（友だち情報欄3・タグ2）が無い。このフォームに答えると友だちの何が書き換わるかを一覧で読めない。**どこへ書いているかは、消す前・変える前にいちばん要る情報**。実装の札は名前・回答数・最終回答だけで、保存先を知るには1つずつ編集画面を開くことになる。P2 帯の4枚のうち「今月の回答」「回答率」は `page.tsx:331,335` で **`—` を直に書いている**（集計の経路が無いことを画面のコメントでも断っている）。断り方は正しいが、数は出ない ／ **#436 の受入条件は確認済み**（head `35c613a6`）。1440・1920とも横スクロール0。`undefined` / `Invalid Date` / `NaN` / 内部ID（`form-1` `sub-1` `friend-4`）はいずれも0件', verdictSource: 'forms-v6/EMBIK-1440.png' , verdictHead: '35c613a6' },
  { ...FORM, node: 'vCqUj', name: '13-1-A フォームを作る', route: FORM_EDIT, verdict: 'needs_fix', verdictNote: 'P1 フォームを作る面が設計とそろわない', verdictSource: 'forms-v6/design-qa.md' , verdictHead: 'c275749d' },
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
    verdictHead: 'c275749d',
  },
  { ...FORM, node: 'v9tYhl', name: '13-1-D 集まった回答', steps: [{ click: '来店アンケート' }], verdict: 'needs_fix', verdictNote: '**画面全体は要修正のまま。** P1 情報欄への書き込みが失敗した件数が出ない（設計は「3件は欄が消えていて書けていません」）。**答えは受け取れているのに友だち情報へ入っていない状態が、画面のどこにも出ない。** P1 「1件ずつ見る／まとめて見る」の切り替え、絞り込み、CSVで書き出すが無い ／ **#436 の受入条件は確認済み**（head `35c613a6`）。回答の表は 友だち名・日時・各項目で、**答えの無い項目は `—`**、友だちが分からない行は「不明」、未記入は「（未記入）」と書き分ける。下に **「1〜4件 / 全4件」「20件表示」「前へ 1 次へ」** が出て、APIが返した `page` / `limit` / `total` をそのまま使う。1440・1920とも横スクロール0。`undefined` / `Invalid Date` / `NaN` / 内部IDは0件', verdictSource: 'forms-v6/v9tYhl-1440.png' , verdictHead: '35c613a6' },
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
    verdict: 'needs_fix', verdictNote: '**P0「取得失敗を空として出す」は2本に分かれて直る。** ①**本文** は **#436** の担当で、`loadError` を持ち `ListState kind="error"` へ分け、失敗のとき作成の誘いを出さない（`form-submissions/page.tsx:396`）。②**帯** は **#556** の担当で、`form-kpi-value.tsx` を足して未取得を `—`、実値0を `0件` に描き分ける。**#436 の木に `form-kpi-value.tsx` は無い**ので、#436 だけでは帯が直らない。**この判定は #556 `6037aeef` で撮ったもの**（そこには #436 の旧head `950073ab` が入っている。#436 の旧→新は `apps/web` の差分0件なので、判定は新head `35c613a6` でも変わらない）。失敗のとき帯は4つとも `—`、本文は「回答フォームを読み込めませんでした／通信状態を確認して、もう一度読み込んでください。」＋再読み込み。空のときは フォーム **0件**・公開中 **0件**、今月の回答 **—**「月ごとの集計は未対応」、回答率 **—**「配った人数を持っていません」。3状態とも `data-list-state` で分かれ、1440・1920とも横スクロール0。**束1と束4の完了条件を満たし、`dC0yg` `TmHjF` と並ぶ手本になった。** P2 残るのは設計の一覧の作り（フォームごとの回答数の推移、公開/停止の切替）',
    verdictSource: 'forms-v6/ZOPyc-error.txt + forms-v6/ZOPyc-empty.txt', verdictHead: '1c1546cb',
  },

  // ── 機能14 共通情報 ─────────────────────────────────────
  { ...COMMON_VAR, node: 'WuKzU', name: '14-1 共通情報', verdict: 'needs_fix', verdictNote: 'P1 一覧に「使われている場所」の数が出ない。共通情報は1か所直すと差し込んでいる全部の文が同時に変わるので、どこで使われているかが要る', verdictSource: 'common-vars-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...COMMON_VAR, node: 'gBtaK', name: '14-1-A 共通情報を編集', route: '/contents/vars/edit?id=cv-1', verdict: 'needs_fix', verdictNote: 'P1 編集画面そのものには、どこで使われているかが1つも出ない（名前・フォルダ・差し込み名・値・更新スケジュールだけ）。**ただし #548 で「保存」を押すと影響確認の面（`uNBlA`）へ進むようになった**ので、「どこが変わるか見えないまま保存する」状態ではなくなった。P2 設計は値の下に「保存すると、下の15か所すべてが すぐに変わります」と常に出す。実装は押してから出る', verdictSource: 'common-vars-v6/uNBlA-1920.png' , verdictHead: 'c275749d' },
  {
    /*
      **#548 で「変える前に影響を見る」が入った。**
      編集画面（`/contents/vars/edit?id=`）の中に、影響の一覧が出る。
      文字数の上限は口が無いので `—` と理由が出る。
    */
    ...COMMON_VAR, node: 'uNBlA', name: '14-1-B 変える前に影響を見る',
    route: '/contents/vars/edit?id=cv-1', mode: 'page',
    /*
      **値を変えてから「保存」を押さないと出ない。**
      `reviewBeforeSave` は `value === item.value` のとき影響を見ずに
      そのまま保存する（`contents/vars/edit/page.tsx:136`）。
      変えずに押すと保存が走るだけで、影響の面は撮れない。
    */
    steps: [
      { fill: '#cv-value', selector: true, text: '株式会社NEN（新しい表記）' },
      { click: '保存' },
      { wait: 800 },
    ],
    verdict: 'needs_fix',
    verdictNote: '**#548 で「変える前に影響を見る」が入り、未実装ではなくなった。束9の手本になる。** 「「会社名」を直すと、使用中の15か所へ反映されます。内容を確認してから保存してください。」＋帯4つ（変わる場所15か所〈下書き・配信予定・自動処理を含みます〉／すぐ効くもの12か所／文字数の確認 **—件・要確認・「送信先ごとの上限は未接続です」**／送信済みの文1か所〈過去に送った内容は変わりません〉）。表に現在の文と保存後の文を並べる。**所属を確定できないものを黙って落とさない**：「所属するLINEアカウントを確認できない回答フォームが3件あります。内容を見せず、安全のため影響件数に含めています。」。P2 設計の「本文が 66 / 60 字」（文字数の上限超え）は口が無く—のまま。理由を添えているので正しい出し方',
    verdictSource: 'common-vars-v6/uNBlA-1920.png',
    verdictHead: 'd4a85ad4',
  },
  {
    ...COMMON_VAR, node: 'yPkWe', name: '14-1-C 共通情報の削除確認',
    gap: 'api',
    gapNote: '確認窓だけでは作れない。使用先と版、変更前後の文、予約中・公開中を返す影響確認、互換種類の代替候補、全使用先の差し替え、旧定義のアーカイブ、実行結果の記録が要る。#437の削除影響APIは件数と種類別集計までで、V6の差し替えは未実装',
    status: 'unimplemented',
    why: 'V6要件 §11 は使用中の物理削除を禁止し、代替への差し替え後に旧定義をアーカイブする。#437は使用中DELETEを409で止める安全柵を追加したが、代替選択・プレビュー・一括差し替え・版履歴・アーカイブは無い。ブラウザの `confirm()` を共通部品へ替えるだけでは正本の操作にならない',
  },

  // ── 機能15 登録メディア ─────────────────────────────────
  { ...MEDIA, node: 'g89Tc', name: '15-1 登録メディア', verdict: 'needs_fix', verdictNote: '**#438 → #559 `7922c002` → #560 `7c1acd0f` で、設計との差がほぼ埋まった。** 使用先は3つに出し分ける（「3か所で使用中」／「どこでも使っていない」／「使用先を確認できません」）。**一括削除の穴も塞がった**——画面を動かして確かめた：未取得のチェック欄は `disabled` で `title="使用先を確認できないため選べません"`、使用中は `title="使用先から外すまで削除できません"`、「全てのメディアを選択」でボタンが「選択したメディアを削除（2）」になり、送られたのは `DELETE /api/media/media-3` と `media-5` の2本だけ。未取得の `media-6` は送られない。選択が古くても `removeSelected()` が送信前に外して断りを出す（`page.tsx:210`）。**#560 で寸法・並び順・表示件数が入った**：`JPG ／ 1024×678 ／ 340 KB`、`入れた日が新しい順`、`20件表示`、`前へ 1 次へ`。**寸法を持たないPDFは `PDF ／ 1.2 MB` と欄ごと出さない**（0×0にしない）。1440・1920とも横スクロール0。P2 残るのはフォルダの扱いと、設計の帯（合計容量・今月の追加）', verdictSource: 'media-v6/g89Tc-1440.png + media-v6/g89Tc-selection-559.md' , verdictHead: '7c1acd0f' },
  {
    ...MEDIA, node: 'voJtX', name: '15-1-A メディアの詳細と差し替え',
    verdict: 'needs_fix', verdictNote: 'P1 差し替えができない（grep 差し替え が /contents 配下で0件）。設計の詳細は「差し替える」が主役で、名前とURLは変わらず、使っている3か所すべてが新しい画像に変わり、予約中の配信にも効く。実装で同じことをするには消して入れ直すことになるが、**URLが変わるので使っている先が全部切れる**。商品写真を1枚だけ新しくするのは日常の作業。P1 使用中でも消せる（409が返ると「それでも削除しますか？」で消せる。page.tsx:183）。設計は「使われているあいだは削除できません。先にこの3か所から外してください。」。どちらが正しいかは決めごとだが、**いまは消したあとに何が壊れたかを知る場所が無い**', verdictSource: 'media-v6/design-qa.md',
    mode: 'viewport', height: 1080, steps: [{ click: '夏の定番セット.jpgの使用箇所' }],
    verdictHead: '7c1acd0f',
  },
  {
    /*
      設計の `eXAJP` は一覧と同じ文言。実装も**一覧の上にドロップ枠が
      常に出ている**ので、同じ絵で突き合わせる。
    */
    ...MEDIA, node: 'eXAJP', name: '15-1-B ファイルを入れる',
    verdict: 'needs_fix', verdictNote: 'P1 ファイルを入れる面が独立しておらず、一覧と同じ画面にある', verdictSource: 'media-v6/design-qa.md',
    verdictHead: 'c275749d',
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
    verdict: 'needs_fix', verdictNote: 'P1は #438 head `166f0c43` のコード上で修正済み・画像再確認待ち。`loadFailed` と `ListState kind="error"` を持ち、失敗時に空状態の文を出さない。現行比較画像は修正前の表示を含むため、API失敗状態の1440/1920画像を撮り直すまで要修正を維持する',
    verdictSource: 'media-v6/h8pBZr-error-1920.png', verdictHead: '166f0c43',
  },

  // ── 機能16 成果とアフィリエイト ─────────────────────────
  /*
    設計のタブは4本（アフィリエイター／案件／成果承認／支払い）。
    実装は5本で、**「支払い」が無く**、代わりに「成果地点（CV）」と
    「レポート」がある。支払いの2枚（`njLGA` `GqFTV`）は行き先が無い。
  */
  { ...AFFILIATE, node: 'PouPn', name: '16-1 成果とアフィリエイト', route: '/conversions?tab=affiliates', verdict: 'needs_fix', verdictNote: '**#558 で「決まった額で払う人がずっと ¥0 に見える」が直った。** 率が0%の合同会社ノースが **¥144,000**（承認ずみ16件×¥9,000）と出る。`calculateAffiliateReward`（`affiliates/affiliate-reward.ts`）が、率が0のときだけ確定した定額へ切り替える。**割合方式は後退していない**：田中 明 ¥860,000×10%＝¥86,000、木村 亮 ¥620,000×15%＝¥93,000、成果0の旧パートナーAは¥0。1440・1920とも横スクロール0。P1 帯4つ（今月の成果42件／承認待ち8件 合計¥96,000／確定した報酬¥312,000 8/31締め9/30払い／ほか）が無い。P1 「支払い」のタブが無い。まだ払っていない額・次の締め・次の支払日・振込先が未登録の人を、画面から知る方法が無い', verdictSource: 'affiliates-v6/PouPn.txt + apps/web/src/app/affiliates/affiliate-reward.ts' , verdictHead: 'c275749d' },
  { ...AFFILIATE, node: 'GH8VL', name: '16-1-A 案件', route: '/conversions?tab=offers', verdict: 'needs_fix', verdictNote: '**P2 案件の一覧が設計とそろわない。** ルート `/affiliates?tab=offers`。タブは アフィリエイター／案件／成果承認／成果地点（CV）／レポート の5本。設計との差は案件ごとの成果数と支払い予定の見せ方。取得元：`affiliates-v6/GH8VL.txt`。1440・1920とも横スクロール0', verdictSource: 'affiliates-v6/GH8VL.txt' , verdictHead: 'c275749d' },
  { ...AFFILIATE, node: 'n5VVTb', name: '16-1-B 成果承認', route: '/conversions?tab=approvals', verdict: 'needs_fix', verdictNote: '**P2 成果承認の面が設計とそろわない。** ルート `/affiliates?tab=approvals`。承認待ち／承認済み／却下 で分かれる。設計との差はまとめて承認する導線と、却下の理由の残し方。取得元：`affiliates-v6/n5VVTb.txt`。1440・1920とも横スクロール0', verdictSource: 'affiliates-v6/n5VVTb.txt' , verdictHead: 'c275749d' },
  {
    ...AFFILIATE, node: 'njLGA', name: '16-1-C 支払い',
    gap: 'api',
    gapNote: '締め日・支払日・振込先・未払い残高の表が要る',
    status: 'unimplemented',
    why: '「支払い」のタブが無い。締め日・支払日・振込先・未払い残高を扱う場所がどこにも無い（`grep 振込|締め` が0件）',
    verdictHead: 'ef7b5773',
  },
  { ...AFFILIATE, node: 'xqT1Z', name: '16-1-D アフィリエイターを登録する', route: '/affiliates/new', verdict: 'needs_fix', verdictNote: '**#558 で「報酬が売上×率でしか出ない」が直った。** どう支払うかを **成果1件ごとに定額／売上に対する割合／報酬なし（計測のみ）** から選べる。定額のときは「1件あたりの報酬」に「金額は案件ごとに決めます。」と添える。1440・1920とも横スクロール0。P2 設計との細かな差（連絡先・支払い条件の並び）は未確認', verdictSource: 'affiliates-v6/xqT1Z.txt' , verdictHead: 'c275749d' },
  {
    ...AFFILIATE, node: 'jwrbf', name: '16-1-E アフィリエイターの成果内訳',
    verdict: 'needs_fix', verdictNote: '**#563 `64798425` で `ref_tracking` が画面から消えた**（本文を数えて0件）。帯の見出しは「クリック」だけになった。**ほかの集計に後退は無い**——確定報酬 ¥86,000／¥144,000／¥93,000、案件別は 無料体験7×¥3,000＝¥21,000・定期便2×¥8,000＝¥16,000・友だち追加1×¥300＝¥300 で、審査中2件は入らない。1440・1920とも横スクロール0。**P2 同じ束の言葉がもう1つ残っている**——内訳の下の表に **`ref_code`** が列見出しとして出ている（「リンク別クリック」と「帰属ジャーニー」の2か所）。これもDBの列名で、`ref_tracking` と同じ理由で運用の人には読めない。「計測コード」などの画面の言葉にしてほしい', verdictSource: 'affiliates-v6/jwrbf.txt',
    route: '/conversions?tab=affiliates', mode: 'viewport', height: 1136,
    /* 表の行は `onClick` だけで、押せる役を持っていない。文字で探す。 */
    steps: [{ click: '田中 明', role: 'text' }],
    verdictHead: '64798425',
  },
  { ...AFFILIATE, node: 'GPWzq', name: '16-1-F 案件をつくる', route: '/affiliate-offers/new', verdict: 'needs_fix', verdictNote: '**P2 案件を作る面。節番号は付いている。** ルート `/affiliates/offers/new`。撮った本文は「1 どの案件か（案件名・対象アカウント・説明）／2 いくら払うか」と段になっており、**「1つに絞ると、そのアカウントで起きた成果だけを数えます。」「現金とマイルは併用できます」**と、選んだときに何が起きるかを添える。設計との差は成果地点の紐づけと、支払い条件（締め日・最低支払額）。取得元：`affiliates-v6/GPWzq.txt`。1440・1920とも横スクロール0', verdictSource: 'affiliates-v6/GPWzq.txt' , verdictHead: 'c275749d' },
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
  { ...MILEAGE, node: 's98Vfw', name: '17-1 マイル', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮った。P1は解決済み。** 日時は日本時間、内部の言葉は出さない。**残高0の人は `0`、最終行動が無い人は `—`** と、**数えて0と取れていないを分けている**（束4の手本）。実装が自分の穴（何が未接続か）を画面に書いているのも良い。P2 設計との細かな差（絞り込みの並び）は残る。1440・1920とも横スクロール0', verdictSource: 'mileage-v6/s98Vfw.txt + mileage-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...MILEAGE, node: 'N46cQ', name: '17-1-A たまる決めごと', route: '/mileage?tab=earning-rules', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮った。P1は解決済み。** P2 設計との細かな差（決めごとの並びと、効いている範囲の見せ方）は残る。1440・1920とも横スクロール0', verdictSource: 'mileage-v6/N46cQ.txt + mileage-v6/design-qa.md' , verdictHead: 'c275749d' },
  {
    /*
      **#549 で「マイルの使い道」が入った。**
      読む元は `GET /api/mileage/rewards`。固定データ `MILEAGE_REWARDS` は
      公開中・下書き・止めている を1件ずつと、`failurePolicy` の3種類
      （もう一度試す／マイルを戻す／人が確かめる）を持つ。
      **`neverRedeemedFriendCount` は `null`**（まだ数えていない）で、
      在庫は 0（数えて0）と `null`（上限なし）を分けてある。
    */
    ...MILEAGE, node: 'qlVLJ', name: '17-1-B マイルの使い道',
    route: '/mileage?tab=rewards', mode: 'page',
    states: { apis: ['**/api/mileage/rewards?**', '**/api/mileage/rewards'], kinds: ['normal', 'loading', 'empty', 'error'] },
    verdict: 'needs_fix',
    verdictNote: '**#549 で「マイルの使い道」が入り、未実装ではなくなった。** 未取得と0の分け方は設計より正しい：一度も使っていない人は **—人＋「未取得」札＋「取得元を接続後に表示」**（設計は786人と数を出す）。在庫は 72件／**0件**（実値0）／上限なしは行ごと出さない、で描き分ける。状態は公開中・下書き・停止中の3つ。1440・1920とも横スクロール0。P1 設計のランクの帯3つ（ブロンズ0マイルから886人／シルバー2,000マイルから312人／ゴールド5,000マイルから86人と、それぞれの特典）が無い。P1 「使い道を友だちに知らせる」の導線が無い。P2 帯の添え字が設計より薄い（設計は「58回。たまった分の58%」「マイルを持っている人の61%」「32回・16,000マイル」と割合や内訳まで出す）。「並び順を保存」が無く行ごとの↑↓だけ。ページ送りが無い',
    verdictSource: 'mileage-v6/qlVLJ-normal-1920.png',
    verdictHead: '0ae3e094',
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
  { ...MILEAGE, node: 'BmoGY', name: '17-1-D たまる決めごとをつくる', route: '/mileage/earning-rules/new', verdict: 'structure_match_data_pending', verdictNote: '**development `c275749d` で撮った。** 構造は設計とそろっており、残るのは実データの接続', verdictSource: 'mileage-v6/BmoGY.txt + mileage-v6/design-qa.md' , verdictHead: 'c275749d' },
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
    verdict: 'needs_fix', verdictNote: '**#582 `78e2f065` で、手で調整したときの失敗が日本語になった。実際に押して確かめた。** 撮影用モックは書き込みを405で返すので、そのまま失敗させると窓の中に **「この環境ではマイルを手で変更できません。」** と出る（内部語・番号は0件）。**窓は2段になっている**——①だれの・増やすか減らすか・マイル数・理由 →②**「この変更で起きること」で 変更前 2,450 mile / 変更量 +100 mile / 変更後 2,550 mile を見せてから**「この内容で増やす」。押し間違いでは動かない形。上に「記録に残ります。あとから理由をたどれるようにしてください。」と書くのも良い。**#582 は状態ごとに文を分ける**（403 権限／405 この環境／409 ほかの操作と重なった／**428 確認手順が完了していません**／通信）。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の友だち別明細は、増減の理由ごとの内訳と、取り消した記録の跡をその場で開く。実装は一覧と調整まで', verdictSource: 'mileage-v6/vz0Ji-1440.png',
    route: '/mileage/friends/detail?id=friend-1', mode: 'viewport', height: 1080,
    steps: [{ click: 'マイルを手で増やす・減らす', scope: 'main' }],
    verdictHead: '78e2f065',
  },
  {
    /*
      **公開版が固定されているかを見る。** `mr-1` は公開中が v2 で、
      直しかけの下書きが v3。編集画面を開いても公開中の版は動かない。
    */
    ...MILEAGE, node: 'p9CcEB', name: '17-1-G マイルの使い道をつくる',
    route: '/mileage/rewards/edit?id=mr-1', mode: 'page',
    verdict: 'needs_fix',
    verdictNote: '**#549 で「使い道をつくる」が入り、未実装ではなくなった。** **設計に無い安全策が3つ入っている**：「公開した版は後から書き換えません」（**公開版が固定される**）「交換は同じ操作を繰り返しても1回だけです」（二重交換を止める）「渡せなかったときの再試行・返金方法を決めます」。「渡せなかったとき」は時間をあけてもう一度試す／マイルを戻す／人が確かめる から選ぶ。**交換コードは保存後に画面へ戻さない**（「保存後は安全のため画面へ戻しません。追加分だけを入力してください。」）。空欄＝上限なし・期限なしも明記。1440・1920とも横スクロール0。P1 「だれが交換できますか」（条件を足す・15の軸・いま交換できる友だち◯人）が丸ごと無い。P1 「交換されたときにすること」（クーポンをLINEで渡す／タグを付ける などの後続処理）が無く、渡すもの1つだけ。P1 種類の4タイル（クーポン／タグを付ける／回答フォームへ／品もの）がセレクト1つになっている。P2 右の「使い道のつくりかた」3つと「つながる先」5つが無い。「まだ出していません。出すと、486人の画面にすぐ並びます。」の注記が無い。日時欄が英語書式になるのは撮影側のブラウザ言語の癖',
    verdictSource: 'mileage-v6/p9CcEB-1920.png',
    verdictHead: '0ae3e094',
  },
  {
    ...MILEAGE, node: 'k8VCU', name: '17-1-H たまる決めごと・一覧の状態',
    verdict: 'match', verdictNote: '**development `c275749d` で撮った。設計と一致。** 読込・空・失敗が分かれ、**実装が設計より2点足している**（未取得と実値0の言い分け、取れていない理由を言葉で出す）。1440・1920とも横スクロール0', verdictSource: 'mileage-v6/k8VCU-error.txt + mileage-v6/design-qa.md',
    route: '/mileage?tab=earning-rules',
    states: { apis: ['**/api/mileage/rules*', '**/api/mileage/overview*'], kinds: ['loading', 'empty', 'error'] },
    verdictHead: 'c275749d',
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
    verdictSource: 'mileage-v6/z3PB2-normal-1920.png', verdictHead: '55301679',
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
    verdict: 'needs_fix', verdictNote: 'P2（つながる先・パンくず・読む場面と直す場面の分離）', verdictSource: 'mileage-v6/design-qa-score-rules-496.md', verdictHead: '642b8222',
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
  { ...INFLOW, node: 'Q4bkTg', name: '18-1 流入と計測', route: '/inflow-links?tab=links', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮り、設計の記述と1つずつ突き合わせた。** P1 帯が設計と違う。設計は 流入元24本／今月312人（経路が分かる289人）／クリック8,420回／平均の追加率6.4% の4つ。実装は 流入元1件・今月の追加 **`—人`「前月比は出せません」**・クリック3,480回・平均の追加率4% で、**「経路が分かる何人か」が出ない**（設計はそこを分けて出す）。未取得を `—人` にして理由を書くのは正しい。P2 **タブに件数が付かない**（設計は「流入経路 24 / 広告連携 3」）。P2 **「まとめて操作」「CSVで書き出す」が無い**（本文を数えて0件）。P2 左のフォルダの縦帯が、設計はフォルダ、実装はジャンルで別の作り。1440・1920とも横スクロール0、壊れ値・内部語0件', verdictSource: 'inflow-v6/Q4bkTg.txt + inflow-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...INFLOW, node: 'IhSBB', name: '18-1-A サイトスクリプト', route: '/inflow-links?tab=script', verdict: 'needs_fix', verdictNote: 'P1 サイトスクリプトの面が設計とそろわない。18-1 全体の差（タブに件数が付かない・帯4つの作りが違う・左のフォルダの縦帯が無い・まとめて操作/CSVが無い）がここにも効く', verdictSource: 'inflow-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...INFLOW, node: 'v0HaI', name: '18-1-B 広告連携', route: '/inflow-links?tab=ads', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮った。** 「Meta広告とつながっています／成果の送信 有効・成果が起きたその場で送ります」と、いまの状態を先に書く。**送っている中身も明記**（「お客様の名前やメールアドレスは送っていません。クリックIDと成果の名前だけを送ります」）。P2 設計の「Yahoo!広告 つないでいません」から**つなげる**導線が無い（本文に「つなげる」0件）。1440・1920とも横スクロール0', verdictSource: 'inflow-v6/v0HaI.txt + inflow-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...INFLOW, node: 'TEVk8', name: '18-1-C 流入リンクをつくる', route: '/inflow-links/new', verdict: 'needs_fix', verdictNote: 'P1 流入リンクをつくる面が設計とそろわない', verdictSource: 'inflow-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...INFLOW, node: 'JupxW', name: '18-1-D 流入元の詳細', route: '/inflow-links/detail?ref=summer-ig', verdict: 'needs_fix', verdictNote: 'P1 流入元の詳細の面が設計とそろわない', verdictSource: 'inflow-v6/design-qa.md' , verdictHead: 'c275749d' },
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
    verdictHead: 'c275749d',
  },
  /*
    **判定を改めた（PR #443 head `f372ff30`）。**
    「成果を広告へ返す仕組みが無い」と書いていたが、独立したタブが無い
    だけで、**中身は「広告連携」タブに入っている。** 返した記録も、
    クリックの種類（fbclid）も、失敗の理由も出る。
  */
  { ...INFLOW, node: 'BuVDB', name: '18-2 広告とのつなぎ（成果の対応付け）', route: '/inflow-links?tab=ads', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮り、設計の3点を1つずつ数えた。** **P1 ①「成果地点と、広告に返す名前の対応」が無い**（本文に「対応が付いて」0件）。設計は**対応が付いていない成果地点を見つけられる**ようにしている。対応が無ければ返せないのに、**返せていないことに気づく場所が無い**。**P1 ②「失敗したものをまとめてやり直す」が無い**（「まとめてやり直」0件、「試行」「次の再試行」も本文に出ない）。失敗（「クリックの目印が結びつきませんでした」）は表に出るが、やり直す操作が無い。P2 ③帯が設計と違う（設計は 送った866／待っている12／断られた7／**やり直して成功23** の4つ。実装は「広告側へ返した成果 1件」だけ）。**良いところ**：接続の説明が正直で、「広告費に対して実際にいくら売れたかを見るには、広告側の費用を取り込む必要があり、**そちらはまだできていません**」と、できないことを先に書く。1440・1920とも横スクロール0', verdictSource: 'inflow-v6/BuVDB.txt + inflow-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...INFLOW, node: 'Im2b1', name: '18-2-A 広告への送信履歴', route: '/inflow-links?tab=ads', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮った。`BuVDB` と同じ1枚の中にある**（独立したタブではなく「広告連携」タブの中）。送信履歴の表（日時／成果／クリックの種類／状態／試行／次の再試行）は在り、状態が 送信済み／送信待ち／失敗 で言い分けられる。**P1 やり直す操作が無い**（`BuVDB` の②と同じ）。P2 「試行」「次の再試行」の値が `—` のまま。1440・1920とも横スクロール0', verdictSource: 'inflow-v6/Im2b1.txt + inflow-v6/design-qa.md' , verdictHead: 'c275749d' },

  // ── 機能19 コンバージョン ───────────────────────────────
  { ...CONVERSION, node: 'ZrpKn', name: '19-1 コンバージョン', route: '/conversions?tab=points', verdict: 'needs_fix', verdictNote: 'P2 「何が起きたら数えるか」にきっかけの名前（EC連携の「注文が確定」／回答フォームの送信）が出ず、種別と数え方のチップになっている。CSVで書き出す、中身を見る、使う場所を足す が無い。**「使う場所を足す」が無いので、作った成果地点を分析へつなぐ導線がこの画面に無い**。期間の選択も無い。成果地点名が長いと…で切れる（設計は折り返す）。**未取得と0件の描き分けは正しい**（金額を持たないものは「金額なし」、使われていないものは「どこからも使われていません」）', verdictSource: 'conversions-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...CONVERSION, node: 'GUxsj', name: '19-1-A コンバージョン レポート', route: '/conversions?tab=report', verdict: 'needs_fix', verdictNote: 'P1 レポートの面が設計とそろわない。詳しくは conversions-v6/design-qa.md の「GUxsj レポート — P1」', verdictSource: 'conversions-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...CONVERSION, node: 'GtylA', name: '19-1-B 成果地点をつくる', route: '/conversions/new', verdict: 'structure_match_data_pending', verdictNote: '構造一致・データ未接続', verdictSource: 'conversions-v6/design-qa.md' , verdictHead: 'c275749d' },
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
  { ...ANALYTICS, node: 'Zxezb', name: '20-1 分析（友だちの増減）', route: '/analytics?tab=friends', verdict: 'structure_match_data_pending', verdictNote: '**development `c275749d` で撮った。未取得と実値0の扱いは、この機能がいちばんよくできている。** 本文に `—` が28か所あり、**`0件` は1つも無い**（数えていないものを0で埋めていない）。データ締切も日本時間で出る。構造は設計とそろっており、残るのは実データの接続', verdictSource: 'analytics-v6/Zxezb.txt + analytics-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...ANALYTICS, node: 'J6Inc', name: '20-1-A 配信の反応', route: '/analytics?tab=reactions', verdict: 'structure_match_data_pending', verdictNote: '**development `c275749d` で撮った。** 社内テスト配信の開封・クリックが **`—`** で、帯に「20人未満は取得対象外」と**理由**が付く。**0ではなく取れないことが分かる**形。残るのは実データの接続', verdictSource: 'analytics-v6/J6Inc.txt + analytics-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...ANALYTICS, node: 'YBGtm', name: '20-1-B 経路と成果', route: '/analytics?tab=routes', verdict: 'structure_match_data_pending', verdictNote: '**development `c275749d` で撮った。** 広告費が `—` のとき**差し引きも `—`** になる。**片方が未取得なら計算結果も未取得**で、0円として引き算していない。残るのは実データの接続', verdictSource: 'analytics-v6/YBGtm.txt + analytics-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...ANALYTICS, node: 'QQ1SR', name: '20-1-C 使われ方', route: '/analytics?tab=usage', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮り、設計の記述と突き合わせた。** **前のP1（最終利用が生のUTC）は直っている**——`2026/08/24 14:00` と日本時間で出て、一度も使っていないリッチメニューは `—` のまま（**日付で埋めていない**）。**P1 設計の帯4つと「片づける」が無い。** 本文を数えて **「使っている機能」「作ったのに使っていない」「自動で動いた回数」「手作業が減った時間」「気づいたこと」「片づける」「中身を見る」がいずれも0件**。実装は数（作成／利用中／未使用／参照切れ／最終利用）を並べ、「未使用の項目は自動で削除しません。各機能の使用先を確認してから停止・削除します。」と添えるところまで。**数は出るが、そこから片づける道が無い。** 設計はこの画面を「作ったまま使っていないものを見つけて片づける」ためのものとしている。1440・1920とも横スクロール0', verdictSource: 'analytics-v6/QQ1SR.txt + analytics-v6/design-qa.md' , verdictHead: 'c275749d' },
  {
    ...ANALYTICS, node: 'URqOA', name: '20-1-D 定期レポートをつくる',
    gap: 'api',
    gapNote: '決まった曜日・時刻に走らせる仕掛けと、送り先の保存が要る',
    status: 'unimplemented',
    why: '決まった曜日・時刻にレポートを送る仕組みが無い（`grep 定期レポート` が `/analytics` 配下で0件。PR #445 head `5d5f7a5f` でも確かめた）',
  },
  { ...ANALYTICS, node: 'f5HsX', name: '20-2 クロス分析', route: '/analytics?tab=cross', verdict: 'structure_match_data_pending', verdictNote: '**development `c275749d` で撮った。** 集計前は帯4つとも `—` で、「たて・よこの軸を選び、『直近30日を集計』を押してください。」と次にすることを書く。**押す前に数字を見せていない。** 残るのは実データの接続', verdictSource: 'analytics-v6/f5HsX.txt + analytics-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...ANALYTICS, node: 'C2I7ry', name: '20-2-A ファネル分析', route: '/analytics?tab=funnel', verdict: 'structure_match_data_pending', verdictNote: '**development `c275749d` で撮った。** 1段目の通過率が `—`。**前の段が無いので割合が出せない**のを 0% と書いていない。残るのは実データの接続', verdictSource: 'analytics-v6/C2I7ry.txt + analytics-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...ANALYTICS, node: 'Fh2Qj', name: '20-2-B URLクリック', route: '/analytics?tab=url-clicks', verdict: 'structure_match_data_pending', verdictNote: '**development `c275749d` で撮った。** 同じ列に **`0%`（押されていない）** と **`—`（数えられない）** が並び、**見分けられる**。束4の手本にできる形。残るのは実データの接続', verdictSource: 'analytics-v6/Fh2Qj.txt + analytics-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...ANALYTICS, node: 'dfwD4', name: '20-2-C 保存した分析', route: '/analytics?tab=saved', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮った。前のP1（一覧に集計状態が無い）は直っている**——「集計状態」列があり、利用可能／一部集計／取得不可／`—` を言い分ける。P2 設計の保存した分析は、保存時の条件と最後に見た日をその場で開ける。実装は一覧まで。1440・1920とも横スクロール0', verdictSource: 'analytics-v6/dfwD4.txt + analytics-v6/design-qa.md' , verdictHead: 'c275749d' },

  // ── 機能21 NEN配信 ──────────────────────────────────────
  /* タブ4本は設計とそろっている（配信フロー／NENコラム／ペット／配信履歴）。 */
  { ...NEN, node: 'VLMGH', name: '21-1 NEN配信', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮り、設計の記述と突き合わせた。P0が4つとも直っている**（失敗の隣に失敗が1件／「発送完了から-3日後」／配信履歴の生UTC／読み込み失敗を0件と言う）。一覧は「誕生日の3日前 10:00」と正しく出る。**P1 編集画面の「何日後に送るか」が誕生日配信では効かない。** 誕生日の3日前は `delay_days` ではなく `birthdayDeliveryTarget`（`nen-engagement.ts:414`）が決めており、編集画面の欄は無関係。**効かない欄を出しているので、直したつもりで直らない。** 欄を隠すか「誕生日配信ではこの欄は使いません」と書くのが要る。P1-1（コラムの状態が英語）とP1-2（きっかけが `ec.order.delivered`）は **#525・#526 で直っているのを確認済み**。1440・1920とも横スクロール0', verdictSource: 'nen-v6/VLMGH.txt + nen-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...NEN, node: 'DEX0k', name: '21-1-A NENコラム', steps: [{ click: 'NENコラム' }], verdict: 'needs_fix', verdictNote: '**#525 `deff5ffb` で束3の完了条件を満たした。** 状態が `scheduled` `sent` `draft` のまま出ていたのが、数えて**すべて0件**になった。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の一覧の作り（回ごとの配信結果への導線）はこの直しの外', verdictSource: 'nen-v6/DEX0k.txt' , verdictHead: 'deff5ffb' },
  { ...NEN, node: 'q4lajm', name: '21-1-B ペット・記念日', steps: [{ click: 'ペット・誕生日' }], verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮った。** P2 ペット・記念日の作りが設計とそろわない。1440・1920とも横スクロール0', verdictSource: 'nen-v6/q4lajm.txt + nen-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...NEN, node: 'WeXbL', name: '21-1-C NEN配信の履歴', steps: [{ click: '配信履歴' }], verdict: 'structure_match_data_pending', verdictNote: '**development `c275749d` で撮った。** 配信履歴の日時は日本時間で出る（P0解決済み）。構造は設計とそろっており、残るのは実データの接続', verdictSource: 'nen-v6/WeXbL.txt + nen-v6/design-qa.md' , verdictHead: 'c275749d' },
  {
    ...NEN, node: 'HpKyF', name: '21-1-D NEN配信の中身を編集する',
    verdict: 'needs_fix', verdictNote: '**#526 `dfcc9a53` で束3の完了条件を満たした。** きっかけが `ec.order.delivered` `pet.birthday` のような内部の名前で出ていたのが、数えて**すべて0件**になった。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の編集の作り（配信条件の組み立て）はこの直しの外', verdictSource: 'nen-v6/HpKyF.txt',
    route: '/nen-campaigns/edit?key=review_request',
    verdictHead: 'dfcc9a53',
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
    verdict: 'structure_match_data_pending', verdictNote: '**development `c275749d` で撮った。** 読込・空・失敗が分かれ、**失敗のとき0件と言わない**（P0解決済み）。残るのは実データの接続', verdictSource: 'nen-v6/i9sQP.txt + nen-v6/design-qa.md',
    states: { apis: ['**/api/nen-campaigns/columns*', '**/api/nen-campaigns/overview*'], kinds: ['loading', 'empty', 'error'] },
    verdictHead: 'c275749d',
  },

  // ── 機能22 写真審査 ─────────────────────────────────────
  { ...PHOTO, node: 'Qu6Vk', name: '22-1 写真審査', verdict: 'needs_fix', verdictNote: 'P0 写真審査の一覧が設計とそろわない（元の判定を引き継いでいる。中身は photos-v6/design-qa.md を見る）', verdictSource: 'photos-v6/design-qa.md' , verdictHead: 'c275749d' },
  {
    ...PHOTO, node: 'hHrz8', name: '22-1-A 写真を1枚ずつ見る',
    gap: 'api',
    gapNote: '一覧写真を拡大するだけでは完成しない。非公開original、review/public派生画像、crop/rotateの版、risk flag、同意、審査競合、original download権限を持つasset・decision API/DBが要る',
    status: 'unimplemented',
    why: '現行 `/api/nen-members/photos` は公開URL相当と簡単な採否だけで、設計が求める派生画像、原本保護、crop/rotateを原本と分離する版、risk flag、同意、同時審査409を持たない。正式要件 §4〜§6・§9〜§10 が先',
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
    /* **ボタン名が「見送る」に変わった**（前は「理由を選んで見送る」）。 */
    steps: [{ click: '見送る', scope: 'main' }],
    verdictHead: 'c275749d',
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
  { ...EC, node: 'eI3gs', name: '23-1 EC連携', verdict: 'needs_fix', verdictNote: 'P1 結びつかなかった注文が、どこにも出てこない。ECの注文にはLINEの友だちが誰なのか書かれておらず、メールか電話で結びつけて、どちらも一致しなかった注文が「会員のつき合わせ」に並ぶ設計。実装にはそれを集めて見る場所が無い。設計は候補（電話番号が同じ／確からしさ とても高い）と「結びつけると増える売上 ¥312,400（この24件ぶん。分析にも入ります）」まで出す。**いま結びつかなかった注文は、買ってくれた事実がLINE側に何も残らないまま**で、購入後の配信も成果地点もマイルも動かない。P1 つなぎ先を画面から変えられない（page.tsx:174「接続先や突合キーを画面から変える口が無い」）', verdictSource: 'ec-v6/design-qa.md' , verdictHead: 'c275749d' },
  {
    ...EC, node: 'ELayY', name: '23-1-A 会員のつき合わせ',
    gap: 'api',
    gapNote: '`friendId` が空のeventを並べるだけでは足りない。検証済みemail/電話の候補、account/shop境界、linked/rejected/deferred判断、影響確認、過去eventの再処理範囲を持つidentity候補・判断API/DBが要る',
    status: 'unimplemented',
    why: '現行 `ec_events` は未照合eventを保持できるが、候補の根拠・確定/否定/保留・再提示抑止・影響確認を保存する口が無い。正式要件 §7・§8・§11 がidentity candidate/link decisionとaccount scopeを要求している',
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
  { ...LINE_NOTIFY, node: 'festr', name: '24-1 LINE通知', verdict: 'needs_fix', verdictNote: '**#504 `806ed169` で撮った。** 帯は 通知テンプレート 4件（顧客向けの重要通知）／通知ON 3件（現在送信する設定）／送信完了 2,412件（EC連携からの累計）／要確認 2件（送信に失敗した通知）で、**札ごとに何の数かを書く**。種類の絞り込みも すべて4・注文1・銀行振込1・発送1・キャンセル・返金1・定期便**0** と、数えて0のものを0で出す。「通知のON/OFFを切り替えても、ECから受け取った記録は消えません」と、切っても消えないことを断る。内部語・壊れ値は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計は種類ごとに直近の送信結果と失敗理由をその場で開く。実装は数と絞り込みまで', verdictSource: 'line-notify-v6/festr.txt' , verdictHead: '806ed169' },
  {
    ...LINE_NOTIFY, node: 'Q55bb', name: '24-1-A お知らせの中身を編集する',
    verdict: 'needs_fix', verdictNote: '**#504 `806ed169` で撮った。** 内部語・壊れ値は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の通知テンプレート編集は、差し込みの一覧と送信前の見え方を並べて確かめる。実装との差は送信処理がつながってから見る', verdictSource: 'line-notify-v6/Q55bb.txt',
    mode: 'viewport', height: 1136, steps: [{ click: '発送した', role: 'text' }],
    verdictHead: '806ed169',
  },
  {
    ...LINE_NOTIFY, node: 'X8JCA5', name: '24-1-B 送れなかったもの',
    route: '/line-notifications?tab=failures', mode: 'page',
    states: { apis: ['**/api/ec-commerce/notification-runs?**'], kinds: ['normal', 'loading', 'empty', 'error'] },
    verdict: 'needs_fix',
    verdictNote: '**#545 で「送れなかったもの」が入り、未実装ではなくなった。** 失敗理由が行ごとに出る（「相手がブロックしています」「LINEの受け取り上限を超えました」）。**未取得と0件が分かれている**：通常では LINE受付・試行・クリックが `—`（まだ記録していない）、空では帯が **0件**（数えて0）。再試行のボタンは**出していない**——型が `retryAvailable: false` で、画面にも「試行回数・自動再試行・個人の既読は、現在の記録からは取得できません。」と理由を書く。**出せないものを出さない**形で、`TimXl` と同じ。1440・1920とも横スクロール0。P2 設計は届かなかったものを「ブロック中の人／メールで届いた／まだ何もできていない」に分けるが、実装は状態ごとの分けまで。「その日のうちに別の手だてで届けてください」の案内も無い',
    verdictSource: 'line-notify-v6/X8JCA5-normal.txt',
    verdictHead: 'c9bb193d',
  },
  {
    /*
      **個人の既読を作らないことを見る。** 型（`EcNotificationRun`）に
      既読の欄はどこにも無く、あるのは `clickedAt`（短縮URLを押した時刻）だけ。
      固定データにも既読は入れていない。
    */
    ...LINE_NOTIFY, node: 'Se65i', name: '24-1-C お知らせの記録',
    route: '/line-notifications?tab=history', mode: 'page',
    states: { apis: ['**/api/ec-commerce/notification-runs?**'], kinds: ['normal', 'loading', 'empty', 'error'] },
    verdict: 'needs_fix',
    verdictNote: '**#545 で「記録」が入り、未実装ではなくなった。** 通常・空・失敗の3つが `data-list-state` でも分かれる。**個人の既読はどこにも作っていない**：列は「試行・クリック」で、行は「クリック —」。型（`EcNotificationRun`）にも既読の欄が無く、画面に「個人の既読は、現在の記録からは取得できません。」と書いてある。**所属を確定できない過去分も出さない**（`unassignedHistoricalRowsExcluded: true`、画面にも「選択中のLINEアカウントと結び付きを確認できたEC通知だけを表示します」）。空のとき帯は 0件（数えて0）。1440・1920とも横スクロール0。P2 設計の絞り込みチップ（すべて／押された／届かなかった）と「CSVで書き出す」が無い',
    verdictSource: 'line-notify-v6/Se65i-normal.txt',
    verdictHead: 'c9bb193d',
  },
  {
    ...LINE_NOTIFY, node: 'DpxOK', name: '24-2 運用者へのお知らせ',
    route: '/line-notifications?tab=operator', mode: 'page',
    states: { apis: ['**/api/notifications/rules?**', '**/api/notifications/rules'], kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'] },
    verdict: 'needs_fix',
    verdictNote: '**#564 `ad59fde6` で、記録していたP2が直った。5状態すべてを撮って確かめた。** 絞り込みチップが状態で言い分ける：通常「すべて 3／下書き 1／受け取る人がいない 3」、空「0／0／0」（数えて0）、失敗と権限不足は **「すべて —／下書き —／受け取る人がいない —」**。帯も同じで、失敗・権限不足は3枚とも `—件`。**読めていないものを0と断定しなくなった。** 通常・読込・空・失敗・権限不足の5つが `data-list-state` で名前で分かれ、1440・1920とも横スクロール0。P2 送信処理が接続されるまで「今日届いた数」は `—件` のまま（画面にも「送信処理を接続後に表示」と書いてあり、これは正しい断り方）',
    verdictSource: 'line-notify-v6/DpxOK-forbidden.txt + DpxOK-normal.txt',
    verdictHead: 'ad59fde6',
  },
  {
    ...LINE_NOTIFY, node: 'N2gAza', name: '24-2-A 運用者へのお知らせをつくる',
    route: '/line-notifications/operator/new', mode: 'page',
    verdict: 'needs_fix',
    verdictNote: '**#545 で作成画面が入り、未実装ではなくなった。** **下書きだけを保存する安全な段階になっている**：ボタンは「下書きに保存」だけで、公開・テスト送信は出さない。「下書きを保存しても通知は始まりません。」「未入力の下書きは公開できません。」「受け取る人が0人だと公開できません。」と、公開できない条件を先に書く。宛先の取り違えも「宛先はお店の人です。あとから顧客向けへは変えられません。」で止める。**本文に画面名の重複は無い**（パンくずのみ）。1440・1920とも横スクロール0。P2 設計との細かな差（受け取る人の選び方の面）は、送信処理が接続されてから見る',
    verdictSource: 'line-notify-v6/N2gAza.txt',
    verdictHead: 'c9bb193d',
  },

  // ── 機能25 オートメーション ─────────────────────────────
  /*
    設計のタブ帯は5本（動いているもの14／止めているもの4／動いた記録／
    見本12／共通アクション14）で、オートメーションと共通アクションが
    **同じ帯**に並ぶ。実装は `/automations` と `/common-actions` の別ページ。
  */
  { ...AUTOMATION, node: 'gief7', name: '25-1 オートメーション', route: '/automations', verdict: 'needs_fix', verdictNote: '**#552 `6ce43563` でタブ帯5本が設計どおりになった**（動いているもの／止めているもの／動いた記録／見本／共通アクション）。以前の「実装は `/automations` と `/common-actions` の別ページ」は解消し、**見本から作る導線も入った**（前のP1）。帯は **未取得を `—` で出す**：ルール4件・稼働中3は実値、今月の実行・失敗・手動実行は `—` と「実行の記録がありません」。**読めていない数を0と言わない。** 1440・1920とも横スクロール0。P1 設計の帯4つ（動いているもの14本／この30日に動いた8,420回／失敗した6回／**減らせた手作業およそ70時間**）のうち、実行回数・失敗・削減時間がまだ `—`。とくに「減らせた手作業」は、この機能を使い続ける理由を数で出すもので、集計の口が要る', verdictSource: 'automations-v6/gief7.txt', verdictHead: '6ce43563' },
  { ...AUTOMATION, node: 'Rv8Jv', name: '25-1-A オートメーションをつくる', route: '/automations/new', verdict: 'needs_fix', verdictNote: '**#552 `6ce43563` の時点で、つくる面は節番号つきの3段になっている**（1. どのルールか／2. 何が起きたら動かすか／3. 何をするか）。きっかけ5つ（メッセージを受け取ったとき・友だちになったとき・タグが付いたとき・フォームに答えたとき・リンクを踏んだとき）と、それぞれの補足（「空欄なら、どんなメッセージでも動きます。」）が出る。**見本から始める道は `gief7` のタブ帯側に入った**ので、前のP1「見本から始める道が無い」はこの画面の外で解けている。1440・1920とも横スクロール0。P2 設計の作る面との差（条件の組み合わせ、失敗したときの決めごと、下書きのまま置く段）はまだ', verdictSource: 'automations-v6/Rv8Jv.txt', verdictHead: '6ce43563' },
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
    /*
      **#552 でタブ帯へ「見本」が入った。** `?tab=templates` で開く。
      見本は実データのIDを持たないので、固定データにも `tag-0` のような
      id は入れない（選んだ人が自分の環境のものを選び直す）。
    */
    route: '/automations?tab=templates', mode: 'page',
    verdict: 'needs_fix',
    verdictNote: '**#552 `6ce43563` で見本が入り、未実装ではなくなった。** タブ帯の「見本」（`?tab=templates`）に3件並び、それぞれ 名前・説明・**きっかけ**・**すること**・「これで作る」。**この節を止めていた条件が満たされている**——画面の先頭に「見本を選ぶと、**公開されていない下書きを作ります**。タグやシナリオは、次の画面でこのアカウントのものを選び直してください。」と書いてあり、口も `POST /api/automation-templates/:key/drafts` で下書きを作る。以前は現行 `POST /api/automations` が `is_active DEFAULT 1` で**即時稼働**するため接続してはいけなかった。見本は実データのIDを持たず、タグ・シナリオは選び直す形も守られている。1440・1920とも横スクロール0。P2 設計は見本12件。実装は3件で、絞り込み（きっかけ別）も無い',
    verdictSource: 'automations-v6/WjYAC.txt',
    verdictHead: '6ce43563',
  },
  {
    ...AUTOMATION, node: 'Vdbv5', name: '25-1-D 一覧の状態（空・読込・エラー）',
    route: '/automations',
    states: { apis: ['**/api/automations*', '**/api/automations/**'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: '**#516 → #552 `6ce43563` で、失敗と空が分かれたまま保たれている。** 失敗は「オートメーションを表示できませんでした／**登録したルールは消えていません。**再読み込みしても直らない場合はエラー報告へ。」で、**帯も全部 `—`**（ルール —・稼働中 —・今月の実行 —・失敗 —）。空は「動いているオートメーションはありません。」で帯は **0件**。読込は `loading`。**束1と束4の完了条件を満たしている。** 1440・1920とも横スクロール0。P2 空だけ `data-list-state` が付かない（タブごとの文に替わったため）。読込・失敗には付いているので、撮影側から状態を確かめられるよう空にも付けてほしい',
    verdictSource: 'automations-v6/Vdbv5-error.txt', verdictHead: '6ce43563',
  },
  { ...AUTOMATION, node: 'xOpDs', name: '25-2 共通アクション', route: '/common-actions', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮り、設計の記述と突き合わせた。実装は設計にかなり近い。** 版（v4）と、どこから呼ばれているか、**古い版のまま呼んでいる先**まである（本文に「古い版」4件、「版」8件）。**設計との差1（別ページになっている）は #552 で解消**——タブ帯に「オートメーション / 共通アクション」が入り、件数（4）も付く。P2 残る差は帯の中身。設計は 共通アクション14／呼び出し元38・5機能から／今月2,847回・失敗6／**古い版のまま 要確認2** の4つ。実装は「共通アクション 4／公開中と下書き」まで。**「古い版のまま 要確認」が帯に無い**ので、直し忘れに気づく場所が一覧に無い。P2 「複製して作る」が無い。1440・1920とも横スクロール0', verdictSource: 'automations-v6/xOpDs.txt + automations-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...AUTOMATION, node: 'py5CG', name: '25-2-A 共通アクションをつくる', route: '/common-actions/new', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮った。実装は設計に近い。** P2 残る差は「複製して作る」の扱い。**タブ帯の位置の差は #552 で解消**。1440・1920とも横スクロール0', verdictSource: 'automations-v6/py5CG.txt + automations-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...AUTOMATION, node: 'syWp4', name: '25-2-B 共通アクションの版と使われている場所', route: '/common-actions/versions?id=ca-1', verdict: 'needs_fix', verdictNote: '**development `c275749d` で撮った。実装は設計に近く、版と使われている場所、古い版のまま呼んでいる先まで出せている。** P2 残る差は帯（`xOpDs` と同じ）。**タブ帯の位置の差は #552 で解消**。1440・1920とも横スクロール0', verdictSource: 'automations-v6/syWp4.txt + automations-v6/design-qa.md' , verdictHead: 'c275749d' },

  // ── 機能26 外部連携 ─────────────────────────────────────
  /*
    設計のタブは4本（こちらから送る6／こちらで受け取る3／やり取りの記録／見本14）。
    実装は2本（受信 (Incoming)／送信 (Outgoing)）で、記録も見本も無い。
  */
  {
    ...WEBHOOK, node: 'k3WxrO', name: '26-1 外部連携',
    verdict: 'needs_fix', verdictNote: '**#527 `c6fd4388` で束3の完了条件を満たした。** タブが「受信 (Incoming)」「送信 (Outgoing)」から **「こちらで受け取る」「こちらから送る」** になり、`Incoming` `Outgoing` は0件。見出しも「受信Webhook作成」→「受け取る設定を追加」、空の文も「こちらで受け取る設定はまだありません。」に変わった。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の一覧の作り（Webhookごとの直近の成否、再送の導線）はこの直しの外', verdictSource: 'webhooks-v6/k3WxrO.txt',
    /* **#527 でタブ名が変わった**（「送信 (Outgoing)」→「こちらから送る」）。 */
    steps: [{ click: 'こちらから送る' }],
    verdictHead: 'c6fd4388',
  },
  { ...WEBHOOK, node: 'M0Gb7', name: '26-1-A こちらで受け取る', verdict: 'needs_fix', verdictNote: 'P1 こちらで受け取る面が設計とそろわない。見本から作る道が無い', verdictSource: 'webhooks-v6/design-qa.md' , verdictHead: 'c275749d' },
  {
    /*
      **#547 で「やり取りの記録」タブが入った。**
      読む元は `GET /api/webhooks/interactions`。固定データは
      `INTEGRATION_RECORDS`（この30日1,972回・成功1,966・失敗6・平均0.4秒）。
      **設計の応答時間は `duration_ms` から出る実値で、作り物ではない。**
    */
    ...WEBHOOK, node: 'KNG00', name: '26-1-B やり取りの記録',
    route: '/webhooks?tab=interactions', mode: 'page',
    states: { apis: ['**/api/webhooks/interactions?**', '**/api/webhooks/interactions'], kinds: ['normal', 'loading', 'empty', 'error'] },
    verdict: 'needs_fix',
    verdictNote: '**#547 でやり取りの記録が入り、未実装ではなくなった。** 読む台帳が無いと書いていたが、Codexが作った。帯4つ（この30日1,972回〈送った1,486・受け取った486〉／成功1,966回99.7%／失敗6回〈やり直す〉／**返事までの時間0.4秒**）と「失敗したものをまとめてやり直す」まで設計どおり。**応答時間は duration_ms からの実値で、作り物ではない**（Pencilから外さなかった判断はこれで正しかった）。**本文と接続情報を一覧に出さない**：「安全のため本文と接続情報は一覧に表示しません」と画面に書いてある。処理中の行はかかった時間が—。P2 帯に「失敗6回・すべてSlack・8/24に集中」の内訳と「いちばん遅くて10.0秒」が出ない（表には10秒の行がある）',
    verdictSource: 'webhooks-v6/KNG00-normal-1920.png',
    verdictHead: '48715569',
  },
  {
    ...WEBHOOK, node: 'f8SBSh', name: '26-1-C 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/webhooks/**'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: '**#515 → #527 `c6fd4388` で束1と束3の完了条件を満たした。** 失敗のとき「受信Webhookを表示できませんでした／**登録内容は消えていません。**」となり、**作成の誘いを同時に出さない**（束1、#515）。タブの英語も消えた（束3、#527）。読込・空・失敗が `data-list-state` で分かれる。この画面は件数の帯を持たないので束4は当てはまらない。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の一覧の作り（直近の成否と再送）はこの直しの外',
    verdictSource: 'webhooks-v6/f8SBSh-error.txt', verdictHead: 'c6fd4388',
  },

  // ── 機能27 予約管理 ─────────────────────────────────────
  /*
    設計は台帳（時間×担当の格子）と、電話の代理予約が4枚。
    実装は一覧＋詳細で、**「予約を追加」は押せない**
    （「管理画面から予約を代理で入れる仕組みは準備中です」`bookings/page.tsx:289`）。
  */
  { ...BOOKING, node: 'TV2DI', name: '27-1 予約管理', verdict: 'needs_fix', verdictNote: 'P1 台帳が時間（縦）× 担当（横）の格子になっていない。設計は9:00の行に佐々木・山本・中川の3列があり、どこが空いているかが面で分かる。P1 電話で受けた予約がこの台帳に載らない（「予約を追加」は在るが押せない。bookings/page.tsx:289「管理画面から予約を代理で入れる仕組みは準備中です」）。設計の帯は「今日の予約12件・LINEから9・電話3」で**4件に1件は電話**。載らないので、今日の件数が本当の数にならず、電話とLINEの予約がぶつかっても気づけず、前日・当日のお知らせも送れない', verdictSource: 'booking-v6/design-qa.md' , verdictHead: 'c275749d' },
  {
    ...BOOKING, node: 'TnDbq', name: '27-1-A 予約の詳細',
    verdict: 'needs_fix', verdictNote: 'P1 予約の詳細の面が設計とそろわない。代理で入れた予約をLINEの予約と同じ扱いにする道（前日・当日のお知らせ、成果地点「予約が入った」を数える）が無い', verdictSource: 'booking-v6/design-qa.md',
    mode: 'viewport', height: 1136, steps: [{ click: '高橋 直人', role: 'text' }],
    verdictHead: 'c275749d',
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
  { ...BOOKING, node: 'SbuUI', name: '27-1-C 今週の予約', steps: [{ click: '今週' }], verdict: 'needs_fix', verdictNote: 'P1 今週の予約の面が設計とそろわない。時間×担当の格子でないため、空きが面で分からない', verdictSource: 'booking-v6/design-qa.md' , verdictHead: 'c275749d' },
  /*
    代理予約の入力を、実際に通す。

    **友だち → メニュー → 担当者 → 日付 → 時間**の順でしか進めない。
    担当者はメニューを選ぶまで押せず、時間は日付を入れてから空き確認が
    返って初めて出る。`fill` で流し込めるのは日付だけで、あとの3つは
    `<select>` なので `select` で選ぶ。

    **`14:00` は返す側で埋まっている枠。** 空き確認では出るが、登録の
    ときには埋まっている。実物の Worker（`booking.ts:1114`）と同じく、
    登録の直前にもう一度空きを見て弾く形にしてある。
  */
  {
    ...BOOKING, node: 'GFDqW', name: '27-1-D 代理予約・内容確認',
    route: '/booking/bookings/new', mode: 'page',
    steps: [
      { fill: 'input[placeholder="名前を2文字以上入力"]', selector: true, text: '菅野', after: 900 },
      { click: '菅野 亮', after: 500 },
      { select: '予約メニュー', label: 'トリミング（小型犬）' },
      { select: '担当者', label: '佐々木' },
      { fill: '日付', text: '2026-09-03', after: 900 },
      { select: '空いている時間', label: '10:00〜11:45' },
      { click: '予約内容を確認する', after: 700 },
    ],
    verdict: 'needs_fix',
    verdictNote: '**#459 で入力→確認の段ができた。実際に操作して撮った**（友だち→メニュー→担当→日付→時間→「予約内容を確認する」）。確認の面は**送った値をそのまま出す**：菅野 亮／2026年9月3日(木) 10:00／トリミング（小型犬）／佐々木／¥8,400。料金は担当者ごとの `price` から引くので、指名で変わる分も正しい。送るものも「予約確認LINE 登録後に送信」「リマインダ 予約設定から計算」と、**まだ決まっていないことを決まったように書かない**。1440・1920とも横スクロール0、下の固定帯は本文に重ならない。P2 **重なりの事前警告が無い**。設計は確認の段で「9/02(火) 11:00 は 佐々木 がふさがっています（2件）／このまま入れると、同じ人が同じ時間に2件受けることになります。」と止める。実装は登録を試すまで気づけない（同じ欠けは `Lg8ff` を見る）。P2 「お客様に届く内容」がLINEの吹き出しの形になっていない',
    verdictSource: 'booking-v6/GFDqW-1440.png',
    verdictHead: 'ba0bf62d',
  },
  {
    ...BOOKING, node: 'GfceK', name: '27-1-E 代理予約・登録完了',
    route: '/booking/bookings/new', mode: 'page',
    steps: [
      { fill: 'input[placeholder="名前を2文字以上入力"]', selector: true, text: '菅野', after: 900 },
      { click: '菅野 亮', after: 500 },
      { select: '予約メニュー', label: 'トリミング（小型犬）' },
      { select: '担当者', label: '佐々木' },
      { fill: '日付', text: '2026-09-03', after: 900 },
      { select: '空いている時間', label: '10:00〜11:45' },
      { click: '予約内容を確認する', after: 700 },
      { click: 'この内容で予約を入れる', after: 1200 },
    ],
    verdict: 'needs_fix',
    verdictNote: '**#459 で登録完了までつながった。実際に登録して撮った。** 予約IDは**返事の `booking_id` をそのまま出す**（固定値ではない）。Googleカレンダーも `calendar_sync` の4つの値を読み分ける。1440・1920とも横スクロール0。P1 **設計が完了画面で見せたかった2つが出ない**。ひとつはリマインダの具体時刻「9/01(月) 19:00 に前日のお知らせ ／ 9/02(火) 8:00 に当日のお知らせ」、もうひとつは「成果地点「予約が入った」を1件 数えました。**電話の予約も同じように数えます。**」。代理で入れた予約がLINEの予約と同じ扱いになる、という設計の要点がここで確かめられない。**ただし断り方は正しい**——実装は `—（完了APIへの接続が必要）` と書き、**取得元のない時刻を作らない**',
    verdictSource: 'booking-v6/GfceK-1440.png',
    verdictHead: 'ba0bf62d',
  },
  {
    ...BOOKING, node: 'Lg8ff', name: '27-1-F 代理予約・予約枠の重なりと入力エラー',
    route: '/booking/bookings/new', mode: 'page',
    steps: [
      { fill: 'input[placeholder="名前を2文字以上入力"]', selector: true, text: '菅野', after: 900 },
      { click: '菅野 亮', after: 500 },
      { select: '予約メニュー', label: 'トリミング（小型犬）' },
      { select: '担当者', label: '佐々木' },
      { fill: '日付', text: '2026-09-03', after: 900 },
      { select: '空いている時間', label: '14:00〜15:45' },
      { click: '予約内容を確認する', after: 700 },
      { click: 'この内容で予約を入れる', after: 1200 },
    ],
    /*
      **重なったあと、選び直して最後まで進めるかを見る。**
      画面が出るだけでは足りない。`recoverConflict()` は入力へ戻して
      時刻だけ消し、空きを読み直す。お客様・メニュー・担当・日付は
      残っているはずなので、時刻を選び直すだけで登録まで行けるか確かめる。
    */
    variants: [{
      suffix: '-recovered',
      steps: [
        { fill: 'input[placeholder="名前を2文字以上入力"]', selector: true, text: '菅野', after: 900 },
        { click: '菅野 亮', after: 500 },
        { select: '予約メニュー', label: 'トリミング（小型犬）' },
        { select: '担当者', label: '佐々木' },
        { fill: '日付', text: '2026-09-03', after: 900 },
        { select: '空いている時間', label: '14:00〜15:45' },
        { click: '予約内容を確認する', after: 700 },
        { click: 'この内容で予約を入れる', after: 1200 },
        { click: '空いている時間を選び直す', after: 1500 },
        { select: '空いている時間', label: '10:00〜11:45' },
        { click: '予約内容を確認する', after: 700 },
        { click: 'この内容で予約を入れる', after: 1500 },
      ],
    }],
    verdict: 'needs_fix',
    verdictNote: '**#562 `45789965` で、記録していたP1が直った。実際に重なりを起こし、選び直して登録まで通した。** ①**`API error: 409` は出ない**——赤帯は「選んだ時間は、ほかの予約で埋まりました」。②**回復画面へ進む**——「この時間には予約を入れられません／最新の空き時間を読み直して、別の時間を選んでください。入力したお客様・メニュー・担当者・要望は残っています。」と「空いている時間を選び直す」。③**選び直したあと登録を完了できる**——押して10:00を選び直すと「予約を登録しました」まで進み、予約IDが出る。直し方も良い：文字で見分けるのをやめ、`ApiError.code` を足して**機械コードと人へ見せる文を別の契約に分けた**。`extractApiErrorCode` は `^[a-z][a-z0-9_]{0,63}$` に絞るので、SQLや外部APIの文言はコードとしても入らない。1440・1920とも横スクロール0。`API error` / `Failed to fetch` / `undefined` / `NaN` はどこにも無い。P2 設計は重なりを**登録前に**止める（「9/02(火) 11:00 は 佐々木 がふさがっています（2件）」）。実装は登録を試して初めて分かる',
    verdictSource: 'booking-v6/Lg8ff-1440.png + booking-v6/Lg8ff-recovered.txt',
    verdictHead: '45789965',
  },

  // ── 機能28 予約設定 ─────────────────────────────────────
  /*
    設計のタブは4本（メニュー8／受付枠／休業日／予約のルール）。
    実装はメニューと担当スタッフの2タブで、受付枠と休業日は
    `/booking/staff/shifts` の別ルートにある。
  */
  { ...BOOKING_SET, node: 'QSLEH', name: '28-1 予約設定', verdict: 'needs_fix', verdictNote: 'P1 タブの分けかたが違う。設計は「メニュー8／受付枠／休業日／予約のルール」を1つの帯に並べるが、実装はメニューと担当スタッフの2タブで、**受付枠と休業日は /booking/staff/shifts の別ルート**。予約管理の画面からは飛べるが、予約設定の画面のタブには出てこない。「予約のルール」（先の予約が取れる範囲・締め切り・キャンセル期限）は BookingMenu が持っている（booking_window_days / cutoff_hours_before / cancel_deadline_hours_before）のに、**メニューごとに散っていてまとめて見る場所が無い**。P2 帯が設計と違う（設計は 出しているメニュー6つ／いちばん選ばれた トリミング小型犬142件／受け付けている時間9:00〜19:00／先の予約が取れる範囲60日先まで）。枠の稼働率が—なのは、受付時間の総枠数を数える仕組みが無いためで、正直な出し方', verdictSource: 'booking-settings-v6/design-qa.md' , verdictHead: 'c275749d' },
  { ...BOOKING_SET, node: 'tksPc', name: '28-1-A 受付枠と休業日', route: '/booking/staff/shifts', verdict: 'needs_fix', verdictNote: '**#517 `43d3d20e` で撮った。** 「スタッフごとの受付時間を決めます。**Googleカレンダーをつなぐと、そちらの予定が入っている時間は自動で受付を止めます。**」と、外の予定との関係を先に書く。「特別休業日を設定」「変更を保存」があり、編集する人を選ぶまでは何も出さない。内部語・壊れ値は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の受付時間は曜日×時間の格子で、休業日と重ねて見せる。実装は人ごとの一覧まで', verdictSource: 'booking-settings-v6/tksPc.txt' , verdictHead: '43d3d20e' },
  { ...BOOKING_SET, node: 'GhOb3', name: '28-1-B 予約メニューをつくる', route: '/booking/menus/new', verdict: 'needs_fix', verdictNote: 'P1 予約メニューをつくる面が設計とそろわない。予約のルールをメニューの中だけで決める形になっている', verdictSource: 'booking-settings-v6/design-qa.md' , verdictHead: 'c275749d' },
  {
    ...BOOKING_SET, node: 'W6465r', name: '28-1-C 一覧の状態（空・読込・エラー）',
    /* `**' + '/api/booking/admin/menus*` は `/menus/:id/staff` に届かない（`*` は `/` をまたがない）。この画面は呼ばないが、呼ぶようになったとき静かに素通りするのを防ぐ。 */
    states: { apis: ['**/api/booking/admin/menus*', '**/api/booking/admin/menus/**', '**/api/booking/admin/staff*'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: '**#532 `6cc74968` で、束1と束4の完了条件を満たした（コード上の修正を画像で確認済み）。** 失敗のとき帯は **メニュー `—件`／担当スタッフ `—人`／今月の予約 `—件`／枠の稼働率 `—%`** で、札ごとに「取得できませんでした」。空と失敗が `data-list-state` で分かれ、失敗のとき作成の誘いを出さない。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P1 設計のタブは4本（メニュー／受付枠／休業日／予約のルール）だが、実装はメニューと担当スタッフの2タブで、受付枠と休業日は `/booking/staff/shifts` の別ルートにある',
    verdictSource: 'booking-settings-v6/W6465r-error.txt', verdictHead: '6cc74968',
  },

  // ── 機能29 イベント予約 ─────────────────────────────────
  { ...EVENT, node: 'ugP5y', name: '29-1 イベント予約', verdict: 'needs_fix', verdictNote: '**#467 `6bb950f3` で撮り直した。** 内部語・壊れ値は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P1 帯が「数」で「次に何をするか」になっていない。設計の3つめ「あと少しで満席 2回（声をかけると埋まります）」と4つめ「申し込みが少ない 1回（8/31の回。あと3日です）」は、そのまま行動になる帯。実装の「定員の充足 55%」は全体の平均で、**どの回が危ないかは分からない**', verdictSource: 'events-v6/ugP5y.txt' , verdictHead: '6bb950f3' },
  { ...EVENT, node: 'MKrPY', name: '29-1-A イベントをつくる', route: '/events/new', verdict: 'needs_fix', verdictNote: '**#467 `6bb950f3` で撮った。** 内部語・壊れ値は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計のイベント作成は回ごとの枠（日時・定員・受付終了）をその場で並べて作る。実装との差は枠の口がつながってから見る', verdictSource: 'events-v6/MKrPY.txt' , verdictHead: '6bb950f3' },
  { ...EVENT, node: 'i5SN2j', name: '29-1-B 申込者の一覧', route: '/events/bookings?id=ev-1', verdict: 'needs_fix', verdictNote: '**#467 `6bb950f3` で予約者の一覧が撮れるようになった。** 帯は 申込 0人（定員12・残り12）／承認待ち 0件（対応が必要）／**キャンセル待ち 2人**／キャンセル 0件。状態の札は 承認待ち・確定・拒否・キャンセル・期限切れ・参加済・無断・キャンセル待ち・全件 で、**内部の語（`confirmed` `requested` `waiting` `invited`）は0件**。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計は「あと少しで満席」「声をかけると埋まります」のように、次にする行動を帯へ出す。実装は数まで。**撮影の断り**：キャンセル待ちの固定データを2人入れているため、帯が「2人／受け付けない設定です」と並ぶ。イベント側の受付設定と別の値なので、実装の食い違いではない', verdictSource: 'events-v6/i5SN2j.txt' , verdictHead: '6bb950f3' },
  {
    ...EVENT, node: 'k5m5Bc', name: '29-1-C 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/events/admin/events*', '**/api/events/admin/events/**'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: '**#518 → #533 `d1070487` で、束1と束4の完了条件を満たした。** 失敗のとき帯は **イベント `—`／申込 `—`／定員の充足 `—`／承認待ち `—`** で、札ごとに「取得できませんでした」。本文も「表示できませんでした」に分かれ、空の作成誘導を出さない。読込・空・失敗が分かれる。1440・1920とも横スクロール0。**#533 は #518 を含む**ので、この head で両方を見たことになる。**画面全体は要修正のまま**：P1 帯が「数」で「次に何をするか」になっていない（設計の「あと少しで満席 2回（声をかけると埋まります）」は、そのまま行動になる帯）',
    verdictSource: 'events-v6/k5m5Bc-error.txt', verdictHead: 'd1070487',
  },

  // ── 機能30 ログインユーザー ─────────────────────────────
  /*
    設計のタブは4本（いまいる人8／招待中2／入った記録／権限のかたまり5）。
    実装は1枚もの。
  */
  { ...STAFF, node: 'e3jz3', name: '30-1 ログインユーザー', verdict: 'needs_fix', verdictNote: '**#475 `15febf7f` で撮った。** 内部語・壊れ値は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の役割の編集は、権限を項目ごとに見せて差分を確かめてから保存する。実装との差は権限の口がつながってから見る', verdictSource: 'staff-v6/e3jz3.txt' , verdictHead: '15febf7f' },
  {
    ...STAFF, node: 'EOTS4', name: '30-1-A 見せる範囲を決める',
    verdict: 'needs_fix', verdictNote: '**#475 `15febf7f` で撮った。** 帯は 管理スタッフ 5人（管理者2・その他3）／二要素認証 **2 / 5**（未設定3人）／過去30日のログイン 2回（失敗1）／最終ログイン 09:02 佐々木 亮太。上に **「🔑 二段階認証が未設定のユーザーが 3人 います」** と、**数ではなく次にすることを出す帯**がある。表は ユーザー・役割・担当範囲・LINE連携・二段階認証・利用状態・操作。内部語・壊れ値は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の一覧は最後の操作と、権限の変更履歴への導線を持つ', verdictSource: 'staff-v6/EOTS4.txt',
    mode: 'viewport', height: 1080, steps: [{ click: '高田 誠', role: 'text' }],
    verdictHead: '15febf7f',
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
  { ...STAFF, node: 'I3ZSrU', name: '30-1-C 人を招待する', route: '/staff/new', verdict: 'needs_fix', verdictNote: '**#475 `15febf7f` で撮った。** 内部語・壊れ値は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の追加画面は、招待の送り方（LINE連携・メール）と担当範囲の割り当てを1枚で決める。実装との細かな差は、招待の口がつながってから見る', verdictSource: 'staff-v6/I3ZSrU.txt' , verdictHead: '15febf7f' },

  // ── 機能31 機能設定 ─────────────────────────────────────
  { ...FEATURE_SET, node: 'c4R6F', name: '31-1 機能設定', verdict: 'needs_fix', verdictNote: '**#478 `66883866` で撮った。** **オフにしたときに何が起きないかを先に書く**——「オフにしても作ったデータは削除されません。**公開中のページや動いている配信・予約は、それぞれの画面で止めてからオフにしてください。**」。機能設定・並び替え・初期値に戻すが揃う。内部語・壊れ値は0件、1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計は機能ごとに「いま使っている数」を並べて、切ってよいかを判断させる。実装は一覧と並び替えまで', verdictSource: 'settings-v6/c4R6F.txt' , verdictHead: '66883866' },

  // ── 機能32 運用状態 ─────────────────────────────────────
  /* タブ3本は設計とそろっている（健全性チェック／緊急コントロール／更新履歴）。 */
  { ...OPERATIONS, node: 'UgonK', name: '32-1 運用状態・健全性チェック', route: '/emergency?tab=health', verdict: 'needs_fix', verdictNote: 'P1 健全性の6項目（LINE接続・月間配信数ほか）を、項目ごとに「確認する内容／結果／いまの数字／目安／最後の確認／中身を見る」で常に並べる形になっていない。「5分ごとに自動確認」「次は11:50に自動で確かめます」も無い', verdictSource: 'operations-v6/design-qa.md' , verdictHead: 'c275749d' },
  {
    /* 通常・読込・失敗を見る。**下見が取れないと停止を押せないはず**。 */
    ...OPERATIONS, node: 'b3HfZ', name: '32-1-A 緊急コントロール', route: '/emergency?tab=control',
    states: { apis: ['**/api/operations/control/preview*'], kinds: ['normal', 'loading', 'error'] },
    verdict: 'needs_fix', verdictNote: '**#482 `b346d467` で、止める前に影響件数が出るようになった**（前の判定「押すまで何を止めることになるのか分からない」は解消）。通常は 予約中・送信中の一斉配信 **1件**／シナリオ配信 **4件**／リマインダ **10件**／自動処理 **3件**。**未取得を0にしない**——下見が失敗すると4つとも **`—`** になり、帯も「停止状態を確認できません／取得できない状態では停止・復旧を実行できません。」。**失敗のとき停止ボタンは押せない**（`disabled=true`。実際に押せないことを確かめた）。**対象アカウントで数が変わる**——「すべて」1/4/10/3 →「画面確認アカウント」1/2/6/1 で、`GET /api/operations/control/preview?account_id=…` を読み直す。1440・1920とも横スクロール0、内部語なし。**P1 人数が出ない。** 設計は「予約中の一斉配信 1件（8/28 20:00 ／ **対象8,486人**）」「シナリオ配信 4本 ／ **486人が進行中**」「リマインダ 10本 ／ **明日の予約12件ぶん**」と、件数と人数を並べる。Workerが数えているのは行数だけで（`operations.ts:283` の `countActive`）、人数を数える口が無い。**急いで押す画面なので、何人に影響するかが要る。** P1 **自動応答を止められない**。画面で選べるのは4つ（一斉配信・シナリオ・リマインダ・自動処理）だが、Workerの停止できる種類は7つあり（`packages/db/src/operations.ts:1`）、`auto_reply_dispatch` `webhook_outgoing` `ad_postback` は画面から選べない。**自動応答は「自動処理」に含まれない**（別の種類として `auto-reply.ts:305` で判定する）。緊急停止を押しても自動応答は返信を続けるのに、画面はそれを言わない', verdictSource: 'operations-v6/b3HfZ-normal.txt + b3HfZ-error.txt',
    verdictHead: 'b346d467',
  },
  { ...OPERATIONS, node: 'UhC2O', name: '32-1-B 更新履歴', route: '/emergency?tab=history', verdict: 'needs_fix', verdictNote: 'P1 緊急操作の履歴が localStorage（この端末に保存された履歴）で、画面にもそう書いてある。設計は「だれが いつ 何を止めたかが残ります」「消せません」と決めている。**端末を変えると読めず、消せてしまう**。P2 帯が設計と違う（設計は 止めた回数3回／いちばん長かった停止70分／管理画面の更新28回／いまの版 2026.08.25-1）。表の列（いつ・だれが・止めたもの・対象・理由・戻した）もそろわない', verdictSource: 'operations-v6/design-qa.md' , verdictHead: 'c275749d' },
  {
    ...OPERATIONS, node: 'U0BwS', name: '32-1-C 緊急停止の最終確認',
    verdict: 'needs_fix', verdictNote: '**#482 `b346d467` で、最終確認に実測値が再表示されるようになった**（前の判定「止める対象の件数が窓にも出ない」は件数について解消）。窓は「すべてのアカウント／**予約中・送信中の一斉配信（1件）・シナリオ配信（4件）・リマインダ（10件）**／理由：障害対応／停止前にすでにLINEへ渡したものは取り消せません。」で、**選んだ対象だけ**が出る（自動処理は既定で外れているので出ない）。数は下見と同じ値で、窓のためにもう一度数え直さない。押し間違い避けも二重で、「確認のため『停止』と入力」に加えて**認証アプリの6桁コード**（「この操作専用の本人確認として、5分以内に1回だけ使います。」）が要る。**未取得は `未取得` と書く**（`counts[key] == null ? \'未取得\' : …`。0件にしない）。1440・1920とも横スクロール0、内部語なし。**P1 人数が出ない**（`b3HfZ` と同じ。窓にも件数だけ）。P2 選べる4つのうち何を止めるかは出るが、**止めないもの**（自動応答など）が続くことは書かれていない', verdictSource: 'operations-v6/U0BwS.txt',
    route: '/emergency?tab=control', mode: 'viewport', height: 1136,
    /*
      **停止するものを1つ選んでから押す。** 何も選ばずに押すと
      「停止する配信を1つ以上選んでください」で窓が開かない
      （`emergency/page.tsx:361`）。
    */
    steps: [{ click: '配信を緊急停止', after: 900 }],
    verdictHead: 'b346d467',
  },

  // ── 機能4 友だち属性（PR #402 で比較した残り10枚を台帳へ統合） ──
  /*
    タグ・情報欄・対応マーク・保存した検索は `/tags` の4タブ。
    CSV取り込みの4枚は、ファイルを選ばせる必要があるので
    `capture.spec.mjs` が撮っている（`tags-csv-*`）。
  */
  { node: 'hqrOv', feature: 4, name: '4-1 友だち属性・タグ', dir: 'friend-attributes-v6', route: '/tags', mode: 'page',
    verdict: 'needs_fix', verdictNote: '**P2 文言だけ。** ルート `/tags`。**この画面の4タブのうち、帯4つを持つのはここだけ**（撮った本文で 101件／186人／26件／101件／20件 と実値が出る）。`rIhbN` `HBTk0` `QKx8Q` には帯が無く、**同じ画面なのに作りが揃っていない**。取得元：`friend-attributes-v6/hqrOv.txt`。1440・1920とも横スクロール0',
    verdictSource: 'friend-attributes-v6/hqrOv.txt', verdictHead: 'c275749d',
  },
  {
    node: 'dKlkz', feature: 4, name: '4-1-F タグ削除の確認ダイアログ',
    dir: 'friend-attributes-v6', route: '/tags', mode: 'viewport', height: 1080,
    steps: [{ click: '削除', scope: 'main' }],
    verdict: 'structure_match_data_pending', verdictNote: '**構造は設計とそろっている。** ルート `/tags`（タグ削除の確認）。残るのは実データの接続——**消す前に「何人に付いているか」を出す口**が要る（`zGZMA` と同じ根、束11）。取得元：`friend-attributes-v6/dKlkz.txt`。1440・1920とも横スクロール0',
    verdictSource: 'friend-attributes-v6/dKlkz.txt', verdictHead: 'c275749d',
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
    verdict: 'needs_fix', verdictNote: '**P1 CSV取り込みの確認が設計と別の仕掛け。** ルート `/tags?tab=fields`（取り込み）。設計は取り込む前に**何行が新規で何行が更新か、はじかれた行とその理由**を見せてから進む。実装は別の作りで、行ごとの内訳を出さない。取得元：`friend-attributes-v6/sfTEW.txt`。1440・1920とも横スクロール0',
    verdictSource: 'friend-attributes-v6/sfTEW.txt', verdictHead: 'c275749d',
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
    verdict: 'needs_fix', verdictNote: '**P1 設計の列が2つのうち1つしか無い。** ルート `/tags?tab=fields`。実装の列は **友だち情報欄名／種別／既定値／入力済み／表示**。設計は 順番／項目名／種類／使用中／**回答フォーム**／**表示先**／操作 で、**「回答フォーム」は本文にあるが「表示先」が0件**。設計は「愛犬のお名前 テキスト 187人 **回答フォーム3個** **友だち詳細・テンプレート差し込み**」と、**どこに出るか**まで見せる。**P1 帯4つが無い**（設計は 項目数12件（使用中9件）／登録済み友だち187人／フォーム連携6件／今月の更新3件）。**P1 「入力済み」が未取得なのに `0人` と出る**（束4。`?withUsage=1` を付けて読む必要がある）。取得元：`friend-attributes-v6/HBTk0.txt`。1440・1920とも横スクロール0',
    verdictSource: 'friend-attributes-v6/HBTk0.txt', verdictHead: 'c275749d',
  },
  {
    node: 'yKEdO', feature: 4, name: '4-2-C 一覧の状態（空・読込・エラー）',
    dir: 'friend-attributes-v6', route: '/tags?tab=fields', mode: 'page',
    states: { apis: ['**/api/friend-fields*', '**/api/list-stats*'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'needs_fix', verdictNote: '**P0（失敗を空として出す）は #420 `87c150ad` で解決済み。P1 が残る。** ルート `/tags?tab=fields`。失敗のときに空状態と「項目を追加」の誘いを同時に出していたのが直った。**残るP1は帯の数**（`HBTk0` と同じ。未取得を `0人` と出す）。取得元：`friend-attributes-v6/yKEdO-error.txt`。1440・1920とも横スクロール0',
    verdictSource: 'friend-attributes-v6/yKEdO.txt', verdictHead: 'c275749d',
  },
  { node: 'rIhbN', feature: 4, name: '4-3 対応マーク', dir: 'friend-attributes-v6', route: '/tags?tab=marks', mode: 'page',
    verdict: 'needs_fix', verdictNote: '**P1 人数が「人」だけで数字が出ない。** ルート `/tags?tab=marks`。撮った本文の「いまの人数」列は **未対応・対応中・保留・対応済・気にかける の5行とも「人」だけ**で、数字が入っていない（`[0-9]+人` を数えて0件）。原因は `mark-list.tsx:176` が `{mark.friendCount}人` を出すのに、**`SupportMark` の型に `friendCount` が無い**こと。どの口も返さないので常に空になる。設計は 未対応23人／対応中19人／対応済186人／保留3人 を出す。**推奨修正**：数を返す口ができるまでは **`—人`** と出す（空にしない）。空欄は「0人」とも「取れていない」とも読めない。**P1 帯4つが無い**（設計は マークの種類4件（使用中4件）／未対応23人（全体の10.0%）／対応中19人／過去7日の変更74回）。同じ画面の4タブのうち**タグ（`hqrOv`）だけが帯を持ち**、作りが揃っていない。取得元：`friend-attributes-v6/rIhbN.txt`。1440・1920とも横スクロール0',
    verdictSource: 'friend-attributes-v6/rIhbN.txt', verdictHead: 'c275749d',
  },
  { node: 'QKx8Q', feature: 4, name: '4-4 保存した検索', dir: 'friend-attributes-v6', route: '/tags?tab=searches', mode: 'page', verdict: 'needs_fix', verdictNote: '**#539 → #541 `e929f22a` で束3の完了条件を満たした。** 保存した検索の一覧に内部の識別子（`ss-`）や `support_mark` `scenario_id` といった列名が出なくなった（数えて0件）。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の一覧の作り（条件の要約、使用先の表示）はこの直しの外', verdictSource: 'tags-v6/QKx8Q.txt' , verdictHead: 'e929f22a' },

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
    verdict: 'needs_fix', verdictNote: '**P2 設計との差は並びと文言。** ルート `/tags`。取得元：`friend-attributes-v6/tP0RW.txt`。1440・1920とも横スクロール0。**具体的な差は、設計画像が用意できてから詰める**（この機能は `design-qa-remaining10.md` に画像が無く、文章の記述だけで見ている）',
    verdictSource: 'friend-attributes-v6/tP0RW.txt', verdictHead: 'c275749d',
  },
  {
    node: 'LfrQs', feature: 4, name: '4-1-C 連動アクション追加ドロワー',
    dir: 'friend-attributes-v6', route: '/tags/new', mode: 'viewport', height: 1320,
    steps: [{ click: 'タグ連動', role: 'switch' }, { click: '＋ アクションを追加' }],
    verdict: 'needs_fix', verdictNote: '**P2 設計との差は並びと文言。** ルート `/tags`。取得元：`friend-attributes-v6/LfrQs.txt`。1440・1920とも横スクロール0。具体的な差は設計画像が用意できてから詰める',
    verdictSource: 'friend-attributes-v6/LfrQs.txt', verdictHead: 'c275749d',
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
    verdict: 'needs_fix', verdictNote: '**P2 設計との差は並びと文言。** ルート `/tags`。取得元：`friend-attributes-v6/VjXGX.txt`。1440・1920とも横スクロール0。具体的な差は設計画像が用意できてから詰める',
    verdictSource: 'friend-attributes-v6/VjXGX.txt', verdictHead: 'c275749d',
  },
  {
    node: 'byqIW', feature: 4, name: '4-1-G 属性フォルダを追加・色編集',
    dir: 'friend-attributes-v6', route: '/tags/folders/new', mode: 'page',
    verdict: 'needs_fix', verdictNote: '**P2 設計との差は並びと文言。** ルート `/tags`。取得元：`friend-attributes-v6/byqIW.txt`。1440・1920とも横スクロール0。具体的な差は設計画像が用意できてから詰める',
    verdictSource: 'friend-attributes-v6/byqIW.txt', verdictHead: 'c275749d',
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
    verdict: 'needs_fix', verdictNote: '**P2 設計との差は並びと文言。** ルート `/tags`。取得元：`friend-attributes-v6/KoT6c.txt`。1440・1920とも横スクロール0。具体的な差は設計画像が用意できてから詰める', verdictSource: 'friend-attributes-v6/KoT6c.txt', verdictHead: 'c275749d',
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
    verdict: 'needs_fix', verdictNote: '**P1 対応マークを消すとき、何人に付いているかも移り先も言わない。** ルート `/tags?tab=marks`。撮った本文の行は「マーク名／新規の初期値／いまの人数／自動で変わるとき」と「削除」で、**人数が空**（`rIhbN` と同じ根）。消す前に**何人から外れるのか**が分からない。設計は消す前に人数と移り先を出す。**新しい口が要る**（束11）ので、段1（`ConfirmDialog` 化）だけ先にはできない——**人数を出せないまま窓だけ作ると、空欄の窓になる**。取得元：`friend-attributes-v6/zGZMA.txt`。1440・1920とも横スクロール0',
    verdictSource: 'friend-attributes-v6/zGZMA.txt', verdictHead: 'c275749d',
  },
  {
    /* **#421（head `71aff344`）で `/tags/searches/edit` が入った。** */
    node: 'XBkiQ', feature: 4, name: '4-4-A 保存した検索の条件確認・編集',
    verdict: 'needs_fix', verdictNote: '**#539 → #541 `e929f22a` で束3の完了条件を満たした。** 条件の編集で、対応マークとシナリオが**IDの手入力ではなく選ぶ形**になり、項目名もキーのまま出なくなった（`ss-` `support_mark` `scenario_id` はいずれも0件）。**#541 は #539 を含む**ので、この head で両方を見たことになる。1440・1920とも横スクロール0。**画面全体は要修正のまま**：P2 設計の条件の組み立て（入れ子の and/or）はこの直しの外', verdictSource: 'tags-v6/XBkiQ.txt',
    dir: 'friend-attributes-v6', route: '/tags/searches/edit?id=ss-1', mode: 'page',
    verdictHead: 'e929f22a',
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
  10: [
    { pr: 508, head: '61eeb3c7', on: '2026-08-29', screens: ['TimXl', 'GB0NR'], note: '公開完了と公開ページの導線。**#508 は #507 を含む**' },
    { pr: 546, head: 'de0848b9', on: '2026-08-29', screens: ['Ho8z4'], note: '通知とリマインド。既存の申込と5分ごとの仕掛けを使う' },
  ],
  11: [
    { pr: 433, head: '51020a97', on: '2026-08-28', screens: ['M9cij'] },
    { pr: 493, head: '62ddaebe', on: '2026-08-28', screens: ['CzndJ', 'M9cij'], note: '#493 は #433 を含む' },
  ],
  6: [
    { pr: 543, head: '819895dd', on: '2026-08-29', screens: ['h0kahp'], note: 'テスト送信と本番予約で同じ下書きを使う直し。押すたびに配信が増える件は解決' },
    { pr: 497, head: '84e5bab9', on: '2026-08-28', screens: ['FpgxH'], note: 'Claudeが作ったDraft。#495 の上に積んである' },
    {
      pr: 503, head: '6db5ad7f', on: '2026-08-28',
      screens: ['q76C35', 'zZ9fA', 'XQfMD', 'p97Tf', 'Bw0zt', 'vW4Es', 'u6gHt', 'EGMb1', 'xkRDb', 'TmHjF'],
      note: '固定データ（配信の帯・1件の配信）を足して撮り直した。**`FpgxH` は #497 の絵に戻した。** 機能ごと撮り直すと、別のPRで直った1枚が直る前に戻る',
    },
  ],
  12: [{ pr: 509, head: 'e148615c', on: '2026-08-29', screens: ['DIUbO', 'NXdDk'], note: '切替のつながり。既存の pages / areas から解析する。固定データに切替ボタンを足した' }],
  14: [
    { pr: 548, head: 'd4a85ad4', on: '2026-08-29', screens: ['uNBlA', 'gBtaK'], note: '保存前に影響を見る面。値を変えてから保存を押さないと出ない' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['WuKzU', 'gBtaK'], note: 'development そのもので撮った' },
  ],
  26: [
    { pr: 547, head: '48715569', on: '2026-08-29', screens: ['KNG00'], note: 'やり取りの記録。送受信・安全な再送・通常/読込/空/失敗' },
    { pr: 515, head: '09054b78', on: '2026-08-29', screens: ['f8SBSh'], note: '外部連携の失敗を空と分ける。束1' },
    { pr: 527, head: 'c6fd4388', on: '2026-08-29', screens: ['k3WxrO', 'f8SBSh'], note: 'タブの英語を外す（束3）。**#527 は #515 を含む**' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['M0Gb7'], note: 'development そのもので撮った' },
  ],
  15: [
    { pr: 559, head: '7922c002', on: '2026-08-29', screens: ['g89Tc'], note: '未取得を一括削除で選べないようにした。**#559 は #438 を含む**' },
    { pr: 560, head: '7c1acd0f', on: '2026-08-29', screens: ['g89Tc'], note: '寸法・並び順・表示件数。**#560 は #559 を取り込んでいる**（`7922c002` が親）ので、一括削除の止め方もこの head で見ている' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['eXAJP'], note: 'development そのもので撮った' },
  ],
  16: [
    { pr: 558, head: 'ef7b5773', on: '2026-08-29', screens: ['PouPn', 'xqT1Z', 'jwrbf'], note: '案件ごとの決まった額を紹介者一覧へ反映。率が0のときだけ確定した定額へ切り替える' },
    { pr: 563, head: '64798425', on: '2026-08-29', screens: ['jwrbf'], note: '帯から `ref_tracking` を外した。**`ref_code` は列見出しに残っている**' },
  ],
  6: [
    { pr: 531, head: '1a943082', on: '2026-08-29', screens: ['u6gHt'], note: '内部語を外し、開封の母数を明記。束3と束6' },
    { pr: 561, head: '51827fe1', on: '2026-08-29', screens: ['bPF0s'], note: '予約完了の5段とSTEP帯、右390pxの取り消し導線、確認窓、409の文。取り消しの口だけモックで405に落とさず、Workerと同じく状態を見て分ける' },
    { pr: 557, head: '697cee2c', on: '2026-08-29', screens: ['q76C35'], note: '帯の未取得を `—` に。返事を差し替えて失敗・一部欠け・実値0の3つを見た' },
    { pr: 554, head: '875a9ed3', on: '2026-08-29', screens: ['EGMb1'], note: '配信の削除を画面内の確認窓へ' },
    { pr: 550, head: 'f7c5a99e', on: '2026-08-29', screens: ['cPk8A', 'sqFXf'], note: '対象条件の保存と呼び出し。**固定データの形は `SegmentCondition`**（`{operator, rules}`）。別名で書いて画面を落とした' },
  ],
  27: [
    { pr: 459, head: 'ba0bf62d', on: '2026-08-29', screens: ['GFDqW', 'GfceK', 'Lg8ff'], note: '代理予約の入力→確認→完了→競合を実際に操作して撮った。競合だけ回復画面に届かない' },
    { pr: 562, head: '45789965', on: '2026-08-29', screens: ['Lg8ff'], note: '重なりから選び直して登録まで通した。`ApiError.code` を足して、機械コードと人へ見せる文を別の契約に分けている' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['TV2DI', 'TnDbq', 'SbuUI'], note: 'development そのもので撮った' },
  ],
  24: [
    { pr: 504, head: '806ed169', on: '2026-08-30', screens: ['festr', 'Q55bb'], note: '顧客通知の一覧とテンプレート。**`DpxOK` はここでは撮らない**——#504 に運用者タブは無く、撮ると #564 の絵を巻き戻す（実際に一度やって git から戻した）' },
    { pr: 545, head: 'c9bb193d', on: '2026-08-30', screens: ['X8JCA5', 'Se65i', 'DpxOK', 'N2gAza'], note: '顧客通知の記録と失敗、運用者通知の一覧と作成。**#545 は #504 を含む**。個人の既読は作っていない。**head が `03022681` → `c9bb193d` へ動いたが撮り直していない**——`notification-run-list.tsx`・`operator/new/page.tsx`・`operator-notification-rules.tsx` の blob がいずれも同一（差分は development の取り込み）' },
    { pr: 564, head: 'ad59fde6', on: '2026-08-29', screens: ['DpxOK'], note: '絞り込みチップを状態で言い分ける。失敗・権限不足は `—`' },
  ],
  17: [
    { pr: 549, head: '0ae3e094', on: '2026-08-29', screens: ['qlVLJ', 'p9CcEB'], note: 'マイルの使い道を交換まで接続。公開版の固定・二重交換の防止・渡せなかったときの決めごとが入っている' },
    { pr: 441, head: '05c5b103', on: '2026-08-28', screens: ['MvZm5', 'BmoGY', 'HIU5O'] },
    { pr: 441, head: 'e953109c', on: '2026-08-28', screens: ['s98Vfw', 'N46cQ', 'k8VCU'] },
    { pr: 494, head: '0ca45f98', on: '2026-08-28', screens: ['HIU5O'], note: '#494 は #441 を含む。**新head `5470ede3` でも撮り直していない**——apps/web の20ファイルすべて blob が同一で、差分は Worker の機能設定だけ' },
    { pr: 495, head: '55301679', on: '2026-08-30', screens: ['z3PB2', 'vz0Ji'], note: '**`codex/development` 直結へ張り替えられたが撮り直していない**——`mileage/page.tsx` と `action-score-tab.tsx` の blob が `7d890d3b` と同一。**`pRHvc` は `screens.mjs` に無いNode**なので判断待ちで飛ばした' },
    { pr: 496, head: '4dac7986', on: '2026-08-28', screens: ['s6MBc'], note: '#496 は #495 を含む' },
    { pr: 499, head: '642b8222', on: '2026-08-30', screens: ['s6MBc'], note: 'Claudeが作ったDraft。#496 の上に積んである。**head は動いたが撮り直していない**——`apps/web` の差分0件' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['s98Vfw', 'N46cQ', 'BmoGY', 'k8VCU'], note: 'development そのもので撮った' },
    { pr: 582, head: '78e2f065', on: '2026-08-30', screens: ['vz0Ji'], note: '手で調整したときの失敗を日本語に。405を実際に起こして確かめた' },
  ],
  7: [
    { pr: 429, head: '0f612926', on: '2026-08-29', screens: ['uJP22'], note: '**撮り直していない。** 旧head `838116b4` から `reminders/new` の blob が不変（差分は Worker の機能設定だけ）。#429 の受入条件5項目だけをコードで確認した。画面全体は要修正のまま' },
    { pr: 551, head: '44692a37', on: '2026-08-29', screens: ['s7T2dz', 'JCz6J', 'W98zZQ', 's6Vvp', 'PSmHo'], note: '公開までの5段。`?stage=` で1枚ずつ開く。届く予定・公開前チェック・公開の3つの口だけモックで405に落とさず、**公開の人数は公開前チェックと同じ数から作る**' },

    { pr: 514, head: '9a72dba6', on: '2026-08-29', screens: ['Y0Sn3', 'M1EXwB'], note: '削除確認と、未送信だけ取り消して送信済みを残す直し。**#514 は #498 を含む**。**#498 単体（`ac288d48`）では撮り直さない**——`reminders/page.tsx` の blob は違うが、それは #514 が #498 の上でさらに直したため。撮った木のほうが新しく（`ac288d48` は `9a72dba6` の祖先）、#498 で撮り直すと #514 の直りを絵から巻き戻すことになる' },
    { pr: 500, head: '409f00bb', on: '2026-08-28', screens: ['GC4St'] },
    { pr: 511, head: '4bc71249', on: '2026-08-29', screens: ['GC4St'], note: '実行結果から内部IDを外す。束3' },
    { pr: 498, head: 'f30890f2', on: '2026-08-30', screens: ['Y0Sn3'], note: '`codex/development` 直結へ張り替え。削除確認の窓は入っているが、失敗の文が `API error: 405` のまま' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['M1EXwB'], note: 'development そのもので撮った' }],
  11: [{ pr: 572, head: 'e4ab641f', on: '2026-08-29', screens: ['NNDMR'], note: '質問のひな形。下書き/公開の送信内容、シナリオの選択肢、回答先の往復、配信の契約テストまで確認。撮影は既存の2枚を維持' }],
  8: [

    { pr: 544, head: '6053c271', on: '2026-08-29', screens: ['Gy9OK', 'cmDfJ', 'K7vg2', 'nzWIX', 'ivDoe'], note: '削除確認の窓。**#544 は #491 を含む**' },
    { pr: 501, head: '93edbe17', on: '2026-08-28', screens: ['t7UtYQ'], note: '#501 は #500 を含む' },
    { pr: 566, head: 'd0680774', on: '2026-08-29', screens: ['q8wSqO', 'cmDfJ'], note: '内部の言葉9つを画面の言葉へ。失敗のとき帯を `—` にし、前の数を残さない。**#540 では直らない**（一覧の言葉はこちら）' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['K7vg2'], note: '判定を具体化するため撮った' }],
  5: [
    { pr: 534, head: '0158ba8e', on: '2026-08-29', screens: ['bV5Vs'], note: '到達率の `NaN%` を消す。束4' },
    { pr: 519, head: 'a8e00234', on: '2026-08-29', screens: ['q5G45'], note: 'シナリオの失敗を未登録と分ける。束1と束4' },
    { pr: 553, head: '2fdded68', on: '2026-08-29', screens: ['dqFft'], note: '通の削除を画面内の確認窓へ。シナリオごと削除はまだ標準の confirm' },
    { pr: 521, head: '7d5d74fd', on: '2026-08-29', screens: ['RUxNf'], note: '開始・停止の確認窓。窓は一覧の行に出る' },
    { pr: 522, head: '3c88b8bd', on: '2026-08-29', screens: ['NrBkW'], note: '開始完了の知らせ。`?started=1` で開ける。#521 の上に積んである' },
    { pr: 503, head: '6db5ad7f', on: '2026-08-28', screens: ['M2b2B'], note: '新しい口は足さず既存の統計を読む' },
    {
      pr: 503, head: '6db5ad7f', on: '2026-08-28', screens: ['xfYLn', 'hz9ti'],
      note: '撮り方が別の画面に当たっていたので直して撮り直した。固定データの `reachRate` を直したので `NaN%` も消えた',
    },
    { pr: 530, head: '2568c474', on: '2026-08-29', screens: ['xfYLn'], note: '通の編集から `cron` を外す。束3' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['kk8dz', 'r6Gzsu', 'hz9ti', 'EvVO5'], note: '判定を具体化するため撮った。development そのもの' },
    { pr: 569, head: '92f03199', on: '2026-08-30', screens: ['cCB7r'], note: '配信方式の選択。段の表示と、作り直しになる断りが入っている' },
    { pr: 427, head: '5f09837c', on: '2026-08-30', screens: ['TC1b1', 'bV5Vs', 'g2UNV'], note: '`codex/development` 直結へ張り替え。**#529 の母数の直りは入っていない**（#427 単体では 41% だけ）' },
    { pr: 529, head: 'a3511980', on: '2026-08-30', screens: ['TC1b1'], note: '読了済の母数を明記。束6。**development 直結へ張り替わり head も動いたが撮り直していない**——`scenarios/page.tsx` の blob が同一' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['M1EXwB'], note: 'development そのもので撮った' },
  ],
  2: [
    { pr: 513, head: '60b39036', on: '2026-08-29', screens: ['tBlkL', 'AuSDY', 'LHjwD'], note: '保存の成否を窓へ返す直し。**P0は解決**' },
    { pr: 555, head: 'e873eeb9', on: '2026-08-29', screens: ['ANgda', 'tBlkL', 'AuSDY', 'LHjwD'], note: '保存した検索の窓。未入力は赤帯＋押せない保存ボタン。同じ部品を使う4枚を撮り直した' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['xGLVe'], note: 'development そのもので撮った' },
  ],
  13: [
    { pr: 436, head: '35c613a6', on: '2026-08-29', screens: ['EMBIK', 'v9tYhl'], note: '#436 の最新head。**`ZOPyc` は撮り直していない**——旧head `950073ab` から `apps/web` の差分0件で、判定は #556 `6037aeef` のまま。受入条件5項目の確認と、画面全体の一致判定は分けて記録した' },
    { pr: 436, head: '950073ab', on: '2026-08-29', screens: ['ZOPyc'], note: '読込・空・失敗を分ける直し。**P0は解決**。帯の2枚が0件のまま残る' },
    { pr: 556, head: '1c1546cb', on: '2026-08-30', screens: ['ZOPyc'], note: '回答フォームの帯を未取得と0件で分ける。失敗のときは作成の誘いを出さない。**`codex/development` 直結へ張り替えられたが撮り直していない**——`page.tsx` と `form-kpi-value.tsx` の blob が `6037aeef` と同一' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['vCqUj', 'cSqvP'], note: 'development そのもので撮った' },
  ],
  25: [
    { pr: 502, head: '75b010fc', on: '2026-08-28', screens: ['DkPY0'], note: '#502 は #500 を含む。新しい表は作らず既存の automation_runs を読む' },
    { pr: 552, head: '6ce43563', on: '2026-08-29', screens: ['gief7', 'Rv8Jv', 'WjYAC', 'Vdbv5'], note: 'タブ帯5本と見本から下書きを作る道。**`DkPY0` は撮り直していない**（#502 `75b010fc` のまま）' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['xOpDs', 'py5CG', 'syWp4'], note: 'development そのもので撮った' },
  ],
  32: [
    { pr: 482, head: 'b346d467', on: '2026-08-29', screens: ['b3HfZ', 'U0BwS'], note: '緊急停止の下見と最終確認。**撮る前に `pnpm dev` で起こす**（`predev` が `@/generated/release-log.json` を作る。`npx next dev` 直叩きだと500で真っ白になる）' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['UgonK', 'UhC2O'], note: 'development そのもので撮った' },
  ],
  3: [
    { pr: 520, head: '4848a8f3', on: '2026-08-29', screens: ['bzDn6'], note: '友だち一覧の帯を未取得 `—人` に。**development 直結の根元PR**' },
    { pr: 565, head: 'ea2e730d', on: '2026-08-29', screens: ['r7eSi'], note: '統合ユーザーの7列。内部の統合キーを外し、未取得と0件を分ける。空の返事の形も直した（`rows` の無い返事だと画面ごと落ちる）' }],
  28: [
    { pr: 517, head: '43d3d20e', on: '2026-08-30', screens: ['tksPc'], note: '受付時間。Googleカレンダーとの関係を先に書く' },
    { pr: 532, head: '6cc74968', on: '2026-08-29', screens: ['W6465r'], note: '予約設定の帯を未取得 `—` に。束1と束4' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['QSLEH', 'GhOb3'], note: 'development そのもので撮った' },
  ],
  29: [
    { pr: 533, head: 'd1070487', on: '2026-08-29', screens: ['k5m5Bc'], note: 'イベント予約の帯を未取得 `—` に。**#533 は #518 を含む**' },
    { pr: 467, head: '6bb950f3', on: '2026-08-30', screens: ['MKrPY', 'i5SN2j', 'ugP5y'], note: 'イベント予約の作成・予約者・一覧。キャンセル待ちの口を撮影モックへ足した（無いと `waitlist.length` で落ちる）' },
  ],
  10: [{ pr: 524, head: 'a6c35ee0', on: '2026-08-29', screens: ['zCQXe'], note: 'ウェビナーの帯を未取得 `—` に。束4' }],
  11: [{ pr: 528, head: '1b95452d', on: '2026-08-29', screens: ['NKyoA'], note: 'タブとフォルダの件数を未取得 `—` に。束4' }],
  12: [{ pr: 523, head: '47e7846e', on: '2026-08-29', screens: ['RW5Tb'], note: '内部の言葉の直し（束3）。**束4は半分**——タップ側は `—` だが、メニュー・公開中・出し分けは失敗時も0を数える' }],
  4: [{ pr: 541, head: 'e929f22a', on: '2026-08-29', screens: ['QKx8Q', 'XBkiQ'], note: '保存した検索から内部IDを外し、選ぶ形へ。**#541 は #539 を含む**。束3' }],
  30: [{ pr: 475, head: '15febf7f', on: '2026-08-30', screens: ['EOTS4', 'I3ZSrU', 'e3jz3', 'jwVlo'], note: 'ログインユーザーの一覧・追加・役割。development 直結' }],
  31: [{ pr: 478, head: '66883866', on: '2026-08-30', screens: ['c4R6F'], note: '機能設定。オフにしても消えないことを先に書く' }],
  /*
    **`codex/development` そのもので撮った回。** 8/29 に根元PRが9本
    入り、多くの画面がここで初めて「どのheadで見たか」を持てた。
    **`--only` を付け忘れて機能まるごと撮り、`DIUbO` `NXdDk`（#509）と
    `RW5Tb`（#523）を巻き戻した。git から戻した。**
  */
  1: [{ pr: 419, head: 'c84baa63', on: '2026-08-30', screens: ['vUXKb', 'ZN0ov', 'JN6mQ', 'NjK9q', 'Alekb'], note: 'ダッシュボード。お知らせの口を撮影モックへ足した（`counts` の4つが欠けると `undefined.all` で落ちる）' }],
  12: [{ pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['GO8RQ', 'XtfO3', 'kQ1bs', 'UMiJ9', 'TL7tp'], note: '同上。**`DIUbO` `NXdDk`（#509）と `RW5Tb`（#523）は別PRの絵なので戻した**' }],
  10: [{ pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['ZC13r', 'lvaY5', 'PV1Vh', 'd3rFGD', 'Xjk8q', 'Q8sHa', 'yxyzQ'], note: 'development そのもので撮った' }],
  11: [{ pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['W7LBc', 'GFlD7', 'FRkls', 'j9ixI', 'hsBtl', 'J3GxEZ'], note: '同上。質問のひな形に `createdAt`/`updatedAt` を足すまで `Invalid Date` で撮れなかった' }],
  16: [{ pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['PouPn', 'GH8VL', 'n5VVTb', 'xqT1Z', 'GPWzq'], note: '同上' }],
  23: [{ pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['eI3gs'], note: '同上' }],
  4: [{ pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['hqrOv', 'dKlkz', 'sfTEW', 'HBTk0', 'yKEdO', 'rIhbN', 'tP0RW', 'LfrQs', 'VjXGX', 'byqIW', 'KoT6c', 'zGZMA'], note: '判定を具体化するため撮り直した（本文が無かった）。development そのもの' }],
  3: [{ pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['PhxG6', 'Igi72', 'I6UAdr', 'YzxU1'], note: '判定を具体化するため撮った' }],
  9: [
    { pr: 431, head: '2ab18c88', on: '2026-08-30', screens: ['uLQQc', 'txMO9', 'U3SI5'], note: '友だち追加時の配信。はじめての人と以前からの友だちを分ける説明が入っている' },
    { pr: 506, head: '5dc99107', on: '2026-08-29', screens: ['P2J0Te'], note: '友だち追加時配信の実行結果。既存の `/api/friend-add-routing/events` を読む' },
  ],
  18: [
    { pr: 443, head: 'f372ff30', on: '2026-08-28' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['Q4bkTg', 'IhSBB', 'v0HaI', 'TEVk8', 'JupxW', 'BMmxU', 'BuVDB', 'Im2b1'], note: 'development そのもので撮った（根元9本のマージ後）' },
  ],
  19: [
    { pr: 444, head: 'ccbd0975', on: '2026-08-28' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['ZrpKn', 'GUxsj', 'GtylA'], note: 'development そのもので撮った' },
  ],
  20: [
    { pr: 445, head: '787a4b46', on: '2026-08-28', note: '**#445 は 2026-08-29 に `codex/development` へマージ済み**（merge commit `6a00834f`）' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['Zxezb', 'J6Inc', 'YBGtm', 'QQ1SR', 'f5HsX', 'C2I7ry', 'Fh2Qj', 'dfwD4'], note: 'development そのもので撮った（根元9本のマージ後）' },
  ],
  21: [
    { pr: 446, head: '4307088d', on: '2026-08-28' },
    { pr: 525, head: 'deff5ffb', on: '2026-08-29', screens: ['DEX0k'], note: '状態の内部語を日本語へ。束3' },
    { pr: 526, head: 'dfcc9a53', on: '2026-08-29', screens: ['HpKyF'], note: 'きっかけの内部名を日本語へ。束3' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['VLMGH', 'q4lajm', 'WeXbL', 'i9sQP'], note: 'development そのもので撮った' },
  ],
  22: [
    { pr: 447, head: '65adbc59', on: '2026-08-28' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['Qu6Vk', 'N2J629'], note: 'development そのもので撮った。「理由を選んで見送る」→「見送る」に名前が変わっていた' },
  ],
}
