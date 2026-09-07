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

/** 友だち追加時の配信。一覧と5段編集を別ルートで持つ。 */
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

/** 流入と計測。`/inflow-links?tab=` の4タブ（流入経路／サイトスクリプト／広告連携／広告とのつなぎ）。 */
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
const BOOKING = { feature: 27, dir: 'booking-v6', route: '/booking/bookings', mode: 'page', clock: '2026-09-03T00:00:00.000Z' }

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
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
    verdict: "match",
    verdictNote: "**2026-09-07 再撮影で一致。** #270 のダッシュボード指標APIを接続し、有効友だち398人、今月の送信枠（残り197 / 上限200通）、7日分の友だち推移を設計値で表示した。3102/8789で1440/1920pxを撮影し、両幅とも横はみ出し0。表示中の本文差0を確認した（閉じた追加URL選択肢の運用データ名だけ実装側にある）。",
    verdictSource: "dashboard-v6/vUXKb.txt + vUXKb-{1440,1920}.png + 2026-09-07 visual/text comparison",
    verdictHead: "d9cfe531d",
  },
  {
    node: 'ZN0ov', feature: 1, name: '1-1-1 ダッシュボード編集',
    verdict: 'match', verdictNote: '**2026-09-04 再照合で一致。** テキスト差0。パネル幅540px、見出しの副文、札型タブ、カードの配置説明、4枠警告、5枚目ON時の自動OFF、「ダッシュボードに反映」まで設計に合わせた。2026-09-03の1440/1920px画像と最新コード差分で確認。現在コミットの画像はPlaywrightのOS権限で取得できず、旧画像と差分照合で判定。', verdictSource: 'dashboard-v6/ZN0ov.txt + 2026-09-03 1440/1920px screenshots + 2026-09-04 static diff audit',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
    steps: [{ click: 'ダッシュボード編集' }],
    verdictHead: '145c497d1',
  },
  {
    node: 'JN6mQ', feature: 1, name: '1-1-2 友だち追加QR',
    dir: 'dashboard-v6', route: '/', mode: 'viewport', height: 1668, clock: DASHBOARD_CLOCK,
    steps: [{ click: 'QRを表示' }],
    verdict: "match",
    verdictNote: "**2026-09-07 再撮影で一致。** #270 の公式プロフィールURLを接続して `https://lin.ee/nen-official` を表示し、表示用QRは追加URLから生成するため撮影モックでも壊れない。ダイアログ820px、QR枠280px、サイズ選択、PNG/JPG/SVG、コピー・ダウンロード・印刷、ヒント枠を確認。3102/8789の1440/1920pxで横はみ出し0。表示中の本文差0（閉じた選択肢の運用データ名と中・小サイズだけ実装側にある）。",
    verdictSource: "dashboard-v6/JN6mQ.txt + JN6mQ-{1440,1920}.png + 2026-09-07 visual/text comparison",
    verdictHead: "d9cfe531d",
  },
  {
    node: 'NjK9q', feature: 1, name: '1-1-3 対応受信の表示件数を開く',
    verdict: 'match', verdictNote: '**2026-09-04 再照合で一致。** 表示件数の選択口、1〜5 / 5件、前へ・1・次へのページ送りを確認。テキスト差0、2026-09-03の1440/1920px画像で横スクロール0。現在コミットの画像はPlaywrightのOS権限で取得できず、旧画像と差分照合で判定。', verdictSource: 'dashboard-v6/NjK9q.txt + 2026-09-03 1440/1920px screenshots + 2026-09-04 static diff audit',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
    steps: [{ click: '表示件数' }],
    verdictHead: '145c497d1',
  },
  {
    node: 'Alekb', feature: 1, name: '1-1-4 通知パネルを開く',
    verdict: 'match', verdictNote: '**2026-09-04 再照合で一致。** 通知API接続後のパネル構造・文言を確認し、テキスト差0。2026-09-03の1440/1920px画像で横スクロール0。現在コミットの画像はPlaywrightのOS権限で取得できず、旧画像と差分照合で判定。', verdictSource: 'dashboard-v6/Alekb.txt + 2026-09-03 1440/1920px screenshots + 2026-09-04 static diff audit',
    dir: 'dashboard-v6', route: '/', mode: 'page', clock: DASHBOARD_CLOCK,
    steps: [{ click: '通知' }],
    verdictHead: '145c497d1',
  },

  // ── 機能2 受信箱 ────────────────────────────────────────
  { ...INBOX, node: 'xGLVe', name: '2-1 受信箱', steps: OPEN_CHAT,
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #293で修正・再判定し、一致。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを同じ比較画像で目視確認した。 一覧・トーク・顧客情報の3カラム、上部指標、対応ルール、会話選択、右欄の基本情報・タグ・次の対応・予約EC・マイルを確認した。名前・件数・時刻は運用データで変わるが、配置・項目・操作は一致する。",
    verdictSource: "inbox-v6/xGLVe.txt + 2026-09-07 same-input visual comparison",
    verdictHead: "4f8dfd8e0",
  },
  {
    ...INBOX, node: 'NfgOs', name: '2-2 テンプレート選択',
    steps: [...OPEN_CHAT, { click: '▧ テンプレートを選択' }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #293で修正・再判定し、一致。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを同じ比較画像で目視確認した。 テンプレート選択窓の検索、フォルダ、分類、一覧、プレビュー、入力欄へ挿入する操作を確認した。テンプレート名と本文は運用データで変わる。",
    verdictSource: "inbox-v6/NfgOs.txt + 2026-09-07 same-input visual comparison",
    verdictHead: "4f8dfd8e0",
  },
  {
    ...INBOX, node: 'H3lAOB', name: '2-3 顧客情報パネル非表示',
    steps: [...OPEN_CHAT, { click: '顧客情報を閉じる' }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #293で修正・再判定し、一致。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを同じ比較画像で目視確認した。 顧客情報を閉じた2カラム構成で、会話欄が右端まで広がり、再表示操作を残すことを確認した。",
    verdictSource: "inbox-v6/H3lAOB.txt + 2026-09-07 same-input visual comparison",
    verdictHead: "4f8dfd8e0",
  },
  {
    ...INBOX, node: 'Xi4x9', name: '2-4 右パネル表示設定',
    steps: [...OPEN_CHAT, { click: '表示項目' }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #293で修正・再判定し、一致。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを同じ比較画像で目視確認した。 表示項目を設計どおり7単位に整理し、ドラッグ順変更、表示切替、初期状態に戻す、完了を実装した。ポップアップは親欄で切れず、設計と同じ右欄上に全体が見える。",
    verdictSource: "inbox-v6/Xi4x9.txt + 2026-09-07 same-input visual comparison",
    verdictHead: "4f8dfd8e0",
  },
  /*
    設計 `f0zn6` は会話を開いた形。右を未選択のまま撮ると、
    担当者別未読の画面を同じ状態で比較できない。
  */
  { ...INBOX, node: 'f0zn6', name: '2-5 新着・担当者別未読', steps: [...OPEN_CHAT],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #293で修正・再判定し、一致。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを同じ比較画像で目視確認した。 新着指標、担当者別未読、一覧の担当表示、自分の未読2件の札と絞り込み動作を確認した。",
    verdictSource: "inbox-v6/f0zn6.txt + 2026-09-07 same-input visual comparison",
    verdictHead: "4f8dfd8e0",
  },
  {
    ...INBOX, node: 'NWbuF', name: '2-6 テンプレート・全フォルダ展開',
    steps: [...OPEN_CHAT, { click: '▧ テンプレートを選択' }, { click: 'フォルダ' }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #293で修正・再判定し、一致。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを同じ比較画像で目視確認した。 テンプレート窓で全フォルダを展開し、未分類・お問い合わせ・予約・ECの件数と選択状態、検索、一覧、プレビューを確認した。",
    verdictSource: "inbox-v6/NWbuF.txt + 2026-09-07 same-input visual comparison",
    verdictHead: "4f8dfd8e0",
  },
  {
    ...INBOX, node: 'B7CER8', name: '2-7 内部メモ入力',
    steps: [...OPEN_CHAT, { click: '内部メモ' }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #293で修正・再判定し、一致。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを同じ比較画像で目視確認した。 内部メモ入力欄、スタッフのみの注意、キャンセル、メモ保存、トーク下部との重なりを確認した。",
    verdictSource: "inbox-v6/B7CER8.txt + 2026-09-07 same-input visual comparison",
    verdictHead: "4f8dfd8e0",
  },
  /*
    2-8 / 2-9 / 2-10 は「プルダウンを開いた状態」。素のセレクトのままだと
    開いた中身がブラウザ任せで**画像に写らない**ので、専用の部品へ替えた
    （`components/chats/inbox-dropdown.tsx`）。
    2-8 は一覧の絞り込み、2-9 は会話の見出し、2-10 は対応マーク。
  */
  {
    ...INBOX, node: 'YZaDK',
    /*
      担当者ごとの未読数。**集計の口を差し替えて、通常・0件・失敗を分けて撮る。**
      失敗のときも担当者一覧そのものは残る（別の口）ので、数だけ `—` になる。
    */
    states: {
      apis: ['**/api/chats/stats**'],
      kinds: ['normal', 'empty', 'error'],
    }, name: '2-8 担当者プルダウンを開く',
    /*
      **開いたまま撮る。** 設計 2-8 は開いた一覧そのもので、未読数は
      その行に出る。選んで閉じると数が写らず、3状態（通常・0件・失敗）の
      違いも見えない。開いた形なら
      通常「未割り当て 2 / Kenta 3 / Masato 0」・0件「すべて 0」・
      失敗「すべて —」がそのまま絵に残る。
    */
    steps: [...OPEN_CHAT, { click: '担当者で絞り込む' }],
    variants: [
      {
        /*
          通常のときだけ、担当者を選んだあとの形を撮る。
          **変種の手順は基本の手順の後ろに足される。** 基本でもう開いて
          あるので、ここで開き直すと閉じてしまう。**行を選ぶだけにする。**
        */
        suffix: 'selected',
        steps: [{ click: 'Kenta 3', role: 'option' }],
      },
    ],
    verdict: 'match',
    verdictNote: '**2026-09-04 担当者ごとの未読数を実装して撮り直した（board#33）。** ルート `/chats`（「担当者で絞り込む」を開いた形）。通常・0件・失敗・選択中の4状態を1440・1920で撮った（8枚、はみ出し0）。 数は `GET /api/chats/stats` の `assigneeUnread` から引く。**画面に見えている行から数えない**——一覧はページ送りされるので2ページ目の未読が落ちる。 **実値0と未取得を別の文字にした**：通常「未割り当て 2／Masato 0／Kenta 3」、0件「すべて 0」、失敗「すべて —」。**集計が失敗しても担当者一覧は消さない**（担当者は `/api/operators` の別の口）。 **P1 設計 `YZaDK` には未読数が描かれていない。** 開いた一覧は「すべて／河野／菅野／未割り当て」で数が無い。要件書 02 は「担当者別未読」を求めているので実装したが、**設計が先という決めごとに反するので Pencil へ回した**（board#106）。設計が入るまで一致にはしない。 **P2 並びが設計と違う**：設計は すべて→河野→菅野→**未割り当て（最後）**、実装は すべて→**未割り当て（2番目）**→Masato→Kenta。第2段でそろえる。 **P2 設計には各行に人の絵の印があるが実装に無い。**',
    // #217 の最新判定。上の文はそれまでの判定履歴として残す。
    ...{ verdictNote: '**2026-09-06 #217で一致。** `/chats` で会話を開いた同じ状態を1440・1920pxで撮影し、はみ出し0。「すべて→未割り当て→Kenta→Masato」の順、頭文字アイコン、未読数2/3/0、0件・集計失敗・Kenta選択後の全状態を設計画像と目視比較した。' },
    verdictSource: 'inbox-v6/YZaDK.txt + inbox-v6/YZaDK-1440.png + inbox-v6/YZaDK-1920.png',
    verdictHead: '70fac89c4',
  },
  {
    ...INBOX, node: 'L35UOV', name: '2-9 担当者変更を開く',
    steps: [...OPEN_CHAT, { click: '担当者を変える' }],
    verdict: 'match',
    verdictNote: '**2026-09-04 担当変更から絞り込み専用の「すべて」を外して撮り直した（board#66）。** ルート `/chats`（トーク見出しの「担当：」）。1440・1920とも横スクロール0。 **「すべて」は一覧を絞るための行で、担当者ではない。** 担当を変える口に出したままだと、押せば「すべて」という人へ割り当てようとする。設計 `L35UOV` も 河野・菅野・未割り当て の3つだけで「すべて」を置いていない。 実際に開いて確かめた：**担当を変える → 未割り当て／Masato／Kenta**、**一覧を絞る → すべて／未割り当て／Masato／Kenta**。絞り込み側の「すべて」は残っている。 P2 設計は名前と顔を並べた選び口。実装は名前だけで顔が出ない（第2段）。',
    // #217 の最新判定。上の文はそれまでの判定履歴として残す。
    ...{ verdictNote: '**2026-09-06 #217で一致。** `/chats` で会話を開き「担当者を変える」を1440・1920pxで撮影し、はみ出し0。Kenta→Masato→未割り当ての順、頭文字アイコン、選択色とチェック、検索欄を設計画像と目視比較した。' },
    verdictSource: 'inbox-v6/L35UOV.txt + inbox-v6/L35UOV-1440.png + inbox-v6/L35UOV-1920.png',
    verdictHead: '70fac89c4',
  },
  {
    ...INBOX, node: 'IYjvu', name: '2-10 対応状況変更を開く',
    steps: [...OPEN_CHAT, { click: '対応状況を変える' }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #293で修正・再判定し、一致。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを同じ比較画像で目視確認した。 未対応・対応中・保留・対応済みの順、色、選択中の印、見出しボタン直下の位置を確認した。",
    verdictSource: "inbox-v6/IYjvu.txt + 2026-09-07 same-input visual comparison",
    verdictHead: "4f8dfd8e0",
  },
  {
    ...INBOX, node: 'TUveA', name: '2-11 テンプレート・予約フォルダ',
    // 「予約」だけだと**分類のチップ**に当たる。フォルダの行は
    // `role="option"` で件数を含む名前になるので、そちらを指す。
    steps: [...OPEN_CHAT, { click: '▧ テンプレートを選択' }, { click: 'フォルダ' }, { click: '予約 5', role: 'option' }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #293で修正・再判定し、一致。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを同じ比較画像で目視確認した。 予約フォルダを確実に選ぶ撮影手順へ直し、予約5件だけの一覧、選択、プレビュー、入力欄への挿入を確認した。",
    verdictSource: "inbox-v6/TUveA.txt + 2026-09-07 same-input visual comparison",
    verdictHead: "4f8dfd8e0",
  },
  { ...INBOX, node: 'w72a2', name: '2-12 絞り込みを開く', steps: [...OPEN_CHAT, { click: '絞り込み' }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #293で修正・再判定し、一致。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを同じ比較画像で目視確認した。 絞り込みを全画面の右引き出しから設計寸法の固定窓へ直し、対応状況・担当者・受信経路・期限・メッセージ種別・未読、リセット、適用を確認した。未接続の2条件は理由を表示して押せない。",
    verdictSource: "inbox-v6/w72a2.txt + 2026-09-07 same-input visual comparison",
    verdictHead: "4f8dfd8e0",
  },
  { ...INBOX, node: 'ASsb3', name: '2-13 保存した検索を開く', steps: [...OPEN_CHAT, { click: '保存した検索' }],
    /* 行の「…」から削除操作を開いた形も、同じ実装として撮る。 */
    variants: [{ suffix: 'menu', steps: [{ qaOpen: 'ASsb3-menu' }] }],
    // #217 の最新判定。上の文はそれまでの判定履歴として残す。
    ...{ verdictNote: '**2026-09-06 #217で再撮影し、要修正のまま。** `/chats` の同じ状態を1440・1920pxで撮影し、はみ出し0。保存ボタンの文言はそろえ、削除は「…」メニューに移した。**残る差:** 設計の該当件数1/3/5件を返す集計口が無い。仮の数値は出さず「—件」と未取得理由を表示しているため、口の接続後に再判定が必要。' },
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #293で修正・再判定し、一致。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを同じ比較画像で目視確認した。 保存した検索3件を設計名と該当件数1・3・5件で表示し、現在条件の保存と各行メニューを確認した。",
    verdictSource: "inbox-v6/ASsb3.txt + inbox-v6/ASsb3-1440.png + inbox-v6/ASsb3-1920.png + 2026-09-07 same-input comparison",
    verdictHead: "4f8dfd8e0",
  },
  /*
    2-14 → 2-15 → 2-16 → 2-17 は一続きの流れ。
    「この条件を保存」で `Ln4zS` のモーダルを開き、名前を入れて保存する。
    エラーは空のとき・同じ名前のときで文を変える。
  */
  {
    ...INBOX, node: 'ANgda', name: '2-14 保存した検索名を入力',
    steps: [
      ...OPEN_CHAT,
      { click: '保存した検索' }, { click: '現在の条件を保存' },
      { fill: '検索名', text: '未対応・期限超過' },
    ],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #293で修正・再判定し、一致。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを同じ比較画像で目視確認した。 検索名、4条件の選択、よく使う設定、文字数、キャンセルと保存を持つ作成窓を入力済み状態で確認した。",
    verdictSource: "inbox-v6/ANgda.txt + 2026-09-07 same-input visual comparison",
    verdictHead: "4f8dfd8e0",
  },
  {
    ...INBOX, node: 'tBlkL', name: '2-15 保存した検索・保存完了',
    steps: [
      ...OPEN_CHAT,
      { click: '保存した検索' }, { click: '現在の条件を保存' },
      { fill: '検索名', text: '未割り当て・期限超過' }, { click: '検索条件を保存' },
    ],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #293で修正・再判定し、一致。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを同じ比較画像で目視確認した。 撮影用POSTを固定成功応答にし、保存後に窓が閉じ、保存一覧が開き、緑の完了通知が出る一連の状態を確認した。撮影データは永続化しない。",
    verdictSource: "inbox-v6/tBlkL.txt + 2026-09-07 same-input visual comparison",
    verdictHead: "4f8dfd8e0",
  },
  {
    ...INBOX, node: 'AuSDY', name: '2-16 保存した検索名・未入力エラー',
    /*
      **もう「押して断られる」形ではない。** 名前が空のあいだは保存ボタンが
      押せないので、前のように2回押しても何も起きない（押せない口を押して
      「撮れず」になる）。窓を開いたところまでで撮る。空のときの案内
      「検索名を入力してください。」は、開いた時点で出ている。
    */
    steps: [
      ...OPEN_CHAT,
      { click: '保存した検索' },
      { click: '現在の条件を保存' },
      { select: '保存する対応状況', label: '未対応' },
      { select: '保存する期限', label: '期限超過' },
    ],
    verdict: 'match',
    verdictNote: '**2026-09-04 未入力の断りを共通の赤い帯に寄せて撮り直した（board#57）。** ルート `/chats`（「保存した検索」→「この条件を保存」）。1440・1920とも横スクロール0。 **設計 `AuSDY`（2-16）と合った**：入力欄の枠が赤い／⚠つきの赤い帯で「検索名を入力してください。」／保存ボタンは灰色で押せない／「0 / 40文字」。**押してから断るのではなく、開いた時点で直しどころが分かる。** 前は小さな灰色の字だったので、**赤い枠だけ見えて理由が読まれない**形だった。共通部品 `Notice`（tone=error）に寄せて、自前の赤字をやめた。 **空のときと押して断られたときで同じ見た目にした。** 片方だけ帯にすると、同じ「入力してください」が2通りの見え方をして、別のことを言われたように読める。 **残る差（P2、第2段）**：設計の入力欄の初期表示は「検索名を入力してください」、実装は「例：未対応・期限超過」。設計の「保存する条件」は**その場で変えられる選び口**（対応マーク・期限・受信経路・担当者）、実装は読むだけ。設計にある「よく使うに追加」の切り替えが無い。ボタンが設計「検索条件を保存」／実装「この条件を保存」。',
    // #217 の最新判定。上の文はそれまでの判定履歴として残す。
    ...{ verdictNote: '**2026-09-06 #217 `a6ccecd230` で直して一致。** `/chats` の同じ未入力状態を1440・1920pxで撮影し、はみ出し0。設計と同じ順で、検索名の赤枠・0/40文字、対応状況／期限／受信経路／担当者の4選択、「よく使うに追加」、赤い説明帯、押せない保存ボタンを目視比較した。4条件は窓の中で変更して保存でき、期限超過は呼び出し時に再適用する。「よく使う」は既存の並び順へ保存して一覧上部に出るため、見た目だけの切替ではない。' },
    verdictSource: 'inbox-v6/AuSDY.txt + inbox-v6/AuSDY-1440.png + inbox-v6/AuSDY-1920.png',
    verdictHead: 'a6ccecd230',
  },
  {
    ...INBOX, node: 'LHjwD', name: '2-17 保存した検索名・重複エラー',
    steps: [
      ...OPEN_CHAT,
      { click: '保存した検索' }, { click: '現在の条件を保存' },
      { fill: '検索名', text: '未対応・期限超過' }, { click: '検索条件を保存' },
    ],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #293で修正・再判定し、一致。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを同じ比較画像で目視確認した。 既存名の保存時に赤枠と「同じ名前の保存した検索があります。別の名前を入力してください。」を表示し、条件と再保存操作を残すことを確認した。",
    verdictSource: "inbox-v6/LHjwD.txt + 2026-09-07 same-input visual comparison",
    verdictHead: "4f8dfd8e0",
  },

  // ── 機能3 友だち ────────────────────────────────────────
  { ...FRIENDS, node: 'PhxG6', name: '3-1 友だち',
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #265で修正・再判定。** 一致。4指標、検索・4絞り込み・状態チップ、7列の一覧、4行、ページ送りを設計順に表示した。残っていた日時の区切りを `2026/08/14 07:58` にそろえ、内部種別 `[sticker]` を「スタンプ」へ直した。1440・1920pxとも横はみ出し0、壊れ値・内部IDは0件。",
    verdictSource: "friends-v6/PhxG6.txt + PhxG6-{1440,1920}.png",
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
    steps: [{ qaOpen: 'LT8RS' }],
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #265で修正・再判定。** 一致。表示件数を開いた状態で10・20・30・40・50件を設計と同じ順に並べ、現在の20件を色とチェックで示した。安定した押し口 `data-qa-open=\"LT8RS\"` から2幅とも実際に開いて撮影し、横はみ出し0。",
    verdictSource: "friends-v6/LT8RS.txt + LT8RS-{1440,1920}.png",
  },
  {
    ...FRIENDS, node: 'Igi72', name: '3-1-B 友だち（詳細検索・14軸）',
    steps: [
      { click: '詳細条件' },
      { select: 'タグ名を選ぶ', label: 'NEN会員', after: 300 },
      { fill: 'input[placeholder="友だち情報欄名を入力"]', selector: true, text: '会員ランク', after: 200 },
      { fill: 'input[placeholder="値を入力"]', selector: true, text: 'ゴールド', after: 700 },
    ],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #381で実API接続後に再判定。** 一致。AND条件、ORの11軸、表示する友だち、対象・並び順・表示件数、保存済み条件の読込・保存、該当人数と実行操作を設計順に表示し、検索条件とsaved-viewsの実APIへ接続した。設計と固定データで人数・タグ名は異なるが、値を作らずAPI応答を表示している。1440/1920pxを撮影し、横はみ出し0、壊れ値・内部ID0件。",
    verdictSource: "friends-v6/Igi72.txt + Igi72-{1440,1920}.png",
  },
  {
    ...FRIENDS, node: 'IAf7j', name: '3-1-C 友だち（一括操作）',
    mode: 'viewport', height: 1080,
    /*
      **口を呼ぶところまで押す。** 窓を開くだけでは preview を呼ばないので、
      通常・取得失敗・権限不足がどれも同じ絵になる（一度そうなった）。
      タグを選んで「実行内容を確認」まで進めてから撮る。
    */
    steps: [
      { click: '表示中の友だちをすべて選ぶ', role: 'checkbox' },
      { qaOpen: 'IAf7j' },
      { select: 'どのタグ', label: 'NEN会員' },
      { click: '実行内容を確認' },
    ],
    states: {
      apis: ['**/api/friends/bulk-runs**'],
      kinds: ['normal', 'error', 'forbidden'],
    },
    variants: [
      {
        // 操作を選ぶ前。まだ何も数えていない面。
        suffix: 'pick',
        // 基本手順は確認画面まで進むため、この変種は一覧から開き直す。
        standalone: true,
        steps: [
          { click: '表示中の友だちをすべて選ぶ', role: 'checkbox' },
          { qaOpen: 'IAf7j' },
        ],
      },
      {
        /* 一部失敗。成功2人と一時失敗1人を混ぜずに描けるかを見る。 */
        suffix: 'result',
        steps: [
          { click: '表示中の友だちをすべて選ぶ', role: 'checkbox' },
          { qaOpen: 'IAf7j' },
          { select: 'どのタグ', label: 'NEN会員' },
          { click: '実行内容を確認' },
          { click: '3人に実行' },
        ],
      },
    ],
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #265で修正・再判定。** 一致。独立した一括操作面、9操作タイル、分類タブ、右の実行内容、下の選択友だち表を設計と同じ構造にした。タグの付け外しは実行可能、入力契約が未接続の操作は理由付きで無効化した。通常・失敗・権限不足・操作選択・結果を1440/1920pxで撮影し、全状態で横スクロール0。壊れ値・内部IDは0件。",
    verdictSource: "friends-v6/IAf7j-{normal,error,forbidden,pick,result}.txt + 同名-{1440,1920}.png",
  },
  { ...FRIENDS, node: 'I6UAdr', name: '3-1-D 友だち詳細', route: '/friends/detail?id=friend-0',
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #265で修正・再判定。** 一致。左を顧客情報カード、右を概要タブに組み替え、進行中の配信・自動処理、同じ人としてつながる情報、最近の履歴、この友だちに行う操作を設計と同じ順で配置した。未接続の予約・EC・横断履歴は値を作らず取得元待ちと明記。1440/1920pxで横スクロール0、壊れ値・内部IDは0件。",
    verdictSource: "friends-v6/I6UAdr.txt + I6UAdr-{1440,1920}.png",
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
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #265で修正・再判定。** 一致。読込・空・失敗のどれでも一覧の見出し、列、フッターを残し、表の中身だけを状態表示へ差し替える構造に統一した。未取得件数と0件を混ぜず、再読み込みも表内に表示。全状態を1440/1920pxで撮影し、横スクロール0、壊れ値0件。",
    verdictSource: "friends-v6/bzDn6-{loading,empty,error}.txt + 同名-{1440,1920}.png",
  },
  { ...FRIENDS, node: 'YzxU1', name: '3-2 重複検出', route: '/friends?tab=duplicates',
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #265で修正・再判定。** 一致。自動統合しない注意帯、5指標、検索・状態絞り込み、候補表、再検出、アカウント別内訳、重複マトリックスを設計と同じ順で配置した。候補表は本人照合候補APIの根拠・確信度・所属・状態を表示し、配信削減の実績だけは未接続のため値を作らず `—` と説明を表示。1440/1920pxで横スクロール0、壊れ値・内部IDは0件。",
    verdictSource: "friends-v6/YzxU1.txt + YzxU1-{1440,1920}.png",
  },
  {
    ...FRIENDS, node: 'InCDe', name: '3-2-A 重複候補詳細・統合前確認',
    route: '/friends/identity-candidates',
    states: {
      apis: ['**/api/identity-candidates*', '**/api/friends/duplicates/**'],
      kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'],
    },
    variants: [{ suffix: '-decide', steps: [{ qaOpen: 'InCDe', after: 700 }] }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #381で実API接続後に再判定。** 一致。判定根拠、結び付け後の影響、候補2件、項目ごとの採用値、タグ、判断履歴、別人・保留・結び付けの3判断、理由必須、利用目的と規約の確認を設計順に表示し、候補取得と判定保存の実APIへ接続した。連絡先は安全のためマスク済み値だけを表示する。通常・読込中・0件・取得失敗・権限不足・判定窓の全14枚で横はみ出し0、壊れ値・内部ID0件。",
    verdictSource: "friends-v6/InCDe-{normal,loading,empty,error,forbidden,decide}.txt + 同名-{1440,1920}.png",
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
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #265で修正・再判定。** 一致。4指標、統合ユーザー作成導線、検索、複数アカウント・UID・所属の絞り込み、CSV、表、ページ送りを設計と同じ構造にした。LINEユーザーIDは出さず連携状態だけを表示し、詳細ボタンも設計の緑へ統一。重複配信削減の実績は未接続なので値を作らず `—` と説明を表示。通常・読込・空・失敗を1440/1920pxで撮影し、横スクロール0、壊れ値・内部IDは0件。",
    verdictSource: "friends-v6/r7eSi-{normal,loading,empty,error}.txt + 同名-{1440,1920}.png",
  },
  {
    ...FRIENDS, node: 'w8W4Eh', name: '3-3-A 統合ユーザー詳細',
    route: '/friends?tab=merged',
    /*
      一覧の行から1件開く。同じ画面を二重に作らないため、詳細に別のルートは
      無い。押し口の印（`data-qa-open`）で開く。
    */
    steps: [{ qaOpen: 'w8W4Eh', after: 900 }],
    states: {
      apis: ['**/api/friends/people/**'],
      kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'],
    },
    variants: [
      {
        suffix: '-profile',
        steps: [{ qaOpen: 'w8W4Eh-profile', after: 700 }],
      },
      {
        suffix: '-edit',
        steps: [
          { qaOpen: 'w8W4Eh', after: 900 },
          { click: '優先順位を変更', after: 700 },
        ],
      },
      {
        suffix: '-unlink',
        steps: [
          { qaOpen: 'w8W4Eh', after: 900 },
          { qaOpen: 'w8W4Eh-unlink', after: 700 },
        ],
      },
      {
        /* 保存だけ 409 にして、押した先の版競合を撮る。読み込みは素通し。 */
        suffix: '-conflict',
        state: { apis: ['**/api/friends/people/**'], kind: 'conflict', method: 'PATCH' },
        steps: [
          { qaOpen: 'w8W4Eh', after: 900 },
          { click: '優先順位を変更', after: 700 },
          { click: '保存する', after: 900 },
        ],
      },
    ],
    verdict: "match",
    verdictNote: "**2026-09-07 #411 で一致。** 設計 `w8W4Eh` と実装の通常・読込中・0件・取得失敗・権限不足・プロフィール編集・配信元編集・解除確認・版競合を1440/1920pxで横並び比較した。上段3カード、結び付く友だち、統合属性、横断履歴、主要操作の位置と情報の順序がそろい、全状態で横はみ出し0。プロフィール編集は、Workerが現在の候補から発行した候補IDだけを画面から返し、サーバー側で再照合して採用する。候補が古い場合は409で再読込を案内し、権限・操作履歴・版番号も既存契約のまま守る。画面にはマスク済み値だけを表示し、候補ID・友だちID・LINEアカウントID・生のメールアドレスと電話番号は表示しない。`undefined`・`NaN`・`Invalid Date`・`API error` は0件。",
    verdictSource: "friends-v6/w8W4Eh-normal-1920.png + friends-v6/w8W4Eh-profile-1920.png",
    verdictHead: "cd54cfd63",
  },
  {
    ...FRIENDS, node: 'vtBCu', name: '3-4 UID移行', route: '/accounts?tab=migration',
    verdict: 'match',
    verdictNote: '**2026-09-06 #246 で一致。** 1920px設計画像と実装の1440・1920pxを横並びで目視比較した。5段、既存データへ影響しない注意、異なるプロバイダーの制約、移行元・先・利用目的・CSV、4区分の実値、競合3行、判断、本移行、履歴が同じ順序で揃い、横はみ出し0。`uid_migration_runs/items` の事前確認・競合判断・owner二者確認・本移行・切り戻しAPIへ接続した。共通shellの上部画面名はルート規則により「LINEアカウント」だが、機能本文のH1は「UID移行」で一致し、共通部品はs0所有のため変更していない。`undefined`・`NaN`・`Invalid Date`・`API error` は0件。',
    verdictSource: 'friends-v6/vtBCu.txt + docs/design-qa/friends-v6/vtBCu.txt + apps/web/src/app/accounts/migration.tsx + apps/worker/src/routes/friend-migrations.ts',
  },
  // ── 機能5 シナリオ配信 ──────────────────────────────────
  { ...SCENARIO, node: 'TC1b1', name: '5-1 シナリオ配信', route: '/scenarios',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #325で固定データ反映後に再判定。** 設計1920pxと実装1920pxを同じ比較画像に並べ、実装1440/1920pxも確認。一致。#1073の固定応答から「初回案内・購入後・予約フォロー」3分類と未分類を表示し、案内、4指標、フォルダ、検索・絞り込み、5行の一覧、状態と行操作が設計と同じ役割・順序になった。1440/1920pxとも横はみ出し0。",
    verdictSource: "scenarios-v6/TC1b1.txt + scenarios-v6/TC1b1-{1440,1920}.png + 2026-09-07 same-input comparison",
    verdictHead: "31c2fddcc",
  },
  { ...SCENARIO, node: 'cCB7r', name: '5-1-A シナリオ作成・配信方式', route: '/scenarios/mode?id=scenario-0',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #294で修正・再判定。** 一致。3段の現在地、下書き作成の案内、シナリオ名・フォルダ、時刻指定・経過時間の2カード、2人の具体例、選択操作を設計と同じ順にそろえた。現在地を案内より先へ移し、2幅とも横はみ出し0。",
    verdictSource: "scenarios-v6/cCB7r.txt + cCB7r-{1440,1920}.png",
    verdictHead: "9294bdeeb",
  },
  { ...SCENARIO, node: 'kk8dz', name: '5-1-B シナリオ作成・1通目設定', route: '/scenarios/first-step?id=scenario-0',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #366で再撮影・再判定。** 3104/8791で1440px・1920pxを撮影し、両幅とも横はみ出し0。Pencil 1920pxと実装1920pxを目視比較した。一致。固定データの1通目を読み、編集値は `{{name}}` のまま保ちながらLINEプレビューだけを「Kentaさん」に差し込み表示した。3段の現在地、9種類のメッセージ、配信の流れ、設定サマリーまで設計と同じ役割・順序で確認した。",
    verdictSource: "scenarios-v6/kk8dz.txt + scenarios-v6/kk8dz-1440.png + scenarios-v6/kk8dz-1920.png",
    verdictHead: "1d9e8d36c",
  },
  { ...SCENARIO, node: 'bV5Vs', name: '5-1-C シナリオ編集', route: EDIT,
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #325で固定データ反映後に再判定。** 設計1920pxと実装1920pxを同じ比較画像に並べ、実装1440/1920pxも確認。一致。#1073の固定応答から設計と同じ4通目「7日間フォロー完了のお知らせ」を表示し、開始前の注意、5枚の設定札、購読中・読了済・離脱、4行のステップ表、各操作、下部操作が設計と同じ役割・順序になった。1440/1920pxとも横はみ出し0。",
    verdictSource: "scenarios-v6/bV5Vs.txt + scenarios-v6/bV5Vs-{1440,1920}.png + 2026-09-07 same-input comparison",
    verdictHead: "31c2fddcc",
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
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #294で修正・再判定。** 一致。ステップ編集時はシナリオ全体の一覧を隠し、対象の1通だけを編集する専用面に切り替えた。左に配信タイミング・メッセージ・対象・送信後アクション、右にLINEプレビュー・配信の流れ・設定サマリー、上部に閉じる・保存を配置した。2幅とも横はみ出し0。",
    verdictSource: "scenarios-v6/xfYLn.txt + xfYLn-{1440,1920}.png",
    verdictHead: "9294bdeeb",
  },
  {
    ...SCENARIO, node: 'r6Gzsu', name: '5-1-E シナリオ・配信条件を開く', route: EDIT,
    mode: 'viewport', height: 1080,
    steps: [{ click: '編集', nth: 1 }, { click: '条件を編集', after: 700 }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #436で実API接続後に再判定。** 1通目の固定データからタグ「初回案内」と対応マーク「未対応」のAND条件を読み、現在条件2件、15軸、条件追加、解除、保存を表示した。1440/1920pxとも横はみ出し0。",
    verdictSource: "scenarios-v6/r6Gzsu.txt + scenarios-v6/r6Gzsu-{1440,1920}.png",
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
    mode: 'viewport', height: 1080,
    steps: [{ click: '編集', nth: 1 }, { click: '＋ アクションを追加', after: 700 }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #436で実API接続後に再判定。** 送信後アクションの取得とV6下書きの読み返しを並列で行い、下書き版3、選択できる全動作、設定済み3動作の順序・条件・再実行設定を表示した。1440/1920pxとも横はみ出し0。",
    verdictSource: "scenarios-v6/hz9ti.txt + scenarios-v6/hz9ti-{1440,1920}.png",
  },
  {
    ...SCENARIO, node: 'dqFft', name: '5-1-G シナリオ・ステップ削除確認', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ click: 'この通を削除する' }],
    verdict: "match",
    verdictNote: "**2026-09-06 #266で判定。** 設計1920pxと実装1440/1920pxを目視比較。対象ステップの編集背景上で削除確認が開き、削除対象、配信対象とアクションも消える影響、履歴が残ること、取り消せないこと、戻る・削除の操作が設計と一致。1440/1920pxとも横はみ出し0。",
    verdictSource: "scenarios-v6/dqFft.txt + scenarios-v6/dqFft-{1440,1920}.png",
    verdictHead: "c03ebf864",
  },
  {
    ...SCENARIO, node: 'EvVO5', name: '5-1-H シナリオ・開始条件を開く', route: EDIT,
    mode: 'viewport', height: 1080, steps: [{ qaOpen: 'EvVO5', after: 900 }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #436で実API接続後に再判定。** 副作用のない試算APIをPOSTで読み、条件一致124人、購読中8人、新規開始予定116人、除外304人を表示した。開始条件6種のうち接続済み4種と、未接続の手動・Webhookの理由も区別した。1440/1920pxとも横はみ出し0。",
    verdictSource: "scenarios-v6/EvVO5.txt + scenarios-v6/EvVO5-{1440,1920}.png",
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
    /* 押し口は文言でなく Node ID の目印で開く（#590 で付けた）。 */
    steps: [{ qaOpen: 'RUxNf', after: 900 }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #436で実API接続後に再判定。** 開始確認で試算と開始記録を並列取得し、新規開始予定116人、最新テスト送信4通、送信枠残り3,158通を表示した。戻せない影響と開始操作を設計順に確認し、1440/1920pxとも横はみ出し0。",
    verdictSource: "scenarios-v6/RUxNf.txt + scenarios-v6/RUxNf-{1440,1920}.png",
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
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #436で実API接続後に再判定。** 開始後の案内へ試算の新規開始予定116人を表示し、開始記録から配信中116人、完了312人、開始時刻、4通の到達数を読み返した。開始履歴への次の行動も確認し、1440/1920pxとも横はみ出し0。",
    verdictSource: "scenarios-v6/NrBkW.txt + scenarios-v6/NrBkW-{1440,1920}.png",
  },
  {
    ...SCENARIO, node: 'g2UNV', name: '5-1-K シナリオ・テスト送信', route: EDIT,
    mode: 'viewport', height: 1080, /* **#427 で「一括テスト送信」が1つになった**（前は2つあり2番目を押していた）。 */
    steps: [
      { click: '一括テスト送信' },
      { click: 'Kenta Kawano(Obama)', after: 300 },
      { click: '内容を確認', after: 700 },
    ],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #436で実API接続後に再判定。** 選んだ友だちへの全4通、配信日時、メッセージ種別、LINEへ実送信する注意、前回のテスト送信4通を開始記録APIから表示した。本番の購読と配信予定を変えないことも明示し、1440/1920pxとも横はみ出し0。",
    verdictSource: "scenarios-v6/g2UNV.txt + scenarios-v6/g2UNV-{1440,1920}.png",
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
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #436で実API接続後に再判定。** 開始428人、完了312人、参加中134人と4通の到達・クリック・失敗内訳を開始記録APIから表示した。LINEが提供しない個別開封率は「—」と未取得理由を残した。通常・読込中・取得失敗を1440/1920pxで撮影し、全画像で横はみ出し0。",
    verdictSource: "scenarios-v6/M2b2B.txt + scenarios-v6/M2b2B-{normal,loading,error}.txt + scenarios-v6/M2b2B-{normal,loading,error}-{1440,1920}.png",
  },
  {
    ...SCENARIO, node: 'q5G45', name: '5-1-M 一覧の状態（空・読込・エラー）', route: '/scenarios',
    states: { apis: ['**/api/scenarios*', '**/api/scenarios/**', '**/api/list-stats*'], kinds: ['loading', 'empty', 'error'] },
    verdict: "match",
    verdictNote: "**2026-09-06 #266で判定。** 設計1920pxと実装1440/1920pxを目視比較。通常・読込中・0件・取得失敗を両幅で撮影。読込中を0件と誤表示せず、0件は作成導線、取得失敗は再試行を出し、案内帯と4指標も同じ面に残る。全状態で横はみ出し0。",
    verdictSource: "scenarios-v6/q5G45.txt + scenarios-v6/q5G45-{1440,1920}.png",
    verdictHead: "c03ebf864",
  },

  // ── 機能6 一斉配信 ──────────────────────────────────────
  { ...BROADCAST, node: 'q76C35', name: '6-1 一斉配信',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #384で一致判定。** 一覧KPI・保存した検索・ページ情報を実API契約の固定データで表示。共通固定データ #388 / PR #1142 の統合後に平均開封率69.4%を確認し、画面側の推測補正は行っていない。1440/1920pxで横はみ出し0。',
    verdictSource: 'broadcasts-v6/q76C35.txt + broadcasts-v6/q76C35-{1440,1920}.png',
    verdictHead: 'a19b5d73aa', route: '/broadcasts',
    // ---- 2026-09-02 `df3f4e3b` で撮り直した（#674 マージ後）。**絵を見て確かめた範囲だけ書く。** ----
    // 解決：**列が設計どおりの6列になった**（タイトル・内容／状態／配信条件／配信日時／配信・開封・クリック／操作）。
    //       上の P2「実装は8列」は解消。状態が独立した桁になり、削除が「操作」に入って、1列ずれも消えている。
    // 解決：**まだ送っていない配信の「配信・開封・クリック」が `0` ではなく `—`。** 下書き2件と予約済み1件で確認。
    // 解決：帯に `undefined` が出ていない（今月の配信 12件／到達 1,842通／平均開封率 69.4%／失敗 0通）。
    // 確認：配信日時は `apps/web/src/app/broadcasts/page.tsx:37` が `timeZone: 'Asia/Tokyo'` を明示しており、
    //       端末の時計に依らない（撮影機は UTC+7）。
    // **要確認：帯の4枚が「今月の配信／到達／平均開封率／失敗」に戻っている。**
    //   上の #602 の注記は「予約中・下書き `—`・今月の配信・平均開封率」にしたと書いている。
    //   どちらが設計かをこの絵からは決められないので、**判定は needs_fix のまま据え置く**。
    //   1機能を複数PRで直しているため、撮り直しで別PRの直しが戻った可能性がある。
    // 取得元：`broadcasts-v6/q76C35-1440.png`（`df3f4e3b`）
  },
  { ...BROADCAST, node: 'zZ9fA', name: '6-1-A 一斉配信を作成',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #365で一致判定。** 社内メモと段階付き下書きを保存APIへ接続し、配信方法3択・最近の配信・設定要約・LINEプレビューを設計画像と比較。1440/1920pxで横はみ出し0。',
    verdictSource: 'broadcasts-v6/zZ9fA.txt + broadcasts-v6/zZ9fA-{1440,1920}.png',
    verdictHead: '02ec27d0d', route: NEW_BC,
    steps: [
      { fill: 'input[placeholder="例：8月キャンペーンのお知らせ"]', selector: true, text: '8月キャンペーンのお知らせ' },
      { fill: '社内メモ', text: '8月の売上目標に向けた告知。反応が薄ければ 8/28 に再送する。' },
      { select: 'フォルダ', label: 'キャンペーン' },
    ],

  },
  {
    ...BROADCAST, node: 'cPk8A', name: '6-1-B 対象条件',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #384で一致判定。** 事前確認APIの条件一致1,248人・送信可能1,213人・除外35人と代表友だち3人を表示。別の件数取得が失敗しても事前確認の確定人数を右側要約へ再利用し、本文との「1,213人 / —人」の食い違いを解消。1440/1920pxで横はみ出し0。',
    verdictSource: 'broadcasts-v6/cPk8A.txt + broadcasts-v6/cPk8A-{1440,1920}.png',
    verdictHead: '55b3531ecb', route: `${NEW_BC}?step=audience&scoreMin=20&scoreMax=80`,
    /*
      **「詳細条件で絞り込んで配信する」を選ばないと保存の口が開かない。**
      条件がひとつも無いうちは「この条件を保存」が押せない（押せない理由も
      吹き出しに書いてある）。設計の見どころは**保存と呼び出しの2つの口**
      なので、そこまで進めてから撮る。
    */
    steps: [{ wait: 1200 }],

  },
  { ...BROADCAST, node: 'XQfMD', name: '6-1-C メッセージ編集',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #365で一致判定。** URL/PDFボタンと公開済み共通アクションの版を保存APIへ接続し、本文・ボタン・短縮URL・配信後アクション・LINEプレビューを同じ状態で撮影。1440/1920pxで横はみ出し0。',
    verdictSource: 'broadcasts-v6/XQfMD.txt + broadcasts-v6/XQfMD-{1440,1920}.png',
    verdictHead: '02ec27d0d', route: `${NEW_BC}?step=message&templateId=template-11`,
    steps: [
      { wait: 1800 },
      { fill: 'textarea[placeholder="テキストを入力"]', selector: true, text: '{{name}}さんへ\n新商品が本日発売になりました。\nhttps://nen.example/aug' },
      { click: '＋ ボタンを追加' },
      { fill: 'ボタン1のラベル', text: 'キャンペーンを見る' },
      { fill: 'ボタン1のURL', text: 'https://nen.example/aug' },
      { select: '配信後のアクション', label: '来店後のご案内（第3版）' },
    ],

  },
  {
    /*
      **設計は重なる窓だが、実装は本文の下に開く欄。**
      見えている範囲だけ撮ると、開いた中身が画面の外に残る。
      ここは `page` で撮って、開いた欄まで写す。
    */
    ...BROADCAST, node: 'p97Tf', name: '6-1-D テンプレート選択',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #384で一致判定。** 固定データの予約確認テンプレートを選び、更新日・使用回数・本文と読み込み前チェックを確認窓へ表示。1440/1920pxで横はみ出し0。',
    verdictSource: 'broadcasts-v6/p97Tf.txt + broadcasts-v6/p97Tf-{1440,1920}.png',
    verdictHead: '55b3531ecb', route: `${NEW_BC}?step=message`,
    mode: 'viewport', height: 1080, steps: [
      { click: 'テンプレートから選ぶ' },
      { click: '予約確認', after: 700 },
    ],

  },
  {
    ...BROADCAST, node: 'Bw0zt', name: '6-1-E 送信設定',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #384で一致判定。** 事前確認APIの月間使用1,842通・上限5,000通・残り3,158通・予定1,213通と同時刻の配信を表示。予約日時・分散送信・開封計測・配信スケジュールを1440/1920pxで撮影し、横はみ出し0。',
    verdictSource: 'broadcasts-v6/Bw0zt.txt + broadcasts-v6/Bw0zt-{1440,1920}.png',
    verdictHead: '55b3531ecb', route: `${NEW_BC}?step=schedule&templateId=template-11&scheduledDate=2026-08-24&scheduledTime=10%3A00`,
    mode: 'viewport', height: 1136, steps: [{ wait: 1800 }],

  },
  {
    /*
      **空のまま押すと窓が開かない。** 「管理用タイトルを入力してください」が
      出るだけで、テスト送信の窓は出ない。先に管理名と本文を埋める。
      （その注意文が、欄から遠い本文の下に出るのも差として残る）
      撮り直すまで判定は入れない。
    */
    ...BROADCAST, node: 'h0kahp', name: '6-1-F テスト送信',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #384で一致判定。** LINE連携済み担当者2人を固定データから確認窓へ表示し、選択して送る導線と送信前の説明を1440/1920pxで撮影。横はみ出し0。',
    verdictSource: 'broadcasts-v6/h0kahp.txt + broadcasts-v6/h0kahp-{1440,1920}.png',
    verdictHead: '55b3531ecb', route: `${NEW_BC}?step=message&templateId=template-11`,
    mode: 'viewport', height: 1080,
    /*
      **本文の入れ物には名札が無い。** `textarea` は `placeholder` だけなので
      `getByLabel` では引けない。`selector: true` で CSS から引く。
      名札で引こうとして 30 秒待って落ちた。
    */
    steps: [
      { wait: 1800 },
      { click: 'テスト送信' },
      { wait: 800 },
    ],

  },
  {
    ...BROADCAST, node: 'vW4Es', name: '6-1-G 配信前チェック',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #384で一致判定。** 対象・日時・テスト送信・LINEプレビューと、事前確認APIの残り送信枠3,158通を同じ確認窓へ表示。1440/1920pxで横はみ出し0。',
    verdictSource: 'broadcasts-v6/vW4Es.txt + broadcasts-v6/vW4Es-{1440,1920}.png',
    verdictHead: '55b3531ecb', route: `${NEW_BC}?step=confirm&templateId=template-11&scheduledDate=2026-08-24&scheduledTime=10%3A00`,
    /*
      **確かめました（2026-08-28）。実装は在ります。**
      置き文のままだったのは、こちらの口が `POST /api/broadcasts/preflight` を
      405 で弾いていたためでした。**数えるだけで何も保存しない口**なので
      通すようにし、本文を書くと帯が埋まります
      （「2件 未確認／1,284 人に届きます／…」）。
      本文を入れないと帯が出ないので、`fill` してから撮る。
    */
    steps: [
      { wait: 1800 },
      { click: 'LINEプレビューが未確認です', role: 'checkbox', after: 300 },
      { click: '配信前チェックを確認', after: 700 },
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
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #384で一致判定。** 管理名・対象1,213人・日時・メッセージ・開封計測・配信後アクションと残り送信枠3,158通を最終確認へ表示。1440/1920pxで横はみ出し0。',
    verdictSource: 'broadcasts-v6/FpgxH.txt + broadcasts-v6/FpgxH-{1440,1920}.png',
    verdictHead: '55b3531ecb',
    route: `${NEW_BC}?step=confirm&templateId=template-11&scheduledDate=2026-08-27&scheduledTime=10%3A00`, mode: 'viewport', height: 1080,
    steps: [
      { wait: 1800 },
      { click: 'LINEプレビューが未確認です', role: 'checkbox', after: 300 },
    ],
  },
  {
    /*
      **`/broadcasts/reserved?id=` で開く。** `status === 'scheduled'` かつ
      `scheduledAt` があるときだけ出る（無ければ「予約状態を確認できませんでした」）。
      固定データの `broadcast-0` が予約済みなので、そこを見る。
    */
    ...BROADCAST, node: 'bPF0s', name: '6-1-I 一斉配信・予約完了',
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-07 Issue #384で再撮影。** 予約済み固定データから5段の完了帯、予約日時・対象人数・4項目の要約、次にできる操作、取消確認を1440/1920pxで表示し、横はみ出し0。設計画像と照合したが、開始・完了・エラーをSlackへ通知するAPIがないため、その1文は虚偽表示せず構造一致・データ未接続のまま。',
    verdictSource: 'broadcasts-v6/bPF0s.txt + broadcasts-v6/bPF0s-1440.png + broadcasts-v6/bPF0s-1920.png + broadcasts-v6/bPF0s-cancel-1440.png + broadcasts-v6/bPF0s-cancel-1920.png',
    verdictHead: '55b3531ecb',
    route: '/broadcasts/reserved?id=broadcast-0', mode: 'page',
    /* 押した先の確認窓。**窓はビューポートで撮る**（`fullPage` だと下へ流れる）。 */
    variants: [{
      suffix: '-cancel', mode: 'viewport',
      steps: [{ click: '予約を取り消す', after: 900 }],
    }],

  },
  { ...BROADCAST, node: 'u6gHt', name: '6-1-J 結果詳細',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #384で一致判定。** インサイトAPIの到達624人・開封444人・リンク別クリック2行を、概要・クリック・友だち・エラー・配信内容の各タブとLINEプレビューへ接続。1440/1920pxで横はみ出し0。',
    verdictSource: 'broadcasts-v6/u6gHt.txt + broadcasts-v6/u6gHt-{1440,1920}.png',
    verdictHead: '55b3531ecb', route: '/broadcasts/detail?id=broadcast-2',

  },
  {
    ...BROADCAST, node: 'EGMb1', name: '6-1-K 削除確認',
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #219 / PR #979で一致判定。** 配信名だけの見出し、予約取消を含む説明、キャンセル/削除の2操作を正本と一致させた。設計1920pxと実装1440/1920pxを目視比較し、横はみ出し0。',
    verdictSource: 'broadcasts-v6/EGMb1.txt + broadcasts-v6/EGMb1-{1440,1920}.png',
    verdictHead: '3c6e4ec948', route: '/broadcasts',
    mode: 'viewport', height: 1080, steps: [{ click: '削除' }],

  },
  {
    ...BROADCAST, node: 'sqFXf', name: '6-1-L 対象条件を編集',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #384で一致判定。** 条件付きURLから条件編集窓を開き、15標準軸・6配信専用軸、代表友だち3行、保存済み条件の読込と新規保存まで1440/1920pxで撮影。横はみ出し0。`sqFXf-save` は設計画像なしのため `.txt` と照合。',
    verdictSource: 'broadcasts-v6/sqFXf.txt + broadcasts-v6/sqFXf-save.txt + broadcasts-v6/sqFXf{,-save}-{1440,1920}.png',
    verdictHead: '55b3531ecb', route: `${NEW_BC}?step=audience&scoreMin=20&scoreMax=80`,
    /* 保存する窓と、呼び出す窓。**窓はビューポートで撮る。** */
    mode: 'viewport', height: 1080,
    steps: [{ click: '条件を編集', after: 700 }],
    variants: [{
      suffix: '-save', mode: 'viewport',
      steps: [
        { click: 'この条件を反映', after: 700 },
        { click: '保存した条件から選ぶ', after: 900 },
        { click: 'この条件を使う', after: 900 },
        { click: 'この条件を保存', after: 900 },
      ],
    }],

  },
  {
    ...BROADCAST, node: 'xkRDb', name: '6-1-M フォルダ操作',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #384で一致判定。** KPI・フォルダ・検索・絞り込み・6列一覧、保存した検索の読込と保存、操作メニューと追加窓を撮影。共通固定データ #388 / PR #1142 の統合後に平均開封率69.4%を確認した。1440/1920pxで横はみ出し0。', route: '/broadcasts',
    verdictSource: 'broadcasts-v6/xkRDb.txt + broadcasts-v6/xkRDb-1440.png + broadcasts-v6/xkRDb-1920.png + broadcasts-v6/xkRDb-add-1440.png + broadcasts-v6/xkRDb-add-1920.png',
    verdictHead: 'a19b5d73aa',
    mode: 'viewport', height: 1080, steps: [{ qaOpen: 'xkRDb', after: 700 }],
    variants: [{ suffix: '-add', steps: [{ click: 'フォルダを追加', after: 700 }] }],

  },
  {
    ...BROADCAST, node: 'TmHjF', name: '6-1-N 一覧の状態（空・読込・エラー）',
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #219 / PR #979で一致判定。** 通常・読込・空・取得失敗・権限不足を1440/1920pxで撮影。KPI未取得を「読み込めていません」、空を「最初の1つを作ると、ここに並びます。」へ統一し、設計との本文差0、横はみ出し0。',
    verdictSource: 'broadcasts-v6/TmHjF*.txt + broadcasts-v6/TmHjF*-{1440,1920}.png',
    verdictHead: '3c6e4ec948', route: '/broadcasts',
    /*
      **末尾が `broadcasts*` だと `/api/broadcasts/stats` に届かない。**
      Playwright の `*` は `/` をまたがない。届かないまま撮ると、一覧が
      読めていないのに帯だけ数が残る。機能3でも同じことが起きていた。
    */
    states: {
      apis: ['**/api/broadcasts?**', '**/api/broadcasts', '**/api/broadcasts/stats*', '**/api/list-stats*'],
      kinds: ['loading', 'empty', 'error', 'forbidden'],
    },

  },

  // ── 機能7 リマインダ ────────────────────────────────────
  /* 設計どおり、基本設定→対象者→通知ステップ→送信設定→確認を段ごとに撮る。 */
  { ...REMINDER, node: 'M1EXwB', name: '7-1 リマインダ',
    verdict: 'match',
    verdictNote: '**2026-09-07 S2 #73。** 正本 `M1EXwB.png` の操作列に合わせ、削除をアイコン化し、「…」から配信予定と実行履歴を選べるようにした。通常・メニュー展開を1440/1920で撮影し、横はみ出し0。予定は実行台帳の公開状態 `planned` へ接続し、固定件数を作らない。head `a828e5afc3`。',
    verdictSource: 'reminders-v6/M1EXwB.txt + reminders-v6/M1EXwB-{1440,1920}.png + reminders-v6/M1EXwB-planned-menu-{1440,1920}.png',
    verdictHead: 'a828e5afc3', route: '/reminders',
    variants: [{ suffix: '-planned-menu', steps: [{ click: '未返信3日後フォローのその他操作', after: 500 }] }], },
  { ...REMINDER, node: 'uJP22', name: '7-1-A リマインダを作成',
    verdict: 'match',
    verdictNote: '**2026-09-06 S2 #220。** 正本 `uJP22` の5段ステッパー、基本設定、基準日、ひな形、設定内容、LINEプレビュー、テスト案内を同じ配置で実装。1440/1920で横はみ出し0。PR #927 head `eb41ad0d` の実装を比較した。',
    verdictHead: 'eb41ad0d', route: '/reminders/new',
    steps: [
      { fill: 'input[maxlength="60"]', selector: true, text: 'Google Meet相談の前日案内' },
      { fill: 'textarea[placeholder="運用目的や注意点を入力"]', selector: true, text: 'Meet相談の無断キャンセルを減らす目的。前日・1時間前・当日の3回で運用する。' },
    ], },
  {
    ...REMINDER, node: 'J64xI', name: '7-1-B 通知ステップ編集',
    verdict: 'match',
    verdictNote: '**2026-09-06 S2 #220。** 正本 `J64xI` の通知カード3件、時刻/繰越、差し込み分類、本文、送信後アクション、URL扱い、右プレビューを実装。1440/1920で横はみ出し0。PR #927 head `eb41ad0d` の実装を比較した。',
    verdictHead: 'eb41ad0d',
    route: '/reminders/edit?id=reminder-3',

  },
  {
    ...REMINDER, node: 's7T2dz', name: '7-1-C 対象と終了条件',
    verdict: 'match',
    verdictNote: '**2026-09-06 S2 #220。** 正本 `s7T2dz` の対象条件・人数内訳、基準日、終了/停止条件4件、安全な運用を同じ構成で実装。1440/1920で横はみ出し0。PR #927 head `eb41ad0d` の実装を比較した。',
    verdictHead: 'eb41ad0d',
    route: '/reminders/edit?id=reminder-3&stage=target', mode: 'page',

  },
  {
    ...REMINDER, node: 'JCz6J', name: '7-1-D 配信予定プレビュー',
    verdict: 'match',
    verdictNote: '**2026-09-06 S2 #220。** 正本 `JCz6J` の期間切替、配信予定表、重複/時間帯確認、設定内容、LINEプレビューを実装し、予定APIへ接続。1440/1920で横はみ出し0。PR #927 head `eb41ad0d` の実装を比較した。',
    verdictHead: 'eb41ad0d',
    route: '/reminders/edit?id=reminder-3&stage=preview', mode: 'page',

  },
  {
    ...REMINDER, node: 'W98zZQ', name: '7-1-E テスト送信確認',
    verdict: 'match',
    verdictNote: '**2026-09-06 S2 #220。** 正本 `W98zZQ` の送信先、差し込み値表、履歴、LINEプレビュー、画面内テスト確認窓を実装し、テストAPIへ接続。1440/1920で横はみ出し0。PR #927 head `eb41ad0d` の実装を比較した。',
    verdictHead: 'eb41ad0d',
    route: '/reminders/edit?id=reminder-3&stage=test', mode: 'page',
    steps: [{ click: 'テスト送信', after: 300 }],

  },
  {
    ...REMINDER, node: 's6Vvp', name: '7-1-F 最終確認',
    verdict: 'match',
    verdictNote: '**2026-09-06 S2 #220。** 正本 `s6Vvp` の有効化前チェック、対象/基準日/通知順/停止条件の要約、LINEプレビュー、公開操作を実装し、検証/公開APIへ接続。1440/1920で横はみ出し0。PR #927 head `eb41ad0d` の実装を比較した。',
    verdictHead: 'eb41ad0d',
    route: '/reminders/edit?id=reminder-3&stage=confirm', mode: 'page',

  },
  {
    ...REMINDER, node: 'PSmHo', name: '7-1-G 有効化完了',
    verdict: 'match',
    verdictNote: '**2026-09-06 S2 #220。** 正本 `PSmHo` の完了表示、配信設定、次にできること、監視項目、LINEプレビューを実装。完了URLを直接開いても下書き/予定/検証の値を取得する。1440/1920で横はみ出し0。PR #927 head `eb41ad0d` の実装を比較した。',
    verdictHead: 'eb41ad0d',
    route: '/reminders/edit?id=reminder-3&stage=done', mode: 'page',

  },
  {
    /*
      **PR #500（head `409f00bb`）で `/reminders/detail` が入った。**
      7機能で共通に使う `ExecutionRunListItem`（9項目）と、
      リマインダの書込台帳だけが持つ `domainStatus` の両方を返す。
      **表は1本にせず、読む口の契約でそろえる形。**
    */
    ...REMINDER, node: 'GC4St', name: '7-1-H 実行結果',
    route: '/reminders/detail?id=reminder-1',
    states: {
      apis: ['**/api/reminders/*/runs*'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
    verdict: 'match',
    verdictNote: '**2026-09-07 S2 #73。** 正本 `GC4St.png` と同じ実行台帳の骨格を保ち、`?status=planned` では公開APIの `planned` だけを表示する。予定と履歴を相互に切り替えられ、予定画面には過去の送信エラー警告を混ぜない。通常・読込中・0件・取得失敗・予定を1440/1920で撮影し、横はみ出し0。固定件数なし。head `a828e5afc3`。',
    verdictSource: 'reminders-v6/GC4St.txt + reminders-v6/GC4St-{normal,loading,empty,error,planned}-{1440,1920}.png',
    verdictHead: 'a828e5afc3',
  },
  {
    /*
      **削除の窓は一覧の行から開く。** ボタンの読み上げ名は
      `<リマインダ名>を削除`（`reminders/page.tsx:548`）。
      #514 は #498 を含むので、積み順を守って #514 の head で撮る。
    */
    ...REMINDER, node: 'Y0Sn3', name: '7-1-I 削除確認',
    verdict: 'match',
    verdictNote: '**2026-09-06 S2 #220。** 正本 `Y0Sn3` と同じく対象名、消える予定、残る履歴、取消不可を示す画面内確認窓へ統一。一部失敗も窓を閉じず日本語で再操作できる。通常/失敗を1440/1920で撮影、横はみ出し0。PR #927 head `eb41ad0d` の実装を比較した。',
    verdictHead: 'eb41ad0d',
    route: '/reminders',
    mode: 'viewport', height: 1080,
    /* 撮れない理由: 一覧の選択チェックに aria-label が無く押せない。撮るには実装側に目印が要る */
    steps: [{ click: '未返信3日後フォローを削除' }],
    /* 失敗しても窓が閉じないか、文が画面の言葉かを見る。撮影用の口は405。 */
    /*
      **変種の手順は基本手順の続きとして足される**（`capture-screens.mjs` が
      `[...s.steps, ...variant.steps]` で繋ぐ）。ここで全選択と削除を
      もう一度書くと、**開いた確認窓の上から下のチェック欄を押すことになり**
      「見つかった数 0」で時間切れになる。続きだけを書く。
    */
    variants: [{ suffix: '-fail', steps: [{ click: '削除する' }, { wait: 1200 }] }],

  },
  {
    ...REMINDER, node: 'dC0yg', name: '7-1-J 一覧の状態（空・読込・エラー）',
    verdict: 'match',
    verdictNote: '**2026-09-06 S2 #220。** 正本 `dC0yg` の通常・読込・空・取得失敗を、同じ4KPI/フォルダ/絞り込み/6列表の骨格で実装。全状態を1440/1920で撮影し、横はみ出し0。PR #927 head `eb41ad0d` の実装を比較した。',
    verdictHead: 'eb41ad0d', route: '/reminders',
    states: { apis: ['**/api/reminders*', '**/api/reminders/**', '**/api/list-stats*', '**/api/folders*'], kinds: ['loading', 'empty', 'error'] },

  },

  // ── 機能8 自動応答 ──────────────────────────────────────
  /*
    設計は5段のウィザード（基本設定→どんなときに動くか→何を返すか→優先順位→確認）。
    #221 で5段と右サマリーを足した。各段の入力分割は次の修正点として残る。
  */
  { ...AUTO_REPLY, node: 'cmDfJ', name: '8-1 自動応答',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #375 / UI HEAD `06d05c170` で一致。** 一覧APIと全体競合集計APIへ接続し、ルール数・今月の応答・累計、アクション実行214回、要確認3件、フォルダ別件数と5行の実データを表示した。統合 #1132 の固定データを使って3101/8788で1440/1920px撮影し、同Node画像と横並びで4指標、案内帯、検索・並び順、フォルダ、6列表を比較。両幅とも横はみ出し0で、未接続の `—` は解消した。',
    verdictSource: 'auto-replies-v6/cmDfJ.png + docs/design-qa/auto-replies-v6/cmDfJ-{1440,1920}.png + cmDfJ.txt',
    verdictHead: '06d05c170', },
  {
    ...AUTO_REPLY, node: 'K7vg2', name: '8-1-A 自動応答ルール編集',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #375 / UI HEAD `06d05c170` で一致。** 下書き・公開版・テンプレート・競合集計APIへ接続し、自動応答名、フォルダ、優先順位、社内メモ、反応条件要約、ひな形3件、過去28日の応答214件、同時に当たるルール2件を実データで表示した。統合 #1132 の固定データを使って3101/8788で1440/1920px撮影し、同Node画像と横並び比較。両幅とも横はみ出し0で、社内メモと競合件数の未接続表示は解消した。',
    verdictSource: 'auto-replies-v6/K7vg2.png + docs/design-qa/auto-replies-v6/K7vg2-{1440,1920}.png + K7vg2.txt',
    verdictHead: '06d05c170',
    route: '/auto-replies/edit?id=ar-2&step=basic',

  },
  {
    ...AUTO_REPLY, node: 'nzWIX', name: '8-1-B 反応条件',
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-07 Issue #375 / UI HEAD `06d05c170` で構造一致・契約データ待ち。** 下書きと集計APIへ接続し、キーワード、一致方法、曜日・時間帯、友だち条件、28日間の一致214件、実測受信5,842件と種別内訳（テキスト5,740・画像76・スタンプ26）を表示した。統合 #1132 の固定データを使って3101/8788で1440/1920px撮影し、同Node画像と横並び比較、両幅とも横はみ出し0。現行契約は受信メッセージ種別の集計を返すが、設計の「受信元 LINE・メール」の保存値を返さないため、その1項目だけ作り物にせず未表示とした。',
    verdictSource: 'auto-replies-v6/nzWIX.png + docs/design-qa/auto-replies-v6/nzWIX-{1440,1920}.png + nzWIX.txt',
    verdictHead: '06d05c170',
    route: '/auto-replies/edit?id=ar-2&step=trigger',

  },
  {
    ...AUTO_REPLY, node: 'ivDoe', name: '8-1-C 応答とアクション',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #375 / UI HEAD `06d05c170` で一致。** 下書き・テンプレートAPIへ接続し、返し方、テンプレート選択、後続処理2件、返信待ち時間、連続返信5分、未一致時の担当者引き継ぎ、有効状態とLINEプレビューを実データで表示した。統合 #1132 の固定データを使って3101/8788で1440/1920px撮影し、同Node画像と横並び比較。両幅とも横はみ出し0で、返信遅延と未一致時動作の未接続表示は解消した。',
    verdictSource: 'auto-replies-v6/ivDoe.png + docs/design-qa/auto-replies-v6/ivDoe-{1440,1920}.png + ivDoe.txt',
    verdictHead: '06d05c170',
    route: '/auto-replies/edit?id=ar-2&step=response',

  },
  {
    ...AUTO_REPLY, node: 'U9hzqH', name: '8-1-D 競合と優先順位',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #292 / UI HEAD `1a0b0291e` で一致。** 下書き1件と競合2件を優先順位3段として表示し、勝者、停止/対象外、競合警告、一致後の動作、ループ防止、右の判定例・運用監視・LINEプレビュー、固定操作帯を設計順に配置した。通常・読込・空・失敗・権限不足を3106/8793で各1440/1920px撮影し、同Node画像と横並び比較、全12枚で横はみ出し0。競合2件の確認後だけテストへ進める既存の安全ゲートも維持。',
    verdictSource: 'auto-replies-v6/U9hzqH.png + docs/design-qa/auto-replies-v6/U9hzqH*.png + U9hzqH*.txt',
    verdictHead: '1a0b0291e',
    route: '/auto-replies/publish?id=ar-2', mode: 'page',
    /* 重なりの確認。最初に開く段 */
    /*
      通常・読込・空・失敗に加え、**権限不足**も撮る。本番のルールを
      書き換える手前なので、**権限が無いときにどう見えるか**まで見る。
    */
    states: {
      apis: ['**/api/auto-replies/*/draft*', '**/api/auto-replies/*/conflicts*'],
      kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'],
    },

  },
  {
    ...AUTO_REPLY, node: 'g46ja', name: '8-1-E 自動応答テスト',
    verdict: 'match',
    verdictNote: '**2026-09-06 #249 で一致。** 1920pxの設計画像と実装の1440・1920pxを横並びで確認。テスト入力、送信者選択、判定結果、設定要約、LINEプレビュー、中央の実行確認モーダルを設計どおり配置した。競合2件を確認してから実在する友だちでdry-runを実行する一連の操作に成功し、横はみ出し0。',
    verdictSource: 'auto-replies-v6/g46ja.txt + docs/design-qa/auto-replies-v6/g46ja.txt + apps/web/src/app/auto-replies/publish/page.tsx',
    verdictHead: '564c91d0fe',
    route: '/auto-replies/publish?id=ar-2', mode: 'page',
    /* 「確認したので次へ」で試す段へ */
    steps: [{ click: '「営業時間」への一律返信の重なりを確認した', role: 'checkbox', after: 250 }, { click: '予約の問い合わせの重なりを確認した', role: 'checkbox', after: 250 }, { qaOpen: 'g46ja', after: 700 }],

  },
  {
    ...AUTO_REPLY, node: 'Yj6CQ', name: '8-1-F 最終確認',
    verdict: 'match',
    verdictNote: '**2026-09-06 #249 で一致。** 1920pxの設計画像と実装の1440・1920pxを横並びで確認。有効化前チェック4項目、条件・時間・対象・返信・アクションの要約、28日一致数、競合確認数、LINEプレビュー、下部操作を設計どおり配置した。dry-run後に検証APIを通って到達し、横はみ出し0。未取得値は0件と誤表示しない。',
    verdictSource: 'auto-replies-v6/Yj6CQ.txt + docs/design-qa/auto-replies-v6/Yj6CQ.txt + apps/web/src/app/auto-replies/publish/page.tsx',
    verdictHead: '564c91d0fe',
    route: '/auto-replies/publish?id=ar-2', mode: 'page',
    /* 試してから最後の確認へ */
    steps: [{ click: '「営業時間」への一律返信の重なりを確認した', role: 'checkbox', after: 250 }, { click: '予約の問い合わせの重なりを確認した', role: 'checkbox', after: 250 }, { qaOpen: 'g46ja', after: 700 }, { qaOpen: 'g46ja-run', after: 900 }, { qaOpen: 'Yj6CQ', after: 900 }],

  },
  {
    ...AUTO_REPLY, node: 'e6iJG', name: '8-1-G 有効化完了',
    verdict: 'match',
    verdictNote: '**2026-09-06 #249 で一致。** 1920pxの設計画像と実装の1440・1920pxを横並びで確認。有効化完了、稼働中の設定要約、Slack監視案内、次の操作4件、監視項目、LINEプレビューを設計どおり配置した。冪等キー付き公開APIまで押し切って完了画面へ到達し、横はみ出し0。',
    verdictSource: 'auto-replies-v6/e6iJG.txt + docs/design-qa/auto-replies-v6/e6iJG.txt + apps/web/src/app/auto-replies/publish/page.tsx',
    verdictHead: '564c91d0fe',
    route: '/auto-replies/publish?id=ar-2', mode: 'page',
    /* 公開まで押し切る */
    steps: [{ click: '「営業時間」への一律返信の重なりを確認した', role: 'checkbox', after: 250 }, { click: '予約の問い合わせの重なりを確認した', role: 'checkbox', after: 250 }, { qaOpen: 'g46ja', after: 700 }, { qaOpen: 'g46ja-run', after: 900 }, { qaOpen: 'Yj6CQ', after: 900 }, { click: '自動応答を有効化', after: 1200 }],

  },
  {
    /*
      **PR #501（head `93edbe17`）で `/auto-replies/runs` が入った。**
      口は `GET /api/auto-reply-runs?rule_id=`。1本にそろっている。

      **見送りの行がいちばん大事。** 選んだルールが条件で見送られ、
      後ろのルールが動いても、この画面は「選んだルールは何もしなかった」
      と出す（`auto-reply-runs.ts` の `effectiveDomainStatus`）。
      固定データに2行入れてある。
    */
    ...AUTO_REPLY, node: 't7UtYQ', name: '8-1-H 実行結果',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #292 / 固定データ PR #1077（統合 #1080・head `447da7646`）で一致。** 今月214回・累計1,842回・引継ぎ36件・エラー3件、最近の実行4行、きっかけ別3行、稼働状況、実行エラー、担当者引継ぎを実APIと同じ応答型で表示した。通常・読込・空・失敗を3106/8793で各1440/1920px撮影し、同Node画像と横並び比較、全10枚で横はみ出し0。見送り・成功・確認待ち・エラーの違いも0件や未取得へ潰していない。',
    verdictSource: 'auto-replies-v6/t7UtYQ.png + docs/design-qa/auto-replies-v6/t7UtYQ*.png + t7UtYQ*.txt', verdictHead: '447da7646',
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
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #221 / PR #956 で一致。** `/auto-replies` の行から削除確認を開き、1440/1920pxで撮影（はみ出し0）。対象名、止まる自動返信と後続処理、残る過去履歴、元に戻せないこと、赤い削除操作を同Node画像と比較した。背面の一覧にも行副題を追加し、「準備中」は0件。取得元 `auto-replies-v6/Gy9OK.txt`。',
    verdictHead: '235d99f10',
    mode: 'viewport', height: 1080,
    steps: [{ click: '削除' }],

  },
  {
    ...AUTO_REPLY, node: 'q8wSqO', name: '8-1-J 一覧の状態（空・読込・エラー）',
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #221 / PR #956 で一致。** `/auto-replies` の通常・読込・空・取得失敗を割当ポート3104/8791で各1440/1920px撮影（はみ出し0）。4指標、絞り込み、フォルダ、6列表の骨格を全状態で維持し、空は0件、読めない数は `—`、失敗は再読込を表示。「準備中」と壊れ値は0件。取得元 `auto-replies-v6/q8wSqO*.txt` と同Node画像。',
    verdictHead: '235d99f10',
    /* **通常も撮る。** 内部の言葉は行の上に出るので、行が無い3状態だけでは見えない。 */
    states: { apis: ['**/api/auto-replies*', '**/api/auto-replies/**', '**/api/folders*'], kinds: ['normal', 'loading', 'empty', 'error'] },

  },

  // ── 機能9 友だち追加時の配信 ────────────────────────────
  { ...FRIEND_ADD, node: 'uLQQc', name: '9-1 友だち追加時の配信',
    states: { apis: ['**/api/friend-add-rules*'], kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'] },
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #374・UI HEAD `60bb0631c`・固定データ PR #1125（統合 #1128）で一致。** 新しいルール一覧APIの総件数・カーソル・フォルダを接続し、4指標、2タブ、流入の束、検索、6列表、実内容、ページ送りを実値で表示した。通常・読込・空・失敗・権限不足を3102/8789の1440/1920pxで撮影し、全12枚で横はみ出し0。フォルダ追加も専用APIと確認ダイアログへ接続済み。',
    verdictSource: 'friend-add-v6/uLQQc.png + uLQQc-{normal,loading,empty,error,forbidden}-{1440,1920}.png + Issue #374 visual/text comparison', verdictHead: '60bb0631c', },
  {
    ...FRIEND_ADD, node: 's9gAx', name: '9-1-A 基本設定', route: '/friend-add-settings?view=edit&id=rule-referral&step=basic',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #374・UI HEAD `60bb0631c`・固定データ PR #1125（統合 #1128）で一致。** 実APIから設定名、フォルダ、優先順位、判定する人、社内メモ、状態、直近7日、二重送信、配信内容、アクションを読み、5段、設定サマリー、LINEプレビュー、追従操作へ表示した。3102/8789の1440/1920pxで横はみ出し0。',
    verdictSource: 'friend-add-v6/s9gAx.txt + s9gAx-1920.png',
    verdictHead: '60bb0631c',
  },
  {
    ...FRIEND_ADD, node: 'W1wzCa', name: '9-1-B 流入条件', route: '/friend-add-settings?view=edit&id=rule-referral&step=routes',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #374・UI HEAD `60bb0631c`・固定データ PR #1125（統合 #1128）で一致。** 流入リンクの複数選択、曜日、時間帯、有効期間、友だち条件、優先判定を保存済みルールから表示し、競合集計APIの過去28日214人を判定サマリーへ接続した。3102/8789の1440/1920pxで横はみ出し0。',
    verdictSource: 'friend-add-v6/W1wzCa.txt + W1wzCa-1920.png',
    verdictHead: '60bb0631c',
  },
  {
    ...FRIEND_ADD, node: 'K0Dbr2', name: '9-1-C 初回案内', route: '/friend-add-settings?view=edit&id=rule-referral&step=message',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #374・UI HEAD `60bb0631c`・固定データ PR #1125（統合 #1128）で一致。** テキスト・テンプレート・回答フォーム・シナリオ、初回本文、後続シナリオ、送信時刻、24時間の再送制限、経路不明時の共通案内と担当者通知の接続状態を保存済みルールから表示した。設定サマリー、LINEプレビュー、追従操作を3102/8789の1440/1920pxで確認し、横はみ出し0。',
    verdictSource: 'friend-add-v6/K0Dbr2.txt + K0Dbr2-1920.png',
    verdictHead: '60bb0631c',
  },
  { ...FRIEND_ADD, node: 'txMO9', name: '9-1-D アクション追加', route: '/friend-add-settings?view=edit&id=rule-referral&step=actions&dialog=add', mode: 'viewport', height: 1080,
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #290・`de8b7c75b` を1440/1920pxでPencilと目視比較。** 5段表示、左右構成、実行する2アクション、設定サマリー、LINEプレビュー、600pxの中央ダイアログ、確認文と操作を一致させた。横はみ出し0。',
    verdictSource: 'friend-add-v6/txMO9.png + txMO9-1920.png + txMO9.txt', verdictHead: 'de8b7c75b', },
  {
    ...FRIEND_ADD, node: 'U3SI5', name: '9-1-E プレビューとテスト', route: '/friend-add-settings?view=edit&id=rule-referral&step=preview', mode: 'viewport', height: 1080,
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #290・`de8b7c75b` を1440/1920pxでPencilと目視比較。** 5段表示、送信先、短縮テスト、確認内容2行、設定サマリー、LINEプレビュー、追従操作を一致させた。テストは本番データを変えない説明も維持し、横はみ出し0。',
    verdictSource: 'friend-add-v6/U3SI5.png + U3SI5-1920.png + U3SI5.txt',
    verdictHead: 'de8b7c75b',
  },
  {
    ...FRIEND_ADD, node: 'ec9vg', name: '9-1-F 最終確認',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #374・UI HEAD `a0278d076`・固定データ PR #1130（統合 #1132）で一致。** 検証APIの合格結果、保存済みルールの設定名・流入条件・送信時刻・対象・初回案内・アクション・24時間制限、最後のテスト、対象214人、Slack監視の接続状態を表示した。Pencil画像と通常・読込・空・失敗・権限不足を3102/8789の1440/1920pxで目視比較し、全12枚で横はみ出し0。',
    verdictSource: 'friend-add-v6/ec9vg.png + ec9vg-{normal,loading,empty,error,forbidden}-{1440,1920}.png + ec9vg*.txt',
    verdictHead: 'a0278d076',
    route: '/friend-add-settings/publish',
    states: { apis: ['**/api/friend-add-rules*', '**/api/friend-add-rules/**'], kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'] },

  },
  {
    ...FRIEND_ADD, node: 'quhg6', name: '9-1-G 有効化完了',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #374・UI HEAD `a0278d076`・固定データ PR #1130（統合 #1132）で一致。** 公開APIの第1版・公開日時、保存済みルールの設定名・流入条件・対象・二重送信防止・対象214人・稼働状態を表示し、全STEP完了、次の操作、未送信・二重送信・再追加・シナリオ開始失敗の監視欄をPencil画像と目視比較した。3102/8789の1440/1920pxで2枚とも横はみ出し0。複製は機能9の契約外なので誤操作を避けて無効表示にしている。',
    verdictSource: 'friend-add-v6/quhg6.png + quhg6-{1440,1920}.png + quhg6.txt',
    verdictHead: 'a0278d076',
    route: '/friend-add-settings/publish',
    steps: [{ qaOpen: 'ec9vg', after: 900 }],

  },
  {
    ...FRIEND_ADD, node: 'P2J0Te', name: '9-1-H 実行結果',
    route: '/friend-add-settings/runs', mode: 'page',
    states: { apis: ['**/api/friend-add-runs*', '**/api/friend-add-runs/**'], kinds: ['normal', 'loading', 'empty', 'error'] },
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #374・UI HEAD `60bb0631c`・固定データ PR #1125（統合 #1128）で一致。** 新しい実行結果APIを接続し、直近28日214人、累計1,842通、シナリオ開始198件、エラー3件、平均0.8秒、使用ルール・版、実行アクション、CSV、絞り込み、一時停止を表示した。担当者引き継ぎはAPIが返す「結ぶ記録がない」を未取得理由として表示し、推測値を作っていない。通常・読込・空・失敗を3102/8789の1440/1920pxで撮影し、全10枚で横はみ出し0。',
    verdictSource: 'friend-add-v6/P2J0Te.txt + P2J0Te-{normal,loading,empty,error}-{1440,1920}.png',
    verdictHead: '60bb0631c',
  },
  {
    ...FRIEND_ADD, node: 'Q3qP1r', name: '9-1-I 削除確認',
    route: '/friend-add-settings?delete=rule-referral', mode: 'viewport', height: 1080,
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #290・`de8b7c75b` を1440/1920px撮影し、同Nodeの設計本文と文字照合。** 対象名、削除後の共通案内、履歴保持、取消不可、取消／削除操作、背面一覧のページ送りがそろい、横はみ出し0。',
    verdictSource: 'friend-add-v6/Q3qP1r.txt + Q3qP1r-1920.png',
    verdictHead: 'de8b7c75b',
  },

  // ── 機能10 ウェビナー ───────────────────────────────────
  /*
    設計の5段（基本設定→動画→CTA・フォーム→通知→確認）を、URLから
    直接同じ状態で開ける。作成・編集の保存口に無い値は作らず、
    固定データと実APIの接続条件を画面ごとの判定に残す。
  */
  { ...WEBINAR, node: 'ZC13r', name: '10-1 ウェビナー',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #324 / UI HEAD a55f719b9b / 一覧API PR #1071（統合 #1074）で再判定し一致。** 選択中のLINE公式アカウントを一覧とフォルダ集計の両APIへ渡し、4指標、フォルダ件数、5行の申込・視聴・公開状態・公開期間、検索・絞り込み、6列表、ページ送りを実値で表示した。通常・空・失敗・権限不足を3102/8789で1440/1920px撮影し、全10枚で横はみ出し0。',
    verdictSource: 'webinars-v6/ZC13r.png + ZC13r-1920.png + ZC13r*.txt',
    verdictHead: 'a55f719b9b',
    /*
      帯は `GET /api/webinars/overview` を読む。通常・0件・取得失敗・
      権限不足を混ぜないので、口を差し替えて1つずつ撮る。
    */
    states: {
      /*
        **口の当てはめは、画面が実際に呼ぶものに合わせる。**
        `/api/webinars/overview` は誰も呼んでいないので、差し替えが
        一度も当たらず、素の絵が `-empty` という名前で保存されていた。
        一覧が読むのは `/api/webinars`（`zCQXe` と同じ）。
      */
      apis: ['**/api/webinars?*', '**/api/webinars/overview?*'],
      kinds: ['normal', 'empty', 'error', 'forbidden'],
    }, },
  { ...WEBINAR, node: 'lvaY5', name: '10-1-A ウェビナーを作成',
    mode: 'viewport', height: 1080,
    steps: [{ fill: 'ウェビナー名', text: 'NEN活用スタートセミナー' }],
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-06 Issue #223 で再照合。** 構造一致・フォルダと開催形式の保存口待ち。設計画像と実装画像を同じ比較入力で見比べ、基本設定→動画→CTA・フォーム→通知→確認の5段、ウェビナー名、開催形式、設定サマリー、LINEプレビュー、テスト送信・公開ページ、下書き保存と次段への操作を確認した。現行APIにフォルダと開催形式の項目が無いため作り物を保存せず、下書き保存後に設定する旨を画面に明記した。1440・1920とも横スクロール0。取得元 `webinars-v6/lvaY5.txt` と同Node画像。',
    verdictHead: '98e104b7c', route: '/webinars/new', },
  {
    ...WEBINAR, node: 'PV1Vh', name: '10-1-B 動画・公開設定',
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-07 Issue #324 / UI HEAD a55f719b9b で再判定。** 一覧API PR #1071 の公開状態・公開期間を接続し、5段、動画名・再生時間、公開設定、設定サマリー、LINEプレビュー、固定操作帯を3102/8789の1440/1920pxで確認（横はみ出し0）。APIには設計の「視聴条件」を表す項目が無いため、そこだけ理由付きの構造一致・データ未接続。',
    verdictSource: 'webinars-v6/PV1Vh.png + PV1Vh-1920.png + PV1Vh.txt',
    verdictHead: 'a55f719b9b', route: `${WEBINAR_EDIT}&pane=video`,

  },
  {
    ...WEBINAR, node: 'd3rFGD', name: '10-1-C CTA・フォーム',
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-07 Issue #324 / UI HEAD a55f719b9b で再判定。** CTAの表示時刻・文言、申込フォーム、完了アクション、設定サマリー、LINEプレビューを3102/8789の1440/1920pxで確認（横はみ出し0）。一覧API PR #1071 はこの画面の回答フォーム入力項目と完了アクション詳細を返さないため、取得済み値だけで要約した理由付きの構造一致・データ未接続。',
    verdictSource: 'webinars-v6/d3rFGD.png + d3rFGD-1920.png + d3rFGD.txt',
    verdictHead: 'a55f719b9b', route: `${WEBINAR_EDIT}&pane=cta`,

  },
  {
    ...WEBINAR, node: 'Ho8z4', name: '10-1-D 通知・リマインド',
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-07 Issue #324 / UI HEAD a55f719b9b で再判定。** 通知設定APIの申込直後・前日・開始前・開始時・見逃し後、2カード、設定サマリー、LINEプレビュー、固定操作帯を3102/8789の2幅で確認（横はみ出し0）。通知本文とテスト送信結果を返すAPI契約は引き続き無いため、理由付きの構造一致・データ未接続。',
    verdictSource: 'webinars-v6/Ho8z4.png + Ho8z4-1920.png + Ho8z4.txt',
    verdictHead: 'a55f719b9b', route: `${WEBINAR_EDIT}&pane=notifications`,

  },
  {
    ...WEBINAR, node: 'Xjk8q', name: '10-1-E 視聴後アクション',
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-07 Issue #324 / UI HEAD a55f719b9b で再判定。** 完了メッセージ、実行時点、1回だけ、保存済み通知・アクション、結果未取得時の選択、設定サマリー、LINEプレビューを3102/8789の2幅で確認（横はみ出し0）。送信テンプレート本文と結果再取得方針の保存契約は一覧API PR #1071 に含まれないため、理由付きの構造一致・データ未接続。',
    verdictSource: 'webinars-v6/Xjk8q.png + Xjk8q-1920.png + Xjk8q.txt',
    verdictHead: 'a55f719b9b', route: `${WEBINAR_EDIT}&pane=actions`,

  },
  {
    ...WEBINAR, node: 'GB0NR', name: '10-1-F 公開ページプレビュー',
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-07 Issue #324 / UI HEAD a55f719b9b で再判定。** 一覧API PR #1071 の公開状態・公開期間と、公開ページ、表示内容、対象の設定サマリー、LINEプレビューを3102/8789の2幅で確認（横はみ出し0）。撮影アカウントのLIFF IDと申込フォーム詳細を返す口は無いため、理由付きの構造一致・データ未接続。',
    verdictSource: 'webinars-v6/GB0NR.png + GB0NR-1920.png + GB0NR.txt',
    verdictHead: 'a55f719b9b', route: `${WEBINAR_EDIT}&pane=preview`,
    mode: 'viewport', height: 1080,

  },
  {
    ...WEBINAR, node: 'D6yO7e', name: '10-1-G 公開前確認',
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-07 Issue #324 / UI HEAD a55f719b9b で再判定。** 一覧API PR #1071 の公開期間と、公開前4チェック、ウェビナー名・対象・CTA/フォーム・アクション、設定サマリー、LINEプレビューを3102/8789の2幅で確認（横はみ出し0）。公開ページ・通知テスト結果と通知重複の検査APIは未提供のため、その項目を明示した理由付きの構造一致・データ未接続。',
    verdictSource: 'webinars-v6/D6yO7e.png + D6yO7e-1920.png + D6yO7e.txt',
    verdictHead: 'a55f719b9b',
    route: '/webinars/edit?id=webinar-1&pane=review', mode: 'page',

  },
  {
    /*
      **`/webinars/published?id=` で開く。** 公開の口が実際に返したIDだけを
      渡す作りで（`webinar-form.tsx` の `updated.data.id`）、
      `status !== 'active'` のときは完了として出さない。
    */
    ...WEBINAR, node: 'TimXl', name: '10-1-H 公開完了',
    route: '/webinars/published?id=webinar-1', mode: 'page',
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-07 Issue #324 / UI HEAD a55f719b9b で再判定。** 一覧API PR #1071 の公開状態・公開期間と、5段完了、公開結果、設定要約、運用者通知、参加状況、次にできること、監視中を3102/8789の2幅で確認（横はみ出し0）。停止・通知テスト・複製・監視結果とLIFF IDの契約は未提供のため、理由付きの構造一致・データ未接続。',
    verdictSource: 'webinars-v6/TimXl.txt',
    verdictHead: 'a55f719b9b',
  },
  {
    ...WEBINAR, node: 'Q8sHa', name: '10-1-I 参加者管理',
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-07 Issue #324 / UI HEAD a55f719b9b で再判定。** 分析APIの4人、4指標、参加者ごとの視聴・実行結果・状態・時刻、参加状況内訳、稼働状況、要分析、担当者視聴完了を3102/8789の2幅で確認（横はみ出し0）。担当者連携状態と実行エラー詳細を返す契約は一覧API PR #1071 に含まれないため、理由付きの構造一致・データ未接続。',
    verdictSource: 'webinars-v6/Q8sHa.png + Q8sHa-1920.png + Q8sHa.txt',
    verdictHead: 'a55f719b9b', route: `${WEBINAR_EDIT}&pane=participants`, mode: 'viewport', height: 1080,

  },
  {
    ...WEBINAR, node: 'yxyzQ', name: '10-1-J 分析',
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-07 Issue #324 / UI HEAD a55f719b9b で再判定。** 申込・再生・完了・CTAの実値、概要・視聴・離脱・CTA・申込、視聴結果、視聴行動、設定サマリー、LINEプレビュー、CSVを3102/8789の2幅で確認（横はみ出し0）。分析APIの視聴区間配列が空で、最大離脱と最も視聴された区間を出せないため、理由付きの構造一致・データ未接続。',
    verdictSource: 'webinars-v6/yxyzQ.png + yxyzQ-1920.png + yxyzQ.txt',
    verdictHead: 'a55f719b9b', route: `${WEBINAR_EDIT}&pane=analytics`, mode: 'viewport', height: 1080,

  },
  {
    ...WEBINAR, node: 'LKuAQ', name: '10-1-K アーカイブ確認',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #289 / UI HEAD a571acc25 / 固定データ PR #1060（統合 #1067）で最終一致。** 設計画像なしのため正本 `LKuAQ.txt` と文字・構造照合。旧機能説明会、申込85人、視聴99人、公開URL無効化、履歴保持、復元、設定サマリー、LINEプレビュー、取消・実行を表示した。3102/8789の1440/1920pxで横はみ出し0。',
    verdictSource: 'webinars-v6/LKuAQ.txt + LKuAQ-1920.png',
    verdictHead: 'a325ab485',
    route: '/webinars', mode: 'viewport', height: 1080,
    steps: [{ click: 'アーカイブ', nth: 4 }],
  },
  {
    ...WEBINAR, node: 'zCQXe', name: '10-1-L 一覧の状態（空・読込・エラー）',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #324 / UI HEAD a55f719b9b / 一覧API PR #1071（統合 #1074）で再判定し一致。** 通常・読込中・0件・取得失敗を同じKPI・フォルダ・一覧枠で分け、取得失敗を0件と混同しない。選択中のLINE公式アカウントに絞った一覧・フォルダ集計の実APIを接続し、3102/8789の1440/1920px全8枚で横はみ出し0。',
    verdictSource: 'webinars-v6/zCQXe.png + zCQXe-1920.png + zCQXe*.txt',
    verdictHead: 'a55f719b9b',
    states: { apis: ['**/api/webinars?*', '**/api/webinars/overview?*'], kinds: ['loading', 'empty', 'error'] },

  },

  // ── 機能11 テンプレート ─────────────────────────────────
  /*
    設計のタブは6本（メッセージ／カルーセル／リッチメッセージ／質問／
    クーポン／リサーチ）。実装は5本で、**「質問」だけが無い。**
  */
  { ...TEMPLATE, node: 'W7LBc', name: '11-1 テンプレート', mode: 'viewport', height: 1080,
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #224 / PR #1024 / UI HEAD 031081d69 で一致。** `/templates` を割当ポート3104/8791で通常・読込・空・失敗・2フォルダの各1440/1920pxを再撮影し、Pencil正本と実装1920pxを同じ比較画像で目視確認した。6種類タブ、フォルダ、検索、保存した検索、5つの絞り込み、設計と同じ6列表に加え、実送信台帳からテスト送信を除いた今月の送信数を接続した。累計は同じ値を水増しせずツールチップで確認できる。全14枚で横はみ出し0。',
    verdictSource: 'templates-v6/W7LBc.txt + W7LBc-1440.png + W7LBc-1920.png',
    verdictHead: '031081d69', /*
      **#493 の受入条件5つを1回で撮る。**
      口はフォルダだけ差し替える——**テンプレートの一覧は正常のまま**にして、
      「フォルダが取れなくても一覧は残る」を確かめるため。
    */
    states: {
      apis: ['**/api/folders?**', '**/api/folders'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
    /* フォルダを押したとき、その `folderId` のものだけが出るかを見る。 */
    variants: [
      { suffix: '-folder-inquiry', steps: [{ click: 'お問い合わせ' }] },
      { suffix: '-folder-unfiled', steps: [{ click: '未分類' }] },
    ], },
  {
    ...TEMPLATE, node: 'GFlD7', name: '11-1-A メッセージを作る',
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #224 / PR #944 で一致。** `/templates/edit?visual=1` を1440/1920pxで撮影（はみ出し0）。テンプレート名・フォルダ・種類・差し込み・本文、差し込み後のLINEプレビュー、URLの扱い3列をPencilと目視比較した。`Flex` と `内容 / JSON` は画面から除き、4,500文字超過時の分割も明記した。取得元 `templates-v6/GFlD7.txt` と同Nodeの実装画像。',
    verdictHead: '98abf756a',
    route: '/templates/edit?visual=1', mode: 'page',

  },
  {
    ...TEMPLATE, node: 'FRkls', name: '11-1-B カルーセルを作る',
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #224 / PR #944 で一致。** `/templates/carousel?visual=1` を1440/1920pxで撮影（はみ出し0）。「パネル」表記、5/10枚、推奨1024×678px、最大3つの選択肢、パネル2編集、横スクロールするLINEプレビューをPencilと目視比較した。取得元 `templates-v6/FRkls.txt` と同Nodeの実装画像。',
    verdictHead: '98abf756a',
    route: '/templates/carousel?visual=1', mode: 'viewport', height: 1080,

  },
  {
    /*
      **#572 で「質問」ができた。** ルートは `/templates/questions/new`。
      `?id=` が無いので読み込みは走らず、通常状態がそのまま出る。
      **使用先は 0 と言わず「保存後にシナリオから選べます」**（`:214`）。
    */
    ...TEMPLATE, node: 'NNDMR', name: '11-1-C 質問を作る',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #224 / PR #1024 / UI HEAD 031081d69 で一致。** `/templates/questions/new` を割当ポート3104/8791で1440/1920px再撮影し、Pencil正本と実装1920pxを同じ比較画像で目視確認した。#275 / PR #1014 の共通質問編集修正により、タグ・友だち情報・シナリオの詳しい設定は閉じた選択UIになり、質問文、2選択肢、各返信、右のLINEプレビューを同じ画面で確認できる。両幅とも横はみ出し0。',
    verdictSource: 'templates-v6/NNDMR.txt + NNDMR-1440.png + NNDMR-1920.png',
    verdictHead: '031081d69',
    route: '/templates/questions/new', mode: 'page',

  },
  {
    ...TEMPLATE, node: 'j9ixI', name: '11-1-D リッチメッセージを作る',
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #224 / PR #944 で一致。** リッチメッセージ作成を1440/1920pxで撮影（はみ出し0）。A〜Fの6分割候補、上1・下2の選択、1040×1040/520px案内、面別アクション、未設定警告、LINEプレビュー、リッチメニューとの差をPencilと目視比較した。取得元 `templates-v6/j9ixI.txt` と同Nodeの実装画像。',
    verdictHead: '98abf756a',
    route: '/templates/edit?kind=rich_message&visual=1', mode: 'page',

  },
  {
    ...TEMPLATE, node: 'hsBtl', name: '11-1-E クーポンを作る',
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #224 / PR #944 で一致。** クーポン作成を1440/1920pxで撮影（はみ出し0）。期間・回数・公開対象・抽選率・上限、利用時のタグ/マイル/対応マーク、LINEプレビュー、公開後の数と成果への接続をPencilと目視比較した。取得元 `templates-v6/hsBtl.txt` と同Nodeの実装画像。',
    verdictHead: '98abf756a',
    route: '/templates/edit?kind=coupon&visual=1', mode: 'page',

  },
  {
    ...TEMPLATE, node: 'J3GxEZ', name: '11-1-F リサーチを作る',
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #224 / PR #944 で一致。** リサーチ作成を1440/1920pxで撮影（はみ出し0）。受付期間・対象、3問、質問1の3選択肢、回答後のお礼/タグ/マイル、LINEプレビュー、回答フォームとの使い分けをPencilと目視比較した。取得元 `templates-v6/J3GxEZ.txt` と同Nodeの実装画像。',
    verdictHead: '98abf756a',
    route: '/templates/edit?kind=research&visual=1', mode: 'page',

  },
  {
    /*
      **#433（head `51020a97`）で窓が入った。** それまでは削除がブラウザの
      `confirm()` で、撮ることもできなかった。実装側に
      `data-design-node="M9cij"` の印が付いている（`templates/page.tsx:831`）。
      使用数3件の行から「使用先を見る」を押し、削除不可と差し替え導線を開く。
    */
    ...TEMPLATE, node: 'M9cij', name: '11-1-G テンプレートの削除確認',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #426 / PR #1208 / UI HEAD 68d536652 で一致。** PR #1197で修正されたPencil正本に合わせ、使用中3か所の削除を止め、シナリオ・自動応答・受信箱の使用先と差し替え導線を表示した。3102/8789で1440/1920pxを再撮影し、警告、3件の使用先、差し替え案内、取消不能の注記、2つの操作を同Nodeの設計画像と目視比較した。両幅とも横はみ出し0。未使用テンプレートだけは従来どおり削除確認から削除できる。',
    verdictSource: 'templates-v6/M9cij.txt + M9cij-1440.png + M9cij-1920.png',
    verdictHead: '68d536652',
    mode: 'viewport', height: 1080,
    steps: [{ click: '使用先を見る', scope: 'main', nth: 9 }],
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
      何も比べていない。表示文言に依存しない `data-qa-open` で開く。
    */
    ...TEMPLATE, node: 'CzndJ', name: '11-1-H フォルダ操作',
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #252 / UI HEAD `3fd0d57a9` で一致。** 版の外にある正本PNGと実装を同じ1920×1080・メニュー展開状態で横に並べ、フォルダ操作の文字・順序・余白・色・枠・角丸・影を確認した。`/templates` は `/api/folders?kind=template` の実データを読み、撮影用の実Node入口 `CzndJ` から真ん中のフォルダを開くため、名前を変更／色を変える／並び順を上へ／並び順を下へ／フォルダを削除と「削除しても、中のテンプレートは未分類に残ります。」が1枚にそろう。1440・1920とも横はみ出し0。周辺の名称・件数は撮影用固定データをそのまま表示し、設計見本の数値を作っていない。通常・読込・空・失敗・権限不足は `NKyoA` と画面契約テスト、フォルダ更新権限はWorker契約テストで確認済み。P0/P1/P2なし。P3として正本にある各項目の左アイコンは共通部品側の差として残す（s0範囲）。',
    verdictSource: 'templates-v6/CzndJ.txt + templates-v6/CzndJ-1920.png + template-folder-contract.test.ts + templates-folder.test.ts',
    verdictHead: '3fd0d57a9',
    mode: 'viewport', height: 1080,
    steps: [{ qaOpen: 'CzndJ' }],
  },
  {
    ...TEMPLATE, node: 'NKyoA', name: '11-1-I 一覧の状態（空・読込・エラー）', mode: 'viewport', height: 1080,
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #224 / PR #944 で一致。** 一覧の通常・読込・空・取得失敗を各1440/1920pxで撮影（はみ出し0）。6種類の件数、フォルダ件数、空状態の作成案内、読込案内、失敗時の再読込を同じ一覧枠でPencilと目視比較した。内部値 `text` と `undefined件で使用` は0件。取得元 `templates-v6/NKyoA.txt` と同Nodeの状態別実装画像。',
    verdictHead: '98abf756a',
    states: { apis: ['**/api/templates*', '**/api/templates/**', '**/api/broadcast-message-assets*'], kinds: ['loading', 'empty', 'error'] },

  },

  // ── 機能12 リッチメニュー ───────────────────────────────
  /*
    設計は3段（形とボタン→誰に出すか→公開のしかた）。実装は1枚もの。
    段は無いが**中身は同じ画面に全部ある**ので、同じ絵を3つの設計と
    突き合わせる形にする。
  */
  { ...RICH_MENU, node: 'GO8RQ', name: '12-1 リッチメニュー',
    mode: 'viewport', height: 1080,
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #430 / #1194 の固定応答で再判定。** `/api/rich-menu-groups` から今月のタップ3,210回・のべ8,140人を表示し、フォルダ、作成・並べ替え・検索、保存検索、優先順位、一覧6列と操作を設計どおり確認した。1440・1920の実装画像で横スクロールはなく、集計値を未取得扱いしていない。",
    verdictHead: "49484d5ab",
  },
  { ...RICH_MENU, node: 'XtfO3', name: '12-1-A メニューを作る・形とボタン',
    mode: 'viewport', height: 1200, route: '/rich-menus/edit?id=rmg-1',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #430 / #1194 の固定応答で再判定。** `/api/rich-menu-groups/rmg-1` と画像取得口から保存済み名称・フォルダ・画像・面A〜Fを読み、14字制限、7レイアウト、切替タブ、LINEプレビュー、入力例を確認した。1440・1920とも横スクロールはなく、下書き編集を実データで表示している。",
    verdictHead: "49484d5ab",
  },
  { ...RICH_MENU, node: 'kQ1bs', name: '12-1-B メニューを作る・誰に出すか', route: '/rich-menus/edit?id=rmg-1&step=targeting', mode: 'viewport', height: 1080,
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #422 / HEAD e98decafa で1440・1920pxを再撮影。** 横はみ出し0。STEP 2、条件、対象人数、優先順位、標準15軸・追加6軸、保存導線を確認した。重複人数と実配布人数は固定入力不足のため構造一致・データ待ち。",
    verdictSource: "rich-menus-v6/kQ1bs.txt",
    verdictHead: "e98decafa",
  },
  {
    /*
      **#509 で `/rich-menus/connections?id=` が入った。**
      既存の pages / areas から切替のつながりを解析する。
      `NXdDk` は同じ画面の「つながりが無い」状態。
    */
    ...RICH_MENU, node: 'DIUbO', name: '12-1-C 切替メニューのつながり',
    verdict: 'match',
    verdictNote: '**2026-09-06 #253 で再照合。** 一致。設計画像と実装画像を同じ比較入力で見比べ、切替元・切替先を図と表で確認できる構成、トップへ戻るタブが無い警告、LINEプレビュー、固定の保存操作を確認した。グループ詳細の実データから線と戻り道を計算している。1440・1920とも横スクロール0。取得元 `rich-menus-v6/DIUbO.txt` と同Node画像。',
    verdictHead: '89166aa03',
    route: '/rich-menus/connections?id=rmg-1', mode: 'viewport', height: 1080,

  },
  {
    ...RICH_MENU, node: 'NXdDk', name: '12-1-C-A つながりなし',
    verdict: 'match',
    verdictNote: '**2026-09-06 #253 で再照合。** 一致。設計画像と実装画像を同じ比較入力で見比べ、つながりが無い理由、切替先を追加する次の操作、LINEプレビューを確認した。通常・読込中・0件・取得失敗の4状態を1440・1920で撮影し、取得失敗を0件として扱っていない。全画像で横スクロール0。取得元 `rich-menus-v6/NXdDk*.txt` と同Node画像。',
    verdictHead: '89166aa03',
    route: '/rich-menus/connections?id=rmg-2', mode: 'viewport', height: 1080,
    /*
      **通常・空・失敗を本文まで取る。**読む口は `api.richMenuGroups.get(groupId)`
      （`connections/page.tsx:41`）ひとつだけ。
    */
    states: { apis: ['**/api/rich-menu-groups/*', '**/api/rich-menu-groups/**'], kinds: ['normal', 'loading', 'empty', 'error'] },

  },
  { ...RICH_MENU, node: 'UMiJ9', name: '12-1-D メニューを作る・公開のしかた', route: '/rich-menus/edit?id=rmg-1&step=publish', mode: 'viewport', height: 1080,
    steps: [
      { click: '期間を決める', role: 'radio' },
      { fill: '出しはじめ', text: '2026-08-25T10:00' },
      { fill: '出しおわり', text: '2026-09-30T23:59' },
    ],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #430 / #1194 の固定応答で再判定。** グループ詳細の画像キー、公開日時・期間・終了後の戻し先、対象要約を読み、STEP 3とLINEプレビューを確認した。面Fが未設定の固定データは画面の警告として明示し、存在しない画像を補っていない。1440・1920とも横スクロールはない。",
    verdictHead: "49484d5ab",
  },
  { ...RICH_MENU, node: 'TL7tp', name: '12-1-E 管理画面の外のメニューを取り込む',
    mode: 'viewport', height: 1080,
    steps: [{ qaOpen: 'TL7tp' }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #430 / #1194 の固定応答で再判定。** 管理外メニューのA〜FのURL・メッセージ・postbackと現在の面を読み、6面プレビュー、取り込み後の操作、表示を変えない説明、削除注意を確認した。対象8,140人も表示され、1440・1920とも横スクロールはない。",
    verdictHead: "49484d5ab",
  },
  {
    /*
      **#575 で `ConfirmDialog` につながった。**管理画面のメニューと、
      LINE上の管理外メニューは**別の窓**（`kind: 'managed' | 'external'`）。
      両方を撮る。取り込みの標準 `confirm` は削除ではないので、この行では見ない。
    */
    ...RICH_MENU, node: 'szXsT', name: '12-1-F リッチメニューの削除確認',
    route: '/rich-menus', mode: 'viewport', height: 1080,
    steps: [{ click: '削除', nth: 0 }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #430 / #1194 の固定応答で再判定。** 削除影響APIから公開中メニューの影響、現在の割当8,140人、次に出る候補、切替元、配信・自動処理の参照を表示し、公開中は取り下げ後に削除する安全導線を確認した。1440・1920とも横スクロールはない。",
    verdictHead: "49484d5ab",
  },
  {
    ...RICH_MENU, node: 'RW5Tb', name: '12-1-G 一覧の状態（空・読込・エラー）',
    mode: 'viewport', height: 1080,
    verdict: 'match',
    verdictNote: '**2026-09-06 #225 で再照合。** 一致。設計画像と実装画像を同じ比較入力で見比べ、共通の操作列・優先順位の説明・保存した検索・フォルダを残したまま、読込中「読み込んでいます」、0件「まだリッチメニューがありません」、失敗「表示できませんでした」を別状態で確認した。未取得の集計帯は表示せず、実値0と取得失敗を混ぜていない。通常・読込中・0件・取得失敗を1440・1920で撮影し、全画像で横スクロール0。取得元 `rich-menus-v6/RW5Tb*.txt` と同Node画像。',
    verdictHead: 'f2be359e5',
    states: { apis: ['**/api/rich-menu-groups*', '**/api/rich-menu-groups/**', '**/api/folders*'], kinds: ['normal', 'loading', 'empty', 'error'] },

  },

  // ── 機能13 回答フォーム ─────────────────────────────────
  /*
    設計は一覧・編集（3つのタブ）・集まった回答の3つ。実装は一覧と回答が
    同じ画面で、編集は別ルート。**「デザイン設定」は押せない状態で置いてある**
    （見た目をアプリにそろえる方針にしたため、と画面に書いてある）。
  */
  { ...FORM, node: 'EMBIK', name: '13-1 回答フォーム', /*
      **#586 の受入条件。**通常・読込・空・失敗を言い分けられるかを見る。
      読む口はフォームの一覧と帯。
    */
    states: {
      apis: ['**/api/forms*', '**/api/forms/**', '**/api/form-submissions*'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #368 / PR #1134で実API接続後に再判定。** 3104/8791で1440px・1920pxを撮影し、全画像で横はみ出し0。Pencil 1920pxと実装1920pxを目視比較した。構造一致・一覧契約待ち。固定データから6フォームを読み、検索、公開状態、回答数、更新日、回答・編集・削除の操作を表示した。現行の実APIはフォームのフォルダ所属、全件数、今週回答数、保存先の内訳を一覧応答で返さないため、設計の18件・フォルダ別件数・週次値・保存先内訳を作らず保留した。通常・読込中・0件・取得失敗も同じ一覧骨格で確認した。",
    verdictSource: "forms-v6/EMBIK.txt + forms-v6/EMBIK-{1440,1920}.png + forms-v6/EMBIK-{normal,loading,empty,error}-{1440,1920}.png",
  },
  { ...FORM, node: 'vCqUj', name: '13-1-A フォームを作る', route: `${FORM_EDIT}&tab=basic`,
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #368 / PR #1134で実API接続後に再判定。** 3104/8791で1440px・1920pxを撮影し、全画像で横はみ出し0。Pencil 1920pxと実装1920pxを目視比較した。一致。固定フォーム定義から、共通ヘッダを含む9ブロック、質問ごとの入力種別・選択肢・保存先、顧客プレビュー、公開状態、回答URL、回答数、保存操作を表示した。値は運用データで変わるが、配置・項目・操作は一致する。",
    verdictSource: "forms-v6/vCqUj.txt + forms-v6/vCqUj-{1440,1920}.png",
  },
  {
    ...FORM, node: 'ava2n', name: '13-1-B フォームのデザイン設定',
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #254 / UI HEAD 19422a3b7で1440px・1920pxを撮影し、横はみ出し0を確認。** 5色の役割・書体・角丸・背景画像・SNS表示をフォーム定義へ保存し、左のプレビューとLINE回答画面へ反映した。本文は設計テキストと照合したが、**設計画像なし**のため画像一致は判定できず `unjudged` を維持する。',
    verdictSource: 'forms-v6/ava2n.txt + ava2n-{1440,1920}.png',
    verdictHead: '520c251a951d', verdictNote: '**2026-09-07 Issue #435。** 固定ポート3107/8794でデザイン設定を1440/1920px確認。横はみ出し0。',
    route: `${FORM_EDIT}&tab=design`,
  },
  {
    ...FORM, node: 'cSqvP', name: '13-1-C フォームのオプション設定', route: `${FORM_EDIT}&tab=options`,
    mode: 'viewport', height: 1080,
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #368 / PR #1134で実API接続後に再判定。** 3104/8791で1440px・1920pxを撮影し、全画像で横はみ出し0。Pencil 1920pxと実装1920pxを目視比較した。一致。固定フォーム定義から回答後の3動作、お礼ページ、前回答の復元、ページ名、ボタン文言、見出し、送信前確認、受付期限、1人1回を読み、保存APIへつながるオプション画面を確認した。値は運用データで変わるが、配置・項目・操作は一致する。",
    verdictSource: "forms-v6/cSqvP.txt + forms-v6/cSqvP-{1440,1920}.png",
  },
  { ...FORM, node: 'v9tYhl', name: '13-1-D 集まった回答',
    route: '/form-submissions/responses?id=form-1',
    states: {
      apis: ['**/api/forms/form-1', '**/api/forms/form-1/submissions*'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #368 / PR #1134で実API接続後に再判定。** 3104/8791で1440px・1920pxを撮影し、全画像で横はみ出し0。Pencil 1920pxと実装1920pxを目視比較した。構造一致・撮影用回答データ待ち。実画面はページ分け回答APIのsummaryから、本人確認済み開始数に対する回答率、情報欄へ書けた件数と失敗数、次回来店日の重複を除いた人数を表示し、各回答にも書き込み成否を出すよう接続した。撮影用mockはフォーム定義だけで回答とsummaryを返さないため、0件の通常状態で未取得理由を表示し、設計の6行と実集計値は作らず保留した。通常・読込中・0件・取得失敗を確認した。",
    verdictSource: "forms-v6/v9tYhl.txt + forms-v6/v9tYhl-{1440,1920}.png + forms-v6/v9tYhl-{normal,loading,empty,error}-{1440,1920}.png",
  },
  {
    ...FORM, node: 'gBp2J', name: '13-1-E フォームの削除確認',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #435。** 本流の設計PNG（#1197）と固定ポート3107/8794の実装を1440・1920pxで照合。公開状態、回答数、利用先、URL影響、受付停止・アーカイブ・削除の分岐を確認し、横はみ出し0。',
    verdictSource: 'forms-v6/gBp2J.txt + docs/design-reference/forms-v6/gBp2J-{1440,1920}.png + forms-v6/gBp2J-{1440,1920}.png',
    verdictHead: '520c251a951d',
    steps: [{ click: '来店アンケートを削除' }],
  },
  {
    ...FORM, node: 'ZOPyc', name: '13-1-F 一覧の状態（空・読込・エラー）',
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #226 / PR #1003 / UI HEAD 79257c7bd で一致。** 設計画像と実装画像を同じ比較入力で見比べ、上部操作、フォルダ、検索・絞り込みを保ったまま、読込・空・取得失敗を同じ一覧枠で表示することを確認した。空状態の2つの案内文、作成ボタン、失敗時の再読込も設計文言へ合わせた。通常・読込・空・失敗を1440・1920で撮影し、全画像で横はみ出し0。取得元 `forms-v6/ZOPyc*.txt` と同Nodeの状態別実装画像。',
    verdictHead: '79257c7bd',
    states: { apis: ['**/api/forms*', '**/api/forms/**'], kinds: ['loading', 'empty', 'error'] },

  },

  // ── 機能14 共通情報 ─────────────────────────────────────
  {
    ...COMMON_VAR, node: 'WuKzU', name: '14-1 共通情報', verdict: 'match',
    verdictNote: '**2026-09-07 Issue #385 / UI HEAD `bc92f54ea`で再判定し、一致。** PR #1131の実APIとPR #1142の固定データを使い、3フォルダ、先頭6件、空のまま使用中1件、行ごとの使用数、更新予約を表示した。上部操作、フォルダ、検索・4絞り込み、6列一覧、ページ送りをPencil 1920pxと実装1920pxで目視比較した。3104/8791で1440px・1920pxを撮り、両方とも横はみ出し0。',
    verdictSource: 'common-vars-v6/WuKzU.txt + common-vars-v6/WuKzU-1440.png + common-vars-v6/WuKzU-1920.png + common-vars-v6-contract.test.ts', verdictHead: 'bc92f54ea',
  },
  {
    ...COMMON_VAR, node: 'gBtaK', name: '14-1-A 共通情報を編集', route: '/contents/vars/edit?id=common-var-delete-target', verdict: 'structure_match_data_pending',
    mode: 'viewport', height: 1080,
    steps: [
      { fill: '#cv-value', selector: true, text: '株式会社NEN ホールディングス' },
      { wait: 1200 },
    ],
    verdictNote: '**2026-09-07 Issue #385 / UI HEAD `bc92f54ea`で再判定。構造一致・担当者名データ待ち。** PR #1131の実APIとPR #1142の固定データへ接続し、社内メモ、変更理由、版番号つき保存、追記型の変更履歴、15使用先、変更前後の文、予約中・公開中・下書き、文字数超過、保存後プレビューを確認した。履歴APIは内部の担当者IDだけを返すため画面へ露出せず「担当者記録あり」と表示する。担当者の表示名が契約に無い一点だけ設計どおりに出せないため一致にはしない。3104/8791で1440px・1920pxを撮り、両方とも横はみ出し0。**残り：履歴APIが担当者の表示名を返す。**',
    verdictSource: 'common-vars-v6/gBtaK.txt + common-vars-v6/gBtaK-1440.png + common-vars-v6/gBtaK-1920.png + api.test.ts + change-impact.test.ts', verdictHead: 'bc92f54ea',
  },
  {
    /*
      **#548 で「変える前に影響を見る」が入った。**
      編集画面（`/contents/vars/edit?id=`）の中に、影響の一覧が出る。
      文字数の上限は口が無いので `—` と理由が出る。
    */
    ...COMMON_VAR, node: 'uNBlA', name: '14-1-B 変える前に影響を見る',
    route: '/contents/vars/edit?id=common-var-delete-target', mode: 'page',
    /*
      **値を変えるだけで出る。** #854 から、値が保存済みと違えば
      変更前確認を引き直す（400ms 待ってから）。

      **「保存」は押さない。** 押すと保存が走ってしまい、撮りたいのは
      「保存する前に何が見えるか」なので、押した先の絵は別のものになる。
      `id` は固定データにある `common-var-delete-target`——`cv-1` は無く、
      指定しても一覧の1件目に落ちるだけで、狙った行を撮れない。
    */
    steps: [
      { fill: '#cv-value', selector: true, text: '株式会社NEN ホールディングス' },
      { wait: 1200 },
      { qaOpen: 'uNBlA', after: 900 },
    ],
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #385 / UI HEAD `bc92f54ea`で再判定し、一致。** PR #1131の影響確認APIとPR #1142の固定データへ接続し、15か所、すぐ効く4件、文字数超過1件、送信済みは変わらない表示、6列の変更前後表、CSV出力、6件ごとのページ送り、保存停止を確認した。「株式会社NEN」から「株式会社NEN ホールディングス」へ変える同じ入力でPencilと目視比較した。3104/8791で1440px・1920pxを撮り、両方とも横はみ出し0。',
    verdictSource: 'common-vars-v6/uNBlA-1920.png + common-vars-v6/uNBlA.txt + change-impact.test.ts + impact-review.test.ts',
    verdictHead: 'bc92f54ea',
  },
  {
    ...COMMON_VAR, node: 'yPkWe', name: '14-1-C 共通情報の削除確認',
    mode: 'viewport', height: 1080,
    steps: [{ qaOpen: 'yPkWe', after: 900 }],
    variants: [
      /*
        消せるもの（どこにも差し込まれていない2件目）。

        **先に窓を閉じる。** `steps` と `variant.steps` はつながって走るので、
        1件目の削除の窓が開いたまま2件目の「削除」を押すことになり、
        重なりに遮られて15秒で時間切れになっていた（見つかった数3・押せず）。
      */
      { suffix: '-deletable', steps: [{ click: 'キャンセル', after: 500 }, { click: '削除', nth: 1, after: 900 }] },
    ],
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #385 / UI HEAD `bc92f54ea`で再判定し、一致。** PR #1131の削除影響・互換候補・差し替え影響・一括差し替えAPIと、PR #1142の固定データへ接続した。会社名が使われる15か所、予約中・公開中・下書きの6使用先、各画面を開く導線、互換候補の選択、差し替え後の15件、版競合時の再読込を確認した。使用中は安全な差し替え後削除だけ実行でき、未使用は確認入力後に削除できる。両状態を3104/8791で1440px・1920px撮影し、全画像で横はみ出し0。',
    verdictSource: 'common-vars-v6/yPkWe.txt + common-vars-v6/yPkWe-{1440,1920}.png + common-vars-v6/yPkWe-deletable-{1440,1920}.png + api.test.ts + delete-screen-contract.test.ts',
    verdictHead: 'bc92f54ea',

  },

  // ── 機能15 登録メディア ─────────────────────────────────
  { ...MEDIA, node: 'g89Tc', name: '15-1 登録メディア',
    verdict: "match",
    verdictNote: "**2026-09-07、Issue #392 / PR #1157 / HEAD `0cc67ed91d` を固定ポート web 3105・mock 8792 で1440px・1920px再撮影し、一致。** 2幅とも横はみ出し0。容量APIの実値から2.4GB / 10GB・残り7.6GB・24%帯を表示し、「上限に近い」もファイル種別ごとのLINE上限80%以上だけを絞る。3フォルダ＋未分類、検索、6つの絞り込み、格子/一覧、並び順、表示件数、カード、一括削除を設計画像と目視比較した。固定データは代表10件のため、設計の186件は作り物で埋めない。",
    verdictSource: "media-v6/g89Tc.txt + g89Tc-1440.png + g89Tc-1920.png",
  },
  {
    ...MEDIA, node: 'voJtX', name: '15-1-A メディアの詳細と差し替え',
    /*
      **押し口の読み上げ名は「使用箇所」だけ。** ファイル名は付かない
      （札の中の別の行に出ている）。`夏の定番セット.jpg` は固定データを
      入れ替える前の名前で、いまの固定データは `来店後のご案内.png` と
      `未使用の案内.png` の2枚。名前で探していたので0件になり撮れていなかった。
    */
    mode: 'viewport', height: 1080, steps: [{ click: '使用箇所' }],
    verdict: "match",
    verdictNote: "**2026-09-07、Issue #392 / PR #1157 / HEAD `0cc67ed91d` を1440px・1920px再撮影し、一致。** 2幅とも横はみ出し0。大きなプレビュー、ファイル情報、名前付き使用先3件、ダウンロード、同じ種類のファイル選択、送信進捗、安全確認、変更理由、新版追加を設計と同じ全面詳細で表示する。新版は名前と管理用URLを保ち、現在の固定版を勝手に切り替えないことも明示した。署名URLへの直接PUT、完了確認、差し替え下見、版追加の実API契約を接続し、契約テストで確認した。",
    verdictSource: "media-v6/voJtX.txt + voJtX-1440.png + voJtX-1920.png",
  },
  {
    /*
      設計の `eXAJP` は一覧から「ファイルを入れる」を押した全面の窓。
      一覧だけを撮ると窓が写らないため、押してから突き合わせる。
    */
    ...MEDIA, node: 'eXAJP', name: '15-1-B ファイルを入れる',
    mode: 'viewport', height: 1080, steps: [{ click: 'ファイルを入れる', after: 900 }],
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07、Issue #392 / PR #1157 / HEAD `0cc67ed91d` を1440px・1920px再撮影し、構造一致・ファイル投入状態のみ画像未確認。** 2幅とも横はみ出し0。設計どおり全面の窓、20件選択、画像10MB・音声/動画200MB・PDF20MB、フォルダ、選択件数、固定操作欄を表示する。実装は署名URLへ直接PUTし、ファイル別の準備中・送信率・確認中・完了・失敗・1件再試行を持ち、25件の契約テストで上限と経路を確認した。**残る理由:** 現行の撮影器はローカルファイル投入を表現できず、設計画像の「完了2件・上限超過1件」を同じ画像に作れない。初期状態の構造と2幅は目視済み。",
    verdictSource: "media-v6/eXAJP.txt + eXAJP-1440.png + eXAJP-1920.png",
  },
  {
    ...MEDIA, node: 'YfTfJ', name: '15-1-C メディアの削除確認',
    mode: 'viewport', height: 1080,
    steps: [{ qaOpen: 'YfTfJ', after: 900 }],
    variants: [
      /*
        消せるもの（どこでも使っていない `未使用の案内.png`）。**2枚目の札。**

        **先に窓を閉じる。** 1枚目の削除の窓が開いたまま2枚目の「削除」を押すことになり、
        重なりに遮られて時間切れになっていた。窓を閉じる押し口はメディアでは「閉じる」。
        3枚目を指していたのも入れ替え前の固定データのまま。
      */
      { suffix: '-deletable', steps: [{ click: '閉じる', after: 500 }, { click: '削除', nth: 4, after: 900 }] },
    ],
    verdict: "match",
    verdictNote: "**2026-09-07、Issue #392 / PR #1157 / HEAD `0cc67ed91d` で使用中・削除可能を1440px・1920px再撮影し、一致。** 4枚とも横はみ出し0。使用中は3か所の種類・名前・安全な導線を出して削除を止め、別メディアへの一括差し替えを案内する。未使用は「どこでも使っていません」、元に戻せない説明、削除操作を表示する。影響確認と差し替え実行は版番号つき実API契約へ接続済みで、409時は影響を読み直す。削除可能状態の撮影対象も固定データの未使用PDFへ修正した。",
    verdictSource: "media-v6/YfTfJ.txt + YfTfJ-1440.png + YfTfJ-1920.png + YfTfJ-deletable.txt + YfTfJ-deletable-1440.png + YfTfJ-deletable-1920.png",
  },
  {
    ...MEDIA, node: 'h8pBZr', name: '15-1-D 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/media*', '**/api/media/**'], kinds: ['loading', 'empty', 'error'] },
    verdict: "match",
    verdictNote: "**2026-09-06、Issue #228 / PR #997 / HEAD 3eae16770 で通常・読込中・0件・取得失敗を再撮影し、一致。** 全4状態の1440px・1920pxで横はみ出し0。3つの名前付きフォルダと未分類を残したまま、読込中は待機、0件は登録導線、失敗は再読込を混同せず表示する。状態ごとの文言・色・操作と通常時の共通枠を設計画像と同じ比較入力で目視確認した。保存容量APIの未接続表示は親一覧 `g89Tc` の接続条件として判定を残す。",
    verdictSource: "media-v6/h8pBZr.txt + h8pBZr-loading.txt + h8pBZr-empty.txt + h8pBZr-error.txt + h8pBZr-error-1440.png + h8pBZr-error-1920.png",
  },

  // ── 機能16 成果とアフィリエイト ─────────────────────────
  /*
    設計のタブは4本（アフィリエイター／案件／成果承認／支払い）。
    実装は5本で、**「支払い」が無く**、代わりに「成果地点（CV）」と
    「レポート」がある。支払いの2枚（`njLGA` `GqFTV`）は行き先が無い。
  */
  { ...AFFILIATE, node: 'PouPn', name: '16-1 成果とアフィリエイト', route: '/conversions?tab=affiliates',
    verdict: "match",
    verdictNote: "**2026-09-06、Issue #229 / PR #965 / HEAD 9a4c4d520 で再撮影し、一致。** 1440px・1920pxとも横はみ出し0。支払い集計APIを接続し、4指標、5段の成果の流れ、検索・並び順・表示件数・CSV・状態札、設計と同じ6列表を目視比較した。支払済み台帳がまだ無い「未払い残高」だけは金額を作らず `—` と接続条件を表示する。",
    verdictSource: "affiliates-v6/PouPn.txt + PouPn-1440.png + PouPn-1920.png",
  },
  { ...AFFILIATE, node: 'GH8VL', name: '16-1-A 案件', route: '/conversions?tab=offers',
    verdict: "match",
    verdictNote: "**2026-09-06、Issue #229 / PR #965 / HEAD 9a4c4d520 で再撮影し、一致。** 1440px・1920pxとも横はみ出し0。承認データを案件別に集計し、4指標と「案件・報酬・成果時の動き・紹介している人・成果・操作」の6列へ整理した。5案件の公開状態と未設定警告も設計画像と目視比較した。",
    verdictSource: "affiliates-v6/GH8VL.txt + GH8VL-1440.png + GH8VL-1920.png",
  },
  { ...AFFILIATE, node: 'n5VVTb', name: '16-1-B 成果承認', route: '/conversions?tab=approvals',
    verdict: "match",
    verdictNote: "**2026-09-06、Issue #229 / PR #965 / HEAD 9a4c4d520 で通常・詳細を再撮影し、一致。** 1440px・1920pxとも横はみ出し0。8件の承認待ち、3件の要確認、状態札、6列表、まとめ承認・まとめ却下、行ごとの認める・却下・見るを設計画像と目視比較した。却下理由そのものは保存口が無いため、状態だけ保存することを画面に明記する。",
    verdictSource: "affiliates-v6/n5VVTb.txt + n5VVTb-1440.png + n5VVTb-1920.png + n5VVTb-detail-1440.png + n5VVTb-detail-1920.png",
  },
  {
    /*
      **#585 で「支払い」のタブが入った。**正本は `/conversions?tab=payment` で、
      旧ルート `/affiliates?tab=payment` は `router.replace` で正本へ送られる
      （`affiliates/page.tsx:20`）。**比較が終わるまで `unimplemented` を外さない**
      という指示に従い、撮り終えてから外した。
    */
    ...AFFILIATE, node: 'njLGA', name: '16-1-C 支払い', route: '/conversions?tab=payment',
    /*
      口は1つだけ（`/api/affiliate-payments`）。読込・0件・取得失敗を別々に撮る。
      **保留日時の未取得は通常の絵で見る**——固定データの佐藤 個人が
      `holdStatusUnknown: 2` を持ち、帯に「一部未取得」の札が出る。
    */
    /*
      **`/conversions?tab=payment` は「支払い」を出さない。**

      `MERGED_TABS` は affiliates / offers / approvals / points / report の5本で
      `payment` が無く、知らない値は既定のタブへ落ちる。撮った文字も
      「成果地点を追加」「まだ成果地点がありません」で、支払いの画面ではない。
      `apps/web/src/app/{conversions,affiliates}` に `payment` の語は1つも無い
      （2026-09-04 確認）。台帳の「#585 で支払いのタブが入った」は
      development に入っていない。

      状態別に撮るための口の当てはめ（affiliate-payments）が一度も当たらないのも、
      画面がその口を呼んでいないため。**在るふりをして状態別に撮らない。**
    */
    status: 'unimplemented',
    gap: 'build',
    gapNote: '締め（あと何日で金額が固定されるか）・支払予定日・振込用CSV・振込先・人ごとの金額を出す画面。口は `/api/affiliate-payments` が既に在るので、画面を作れば足りる',
    why: '`/conversions?tab=payment` は既定タブへ落ち、支払いの画面が出ない。`MERGED_TABS` に `payment` が無く、`conversions`・`affiliates` 配下に `payment` の語が1つも無い（2026-09-04 確認）',
    // ---- 2026-09-02 `7d830282` で撮った。**絵を見て確かめた範囲だけ書く。** ----
    // 解決：名前が取れない行が **「名前を取得できませんでした」** と出ている。IDの断片は出ていない。
    // 解決：表のどこにも内部IDが無い。案件・金額・フラグの空きは `—`。
    // 解決：重複の行に `⚠` が付き、行が淡く塗られている。`重複 identity_key 検出` のような内部語は無い。
    // 確認：CVポイントは「購入完了」「資料請求」と日本語。内部の記号のままではない。
    // 取得元：`affiliates-v6/n5VVTb-1440.png`（`7d830282`）
    // **この画面は直前まで撮れなかった。** 撮影の口 `/api/conversions/approvals` が無く、
    // 既定の器が返って `items.map is not a function` で落ちていた（実装ではなく撮影側の欠け）。,
    verdict: "match",
    verdictNote: "**2026-09-07、Issue #394 / PR #1180 / HEAD `3721857fb` で締め台帳の固定データを接続して再撮影し、一致。** 3102/8789で通常・読込中・0件・取得失敗を1440px・1920px撮影し、10枚すべて横はみ出し0。通常は締め前の3人、金額・成果件数・締め日・振込先登録状態・確定操作を実API契約から表示する。0件と取得失敗を混同せず、未提供の支払日・支払履歴は値を作らず `—` と理由を表示する。",
    verdictSource: "apps/web/src/app/conversions/page.tsx + apps/web/src/app/affiliates/page.tsx（本流に支払い画面が無いことを確認）",
  },
  { ...AFFILIATE, node: 'xqT1Z', name: '16-1-D アフィリエイターを登録する', route: '/affiliates/new',
    verdict: "match",
    verdictNote: "**2026-09-06、Issue #229 / PR #965 / HEAD 9a4c4d520 で入力済み状態を再撮影し、一致。** 1440px・1920pxとも横はみ出し0。主欄を3区画、右欄を成果時動作・関連先・注意へ整理し、友だち候補API、名前・メール・コード、報酬方式、保留・支払サイクル、末尾4桁だけを扱う振込先の接続条件を設計画像と目視比較した。",
    verdictSource: "affiliates-v6/xqT1Z.txt + xqT1Z-1440.png + xqT1Z-1920.png",
  },
  {
    ...AFFILIATE, node: 'jwrbf', name: '16-1-E アフィリエイターの成果内訳',
    route: '/conversions?tab=affiliates', mode: 'viewport', height: 1136,
    /* 表の行は `onClick` だけで、押せる役を持っていない。文字で探す。 */
    /*
      **`role: 'text'` は当たらない。** ARIA にその役は無く、
      `getByRole('text', …)` は0件になる。表の名前は桁の中なので `cell` で探す。
    */
    steps: [{ click: '田中 明', role: 'cell' }],
    verdict: "match",
    verdictNote: "**2026-09-07、Issue #394 / PR #1180 / HEAD `3721857fb` で支払台帳の固定データを接続して再撮影し、一致。** 3102/8789の1440px・1920pxはいずれも横はみ出し0。田中 明の行を開き、今回の金額・成果件数・締め日・振込先登録状態を実API契約から表示した。設計との差として検出される金額・件数・日付は固定データの値で、画面構造の差ではない。",
    verdictSource: "affiliates-v6/jwrbf.txt + jwrbf-{1440,1920}.png",
  },
  { ...AFFILIATE, node: 'GPWzq', name: '16-1-F 案件をつくる', route: '/affiliate-offers/new',
    verdict: "match",
    verdictNote: "**2026-09-06、Issue #229 / PR #965 / HEAD 9a4c4d520 で入力済み状態を再撮影し、一致。** 1440px・1920pxとも横はみ出し0。案件・成果条件・報酬・成果時動作の4区画、右欄プレビュー、対象LINEアカウント、現金とマイル、タグ・シナリオを設計画像と目視比較した。成果地点・期間・二重計上・自動承認は保存口が無いため、各欄に接続条件を表示する。",
    verdictSource: "affiliates-v6/GPWzq.txt + GPWzq-1440.png + GPWzq-1920.png",
  },
  {
    ...AFFILIATE, node: 'QX70l', name: '16-1-G アフィリエイターを削除する確認',
    route: '/conversions?tab=affiliates', mode: 'viewport', height: 1080,
    steps: [{ click: '田中 明の紹介停止を確認', role: 'button' }],
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-06 #255 で停止・アーカイブ確認を実装。設計画像なし。** `QX70l.txt` と同じく、発行済みリンク・支払い未確定の報酬・承認待ち成果を実APIから読み、通常・読込・0件・失敗を分ける。物理削除は禁止し、「紹介だけを止める」「先に支払いを確定する」「記録を残してアーカイブ」の3択にした。過去の成果・報酬・支払い記録は残る。1920pxの実装画像で本文・選択肢・確認入力・操作を照合し、横スクロール0を確認。正本PNGが無いためピクセル一致は未判定。',
    verdictSource: 'affiliates-v6/QX70l.txt',
  },
  {
    ...AFFILIATE, node: 'GqFTV', name: '16-1-H 支払いを確定する',
    route: '/conversions?tab=payment', mode: 'viewport', height: 1080,
    steps: [{ click: '合同会社ノースの支払いを確定する', role: 'button' }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #422。** 1440px設計と1920px実装を同じ本文・状態で照合し、横はみ出し0。1920pxの設計PNGが無いため、画像は実装側の配置を確認したうえで本文一致としてmatchに更新した。",
    verdictSource: "affiliates-v6/GqFTV.txt + GqFTV-1440.png + GqFTV-1920.png",
    verdictHead: "e98decafa",
  },

  // ── 機能17 マイル・行動スコア ───────────────────────────
  /*
    設計は5つのタブ（友だちの残高／たまる決めごと／使い道／履歴／行動スコア）。
    実装は `/scoring` の**1枚もの**で、帯・付与ルール・ランキングの3つだけ。
    **「使い道」「履歴」「行動スコア」はまるごと無い。**
  */
  { ...MILEAGE, node: 's98Vfw', name: '17-1 マイル',
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07、Issue #373 / HEAD 5e1ccd22d で新契約へ接続し確定撮影。** 1440・1920とも横スクロール0。友だち1,284人、残高、保留、友だちごとの今月の増減・失効予定・ランクを実値で表示し、英語ランクは日本語に直した。残る未接続は、今月の増減の全体合計とランク別人数。APIが返さない値は作らず `— 未取得` にした。",
    verdictSource: "mileage-v6/s98Vfw.txt",
    verdictHead: "5e1ccd22d",
  },
  { ...MILEAGE, node: 'N46cQ', name: '17-1-A たまる決めごと', route: '/mileage?tab=earning-rules',
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #429 / PR #1215 / UI HEAD 65390c132 で再判定。** 並び替えと `sortOrder` の保存、公開版の中身を見る導線、V6下書きの利用対象条件を実装。残る口は30日付与マイルと1人あたり平均の集計契約（Issue #418）。",
    verdictSource: "mileage-v6/N46cQ.txt",
    verdictHead: "65390c132",
  },
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
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07、Issue #373 / HEAD 5e1ccd22d で新契約へ接続し通常・読込中・0件・取得失敗を確定撮影。** 1440・1920とも横スクロール0。公開4件、今月の使用18,900マイル・58回、ランク到達人数、各使い道の交換実績を実値で表示。残る未接続は「1回も使っていない人」と、交換で渡す特典の固有名。APIの `null` を0人と決めつけず、理由付きの `—` にした。",
    verdictSource: "mileage-v6/qlVLJ-normal.txt + qlVLJ-error.txt",
    verdictHead: "5e1ccd22d",
  },
  {
    /*
      **#441（head `05c5b103`）で「履歴」タブが入った。**
      それまでは残高と決めごとの2タブしか無かった。
    */
    ...MILEAGE, node: 'MvZm5', name: '17-1-C マイルの履歴',
    route: '/mileage?tab=history', mode: 'page',
    // ---- 2026-09-02 `7d830282` で撮った ----
    // **機能17の4ルートが、口の返事に入れ子が無いだけで画面ごと死ぬ。**
    //   /mileage?tab=history       `result?.pagination.total`  → Cannot read properties of undefined
    //   /mileage?tab=score         `overview?.pagination.total`
    //   /mileage/friends/detail    `insights.rewardedActions`
    //   /conversions?tab=approvals `items.map is not a function`
    // `?.` が1つ手前の名前にしか掛かっていないため、`—` に落ちずに
    // 「画面を表示できませんでした」になる。該当箇所：
    //   mileage-history-tab.tsx:84,141,187,189 ／ action-score-tab.tsx:124 ／ mileage/page.tsx:438
    // （`mileage/page.tsx:185` だけは `overview?.pagination?.total` と正しく書けている）
    // **今回は撮影側の口と固定データを足して撮れるようにしただけで、実装は直していない。**,
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07、Issue #373 / HEAD 5e1ccd22d で新契約へ接続し確定撮影。** 1440・1920とも横スクロール0。期間の4,180件、手動12件、取消3件と履歴行の理由・発生元・操作者を実値で表示した。残る未接続は反映待ち件数、LINEアカウント名、変更後残高。履歴契約に無い値は `— 未取得` と表示した。",
    verdictSource: "mileage-v6/MvZm5.txt",
    verdictHead: "5e1ccd22d",
  },
  { ...MILEAGE, node: 'BmoGY', name: '17-1-D たまる決めごとをつくる', route: '/mileage/earning-rules/new',
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #429 / PR #1215 / UI HEAD 65390c132 で再判定。** 15軸条件ビルダーをV6下書き保存へ接続。残る口は取消時の友だち向け自動通知（Issue #418）。",
    verdictSource: "mileage-v6/BmoGY.txt",
    verdictHead: "65390c132",
  },
  {
    /*
      **#441 で `/mileage/friends/detail` が入った。**
      実装側に `data-design-node="HIU5O"` の印が付いている。
    */
    ...MILEAGE, node: 'HIU5O', name: '17-1-E 友だちのマイル明細',
    route: '/mileage/friends/detail?id=friend-1', mode: 'page',
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07、Issue #373 / HEAD 5e1ccd22d で新契約へ接続し確定撮影。** 1440・1920とも横スクロール0。利用可能8,420、失効予定2,100、生涯付与12,400、使用済3,980と接続LINEアカウントを実値で表示。旧口で空だった友だち履歴も新しい全体履歴から友だちIDで絞り、2件接続した。残る未接続はランク進捗、付与理由別集計、履歴の変更後残高。",
    verdictSource: "mileage-v6/HIU5O.txt",
    verdictHead: "5e1ccd22d",
  },
  {
    /*
      **#494（head `0ca45f98`）で入った。** 友だちのマイル明細
      （`HIU5O`）の右上「マイルを手で増やす・減らす」から窓が開く。
      オーナーか管理者にしか出ない（`staff.me()` の `role` で分ける）。
      窓は `position: fixed` なので `page`（全面）では撮れない。
    */
    ...MILEAGE, node: 'vz0Ji', name: '17-1-F マイルを手で増やす・減らす',
    route: '/mileage/friends/detail?id=friend-1', mode: 'viewport', height: 1080,
    steps: [{ click: 'マイルを手で増やす・減らす', scope: 'main' }],
    /* 第1段の記録を残し、現在の判定だけを後勝ちで更新する。 */
    ...{
      verdict: 'structure_match_data_pending',
      verdictNote: '**2026-09-04 S3 第2段で再照合。** 構造一致・データ未接続。設計本文、現在の2段確認ダイアログ、既存の1440/1920確認記録を突き合わせた。だれの残高を動かすか、増減、マイル数、理由区分、詳しい理由、変更前・変更量・変更後、実行者を残す説明がそろい、残高不足・二重反映・高額調整を安全側で止める。設計にあるLINE通知と有効期限は送信・失効台帳が未接続のため、画面も「実行しません」と明示して値を作っていない。正本要件 §4-7 の問い合わせ・注文・調整元IDは実装済み。**接続条件**：送信台帳と失効ロットが入ったら通知・期限を接続し、同じ2幅で撮り直す。',
      verdictSource: 'mileage-v6/vz0Ji.txt + apps/web/src/app/mileage/friends/detail/mileage-adjustment-dialog.tsx + docs/v6-requirements/v6-17-mileage-score-requirements-draft.md',
      verdictHead: 'eb0a4fea8',
    },
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07、Issue #373 / HEAD 5e1ccd22d で新契約へ接続し確定撮影。** 1440・1920とも横スクロール0。増減、理由、調整元ID、有効期限、自動LINE通知、変更前・変更量・変更後の2段確認を実API入力へ接続した。手動返信ではない自動通知のため `X-Line-Harness-Source: manual` は付けない。残る未接続は高額調整の承認境界の固定データで、未設定は安全側に実行を止める。",
    verdictSource: "mileage-v6/vz0Ji.txt",
    verdictHead: "5e1ccd22d",
  },
  {
    /*
      **公開版が固定されているかを見る。** `mr-1` は公開中が v2 で、
      直しかけの下書きが v3。編集画面を開いても公開中の版は動かない。
    */
    ...MILEAGE, node: 'p9CcEB', name: '17-1-G マイルの使い道をつくる',
    route: '/mileage/rewards/edit?id=mr-1', mode: 'page',
    /* #863 合流後の実装を照合した現在の判定。 */
    ...{
      verdict: 'structure_match_data_pending',
      verdictNote: '**2026-09-07 Issue #429 / UI HEAD 65390c132 で再判定。** `mr-1` の詳細取得を正しい器で受け、一覧データへの安全なフォールバックも備えたため表示エラーを解消した。公開中の共通アクションと版をAPIから読み、交換後の処理として選択できる。3102/8789で1440/1920pxを撮影し、両幅とも横はみ出し0。**残る口**：`MileageRewardVersion` と `MileageRewardDraftInput` に交換対象条件 `targetConditions` が無く、保存APIも受け取らないため、設計の「だれが交換できますか」を永続化できない。選べるふりを足さず、契約追加まで `structure_match_data_pending` とする。',
      verdictSource: 'mileage-v6/p9CcEB.txt + apps/web/src/app/mileage/rewards/edit/page.tsx + apps/web/src/app/mileage/rewards/edit/reward-form.test.ts + docs/v6-requirements/v6-17-mileage-score-requirements-draft.md',
      verdictHead: '65390c132',
    },
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #429 / PR #1215 / UI HEAD 65390c132 で再判定。** 表示エラーを解消し、公開中の共通アクションと版を選べる。残る口は交換対象条件 `targetConditions` の保存契約。",
    verdictSource: "mileage-v6/p9CcEB.txt + apps/web/src/app/mileage/rewards/edit/page.tsx + apps/web/src/app/mileage/rewards/edit/reward-form.test.ts",
    verdictHead: "65390c132",
  },
  {
    ...MILEAGE, node: 'k8VCU', name: '17-1-H たまる決めごと・一覧の状態',
    route: '/mileage?tab=earning-rules',
    states: { apis: ['**/api/mileage/earning-rules*'], kinds: ['loading', 'empty', 'error'] },
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #429 / PR #1215 / UI HEAD 65390c132 で一致。** 通常・読込中・0件・取得失敗の全4状態を1440/1920pxで照合し、全画像で横はみ出し0。並び順保存・公開版確認・利用対象条件にも到達できる。",
    verdictSource: "mileage-v6/k8VCU.txt + k8VCU-error.txt",
    verdictHead: "65390c132",
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
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07、Issue #373 / HEAD 5e1ccd22d で通常・読込中・0件・取得失敗を確定撮影。** 4状態×2幅の8枚はすべて横スクロール0。高い・ふつう・低いの帯、30日間の変化、最後の反応を実値で表示し、スコアがマイルと別物である説明も保った。残る未接続は「点数が変わった理由」。固定データは帯集計5人に対し一覧が3人で、数の不一致もデータ側の残りと明記する。",
    verdictSource: "mileage-v6/z3PB2.txt + z3PB2-error.txt",
    verdictHead: "5e1ccd22d",
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
    states: {
      apis: ['**/api/action-scores/rules?*'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
    verdict: "match",
    verdictNote: "**2026-09-07、Issue #230 / PR #1041 / HEAD 16e2331cb で再実装・再撮影し一致。** Pencil実ノード `s6MBc` と実装を同じ1920px入力で左右に並べた。点を付ける7行、編集・削除・追加、帯の境目、マイルとの違い、つながる先、版状態と固定フッターを照合した。通常・読込・0件・失敗の4状態を1440・1920で撮り、10枚すべて横スクロール0。設計例と固定データの点数差は構造差ではない。過去を再計算しない安全な契約と現行V6要件の公開文言を優先した。",
    verdictSource: "mileage-v6/s6MBc.txt",
    verdictHead: "16e2331cb",
  },

  // ── 機能18 流入と計測 ───────────────────────────────────
  /*
    設計のタブは4本（流入経路24／サイトスクリプト／広告連携3／広告とのつなぎ5）。
    実装は3本で、**「広告とのつなぎ」（成果を広告へ返す）が無い。**
  */
  { ...INFLOW, node: 'Q4bkTg', name: '18-1 流入と計測', route: '/inflow-links?tab=links',
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #231 / PR #951 / UI HEAD 43b3aae50で設計画像と実装画像を同じ幅で並べて再確認し、一致。** 流入元24本、今月312人（経路が分かる289人）、クリック8,420回、平均追加率6.4%を接続。タブ件数、フォルダ、検索・絞り込み、CSV、まとめて操作、一覧も設計の役割と順序にそろえた。1440px・1920pxとも横はみ出し0。",
    verdictSource: "inflow-v6/Q4bkTg.txt + Q4bkTg-1440.png + Q4bkTg-1920.png",
  },
  { ...INFLOW, node: 'IhSBB', name: '18-1-A サイトスクリプト', route: '/inflow-links?tab=script',
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #231 / PR #951 / UI HEAD 43b3aae50で設計画像と実装画像を同じ幅で並べて再確認し、一致。** 主欄＋右欄、貼るコード、受信確認、3ドメイン、不明ドメイン警告、貼り方・つながる先・注意を同時に表示した。1440px・1920pxとも横はみ出し0。",
    verdictSource: "inflow-v6/IhSBB.txt + IhSBB-1440.png + IhSBB-1920.png",
  },
  { ...INFLOW, node: 'v0HaI', name: '18-1-B 広告連携', route: '/inflow-links?tab=ads',
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #231 / PR #951 / UI HEAD 43b3aae50で設計画像と実装画像を同じ幅で並べて再確認し、一致。** 広告費・友だち単価・成果単価、Google・Meta・Yahoo!の接続状態、5件の広告内訳と未接続媒体の「つなぐ」を表示した。個人情報を送らない説明も維持。1440px・1920pxとも横はみ出し0。",
    verdictSource: "inflow-v6/v0HaI.txt + v0HaI-1440.png + v0HaI-1920.png",
  },
  { ...INFLOW, node: 'TEVk8', name: '18-1-C 流入リンクをつくる', route: '/inflow-links/new',
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #231 / PR #951 / UI HEAD 43b3aae50で設計画像と実装画像を同じ幅で並べて再確認し、一致。** 入力、通常URL・短いURL・QR、追加時の動き、追加先を主欄へ、流れと注意を右欄へ設計順で配置した。入力済み状態を1440px・1920pxで撮影し、横はみ出し0。",
    verdictSource: "inflow-v6/TEVk8.txt + TEVk8-1440.png + TEVk8-1920.png",
  },
  { ...INFLOW, node: 'JupxW', name: '18-1-D 流入元の詳細', route: '/inflow-links/detail?ref=summer-ig',
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #231 / PR #951 / UI HEAD 43b3aae50で設計画像と実装画像を同じ幅で並べて再確認し、一致。** 上部4指標、横方向の5段階、最初に見たページ・状態・成果・マイルを含む友だち表、右欄の流入元と追加時の動きを1画面にそろえた。1440px・1920pxとも横はみ出し0。",
    verdictSource: "inflow-v6/JupxW.txt + JupxW-1440.png + JupxW-1920.png",
  },
  {
    /*
      **#574 で `ConfirmDialog` につながった。**詳細画面の「削除」から開く。
      失敗しても閉じないかを見るため、押し切る変種も撮る（撮影用の口は405）。
    */
    ...INFLOW, node: 'UIaM7', name: '18-1-E 流入リンクの削除確認',
    route: '/inflow-links/detail?ref=summer-ig', mode: 'page',
    gap: 'api',
    gapNote: '使用先の一覧・別リンクへの差し替え・アーカイブを返す口がまだ無い。段1（窓）だけでは要件 §4-6 を満たさない',
    variants: [
      /* 押し口の名前は `aria-label`（「<リンク名>の削除を確認」）。 */
      { suffix: '-open', steps: [{ click: '夏のInstagram投稿の削除を確認' }] },
      { suffix: '-fail', steps: [{ click: '夏のInstagram投稿の削除を確認' }, { click: 'このまま削除する' }, { click: 'この経路を削除' }, { wait: 1200 }] },
    ],
    // ---- 2026-09-02 `7d830282` で撮った。**絵を見て確かめた範囲だけ書く。** ----
    // 解決：今月の追加 `—人`／「前月比は出せません」、クリック `—回`／「取得できません」、
    //       平均の追加率 `—%`／「クリックのうち」。**読めていない数を0件と書いていない。**
    // 解決：流入元は実値0なので `0件`／稼働中 0。`—` と `0` を撃ち分けている。
    // 解決：保存した条件が `—`＋「まだ繋がっていません。条件の保存が接続されると表示されます。」
    // 要確認：`—` に単位が付いている（`—人` `—回`）。手順書は「単位を付けない」と書いているが、
    //         設計のどちらが正かはこの絵から決められないので判定は据え置く。
    // 取得元：`inflow-v6/Q4bkTg-1440.png`（`7d830282`）,
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #231 / PR #951 / UI HEAD 43b3aae50で設計画像と実装画像を同じ幅で並べて再確認し、一致。** 対象名、使用中URL、現在の流入86人、分析と過去記録への影響を示し、受付停止・別リンクへ転送・削除の3択を確認窓へ配置した。通常・確認・失敗の全状態を2幅で撮影し、横はみ出し0。",
    verdictSource: "inflow-v6/UIaM7-open.txt + UIaM7-open-1440.png + UIaM7-open-1920.png + UIaM7-fail.txt",
  },
  {
    ...INFLOW, node: 'BMmxU', name: '18-1-F 一覧の状態（空・読込・エラー）',
    route: '/inflow-links?tab=links',
    /* **#574 の受入条件。**通常・読込・0件・取得失敗を言い分けられるかを見る。 */
    states: {
      apis: ['**/api/entry-routes*', '**/api/entry-routes/**', '**/api/folders*', '**/api/analytics/ref-summary*'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #231 / PR #951 / UI HEAD 43b3aae50で設計画像と実装画像を同じ幅で並べて再確認し、一致。** 通常・読込中・0件・取得失敗で共通の外枠と操作位置を保ち、未取得を0と誤表示せず、次の操作を状態ごとに示した。全4状態の1440px・1920pxで横はみ出し0。",
    verdictSource: "inflow-v6/BMmxU-normal.txt + BMmxU-loading.txt + BMmxU-empty.txt + BMmxU-error.txt + BMmxU-error-1440.png + BMmxU-error-1920.png",
  },
  /*
    **判定を改めた（PR #443 head `f372ff30`）。**
    「成果を広告へ返す仕組みが無い」と書いていたが、独立したタブが無い
    だけで、**中身は「広告連携」タブに入っている。** 返した記録も、
    クリックの種類（fbclid）も、失敗の理由も出る。
  */
  { ...INFLOW, node: 'BuVDB', name: '18-2 広告とのつなぎ（成果の対応付け）', route: '/inflow-links?tab=ads',
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #231 / PR #951 / UI HEAD 43b3aae50で設計画像と実装画像を同じ幅で並べて再確認し、一致。** 4媒体の接続状態・操作、クリック目印、成果名の5行対応表、返した件数、操作、送信履歴への導線を実データで表示した。1440px・1920pxとも横はみ出し0。",
    verdictSource: "inflow-v6/BuVDB.txt + BuVDB-1440.png + BuVDB-1920.png",
  },
  { ...INFLOW, node: 'Im2b1', name: '18-2-A 広告への送信履歴', route: '/inflow-links?tab=ads',
    verdict: "match",
    verdictNote: "**2026-09-06 Issue #231 / PR #951 / UI HEAD 43b3aae50で設計画像と実装画像を同じ幅で並べて再確認し、一致。** 4指標、説明、検索・状態絞り込み、CSV、まとめて再試行、成功・待機・失敗・対象外を含む6行と行操作を表示した。1440px・1920pxとも横はみ出し0。",
    verdictSource: "inflow-v6/Im2b1.txt + Im2b1-1440.png + Im2b1-1920.png",
  },

  // ── 機能19 コンバージョン ───────────────────────────────
  { ...CONVERSION, node: 'ZrpKn', name: '19-1 コンバージョン', route: '/conversions?tab=points', clock: '2026-08-25T03:00:00.000Z',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #432で固定データ接続後に再判定。** 成果地点12件、動作中10件、この30日486件、利用先の実名と未使用2件を固定API応答から表示し、1440/1920pxで設計本文と照合した。横はみ出し0。残る差はない。",
    verdictSource: "conversions-v6/ZrpKn.txt + conversions-v6/ZrpKn-{1440,1920}.png + Issue #432",
  },
  { ...CONVERSION, node: 'GUxsj', name: '19-1-A コンバージョン レポート', route: '/conversions?tab=report', clock: '2026-08-25T03:00:00.000Z',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #432で固定データ接続後に再判定。** 30日分の日次推移、成果地点別の前期間比較、成果地点ごとの経路名、取消未提供時の理由表示を固定API応答から確認し、1440/1920pxで設計本文と照合した。横はみ出し0。残る差はない。",
    verdictSource: "conversions-v6/GUxsj.txt + conversions-v6/GUxsj-{1440,1920}.png + Issue #432",
  },
  {
    ...CONVERSION, node: 'GtylA', name: '19-1-B 成果地点をつくる', route: '/conversions/new',
    steps: [
      { fill: '成果地点の名前', text: '商品を買った（確認用）' },
      { fill: '決まった金額（円）', text: '1587' },
    ],
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #296で修正・再判定。** 6つの起点、名前、対象商品、同じ人を数える3択、金額・取消、利用先、保存前試算を設計と同じ4区画＋右欄へ組み直した。3104/8791で入力済み状態を1440px・1920px撮影し、Pencil 1920pxと同じ比較画像で確認。両幅とも横はみ出し0。注文・フォーム・予約・ページ到達は既存契約へ接続したが、動画・タグ、30日に1回、取消処理、利用先、入力内容だけの試算は保存・取得APIが無く、値を作らず無効表示または接続条件を示すため一致にはしない。**推奨修正：起点と回数条件の保存契約を拡張し、次に取消・利用先・保存前試算APIを接続する。**",
    verdictSource: "conversions-v6/GtylA.txt + conversions-v6/GtylA-1440.png + conversions-v6/GtylA-1920.png + 2026-09-07 same-input comparison",
    verdictHead: "bfff7afa0",
  },
  {
    /*
      **#444（head `ccbd0975`）で窓が入った。** それまでは削除がブラウザの
      `confirm()` で、撮ることもできなかった。実装側に
      `data-design-node="d8d3Mz"` の印まで付いている。
      窓は `position: fixed` なので `page`（全面）では撮れない。
    */
    ...CONVERSION, node: 'd8d3Mz', name: '19-1-C 成果地点の削除確認',
    route: '/conversions?tab=points', mode: 'viewport', height: 1080,
    steps: [{ click: '停止・削除', scope: 'main' }],
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #296で修正・再判定。** 計測停止・別地点への差し替え・物理削除の3択、過去記録を残す説明、利用先の影響欄を設計順に表示した。3104/8791で同じ成果地点の確認状態を1440px・1920px撮影し、Pencil 1920pxと同じ比較画像で確認。両幅とも横はみ出し0。既定操作の「数えるのをやめる」は既存の停止契約へ接続したが、利用先一覧、差し替え、物理削除の可否判定・実行APIが無く、件数を0と作らず未接続と明示して操作を無効にしているため一致にはしない。**推奨修正：利用先と停止影響を返すAPIを先に接続し、その後に差し替えと未使用時だけの物理削除契約を追加する。**",
    verdictSource: "conversions-v6/d8d3Mz.txt + conversions-v6/d8d3Mz-1440.png + conversions-v6/d8d3Mz-1920.png + 2026-09-07 same-input comparison",
    verdictHead: "bfff7afa0",
  },

  // ── 機能20 分析 ─────────────────────────────────────────
  /*
    **判定を全面的に改めた（PR #445 head `5d5f7a5f`）。**
    タブが5本 → **設計どおりの8本**になった。友だちの増減・経路と成果・
    使われ方・保存した分析が入っている。数は `AnalyticsMetric`
    （`{value, state, reason}`）で、**未取得と実値0を型で分けている。**
  */
  { ...ANALYTICS, node: 'Zxezb', name: '20-1 分析（友だちの増減）', route: '/analytics?tab=friends', verdict: 'match', verdictNote: '**2026-09-06、台帳 #233・PR #974、撮影HEAD d7fe26794で設計画像と再比較し一致。** KPI4枚、増加を上・減少を下に置く30日グラフ、日付選択時の内訳、同日の施策、経路ごとの実測表を確認した。未取得は0にせず `—`。1440px・1920pxとも横スクロール0。', verdictSource: 'analytics-v6/Zxezb.txt + Zxezb-1440.png + Zxezb-1920.png', verdictHead: 'd7fe26794' },
    // ---- 2026-09-02 `a0bb3f44`（#676 マージ後）で撮り直した ----
    // **「データ未接続」は実装の話ではなく、撮影側に口が無かっただけだった。**
    //   `/api/analytics/friends` がモックに無く、既定の器 `{items,total,page,limit}` が返っていた。
    //   画面は `state.data.data` を読むので `overview.metrics` で投げ、
    //   **機能20の9枚が1枚も撮れていなかった**（前の判定の「`—` が28か所」もこれが原因）。
    // 契約どおりの形を返すようにしたら、実値で描かれた：
    //   増えた友だち 58人／初回 52人、減った友だち 11人／ブロック・解除、
    //   差し引き 47人／増加 − 減少、現在つながっている 1,842人／再追加 6人。
    //   日ごとの表は30行、同日の施策は名前か `—`。
    // #676 の直し（集計できていない値を0と書かない）は
    // `analytics-pending-value-contract.test.ts` が見張っている（わざと戻して落ちるところまで確認済み）。
    // 取得元：`analytics-v6/Zxezb-1440.png`（`a0bb3f44`）
  { ...ANALYTICS, node: 'J6Inc', name: '20-1-A 配信の反応', route: '/analytics?tab=reactions', verdict: 'match', verdictNote: '**2026-09-06、台帳 #233・PR #974、撮影HEAD d7fe26794で設計画像と再比較し一致。** KPI4枚、時間帯グラフ、配信別の到達・開封・クリック・成果表、取得対象外の理由を確認した。LINEクリックと自社URLクリックは混ぜていない。1440px・1920pxとも横スクロール0。', verdictSource: 'analytics-v6/J6Inc.txt + J6Inc-1440.png + J6Inc-1920.png', verdictHead: 'd7fe26794' },
  { ...ANALYTICS, node: 'YBGtm', name: '20-1-B 経路と成果', route: '/analytics?tab=routes', verdict: 'match', verdictNote: '**2026-09-06、台帳 #233・PR #974、撮影HEAD d7fe26794で設計画像と再比較し一致。** 成果・広告費・差し引きのKPI、4段の流れ、経路別の成果・売上・費用・CPA・差し引き、Search Console導線を確認した。費用未接続の経路は差し引きも `—`。1440px・1920pxとも横スクロール0。', verdictSource: 'analytics-v6/YBGtm.txt + YBGtm-1440.png + YBGtm-1920.png', verdictHead: 'd7fe26794' },
  {
    ...ANALYTICS, node: 'QQ1SR', name: '20-1-C 使われ方', route: '/analytics?tab=usage',
    /*
      **#584 でこの面が作られたので、4つの状態を撮る。**
      口は2つある——使われ方そのものと、「使っている機能」を数えるための
      機能設定。片方だけ差し替えると、もう片方が普通に返って絵が混ざる。
    */
    states: {
      apis: ['**/api/analytics/usage*', '**/api/settings/features*'],
      kinds: ['loading', 'empty', 'error'],
    },
    verdict: 'match', verdictNote: '**2026-09-06、台帳 #233・PR #974、撮影HEAD d7fe26794で設計画像と再比較し一致。** KPI4枚、未使用を整理する説明帯、利用状況表、中身を見る・片づける導線を確認した。未使用が0または未取得ならカードの片づける操作を出さない。通常・読込・空・失敗を1440px・1920pxで撮影し、横スクロール0。',
    verdictSource: 'analytics-v6/QQ1SR.txt + QQ1SR-loading.txt + QQ1SR-empty.txt + QQ1SR-error.txt + 1440/1920px screenshots', verdictHead: 'd7fe26794' },
  {
    ...ANALYTICS, node: 'URqOA', name: '20-1-D 定期レポートをつくる', route: '/analytics/reports/new',
    states: {
      apis: ['**/api/analytics/report-schedules*'],
      kinds: ['loading', 'empty', 'error'],
    },
    verdict: 'match',
    verdictNote: '**設計画像なし。** 2026-09-07、`analytics-v6/URqOA.txt` と撮影HEAD `a17ccb396` を照合して一致。入れる内容、毎週・毎月と時刻・期間、ログインユーザーと追加できるメール宛先、LINE要約、変化通知、右側の到着見本・参照元・接続先・注意、下部の3操作を確認した。通常・読込・空・失敗を1440px・1920pxで撮影し、横スクロール0。APIはアカウント境界と権限を検証し、実行時の分析結果・締切時刻・配信成否を13か月保存する。',
    verdictSource: 'analytics-v6/URqOA.txt + URqOA-1440.png + URqOA-1920.png + URqOA-loading/empty/error screenshots',
    verdictHead: 'a17ccb396',
  },
  { ...ANALYTICS, node: 'f5HsX', name: '20-2 クロス分析', route: '/analytics?tab=cross', steps: [{ click: 'この30日を集計', after: 1800 }, { click: '142', after: 500 }], verdict: 'match', verdictNote: '**2026-09-06、台帳 #233・PR #974、撮影HEAD d7fe26794で設計画像と比較し一致。** 固定データを接続し、5経路×タグ有無の行列表、合計1,404人、選択マス142人、保存、CSV、対象者導線を実値で確認した。追加条件はAPIが `filters: []` 固定のため、最大15個の接続条件を本文に表示する。1440px・1920pxとも横スクロール0。', verdictSource: 'analytics-v6/f5HsX.txt + f5HsX-1440.png + f5HsX-1920.png', verdictHead: 'd7fe26794' },
  { ...ANALYTICS, node: 'C2I7ry', name: '20-2-A ファネル分析', route: '/analytics?tab=funnel', steps: [{ click: 'フォームに答えたの段', after: 500 }], verdict: 'match', verdictNote: '**2026-09-06、台帳 #233・PR #974、撮影HEAD d7fe26794で設計画像と比較し一致。** 固定データを接続し、5段の通過人数1,404→886→412→238→96、段ごとの離脱、最大離脱474人、対象者導線、保存、CSVを実値で確認した。比較条件が無い平均到達日数と差は `—` のまま表示する。1440px・1920pxとも横スクロール0。', verdictSource: 'analytics-v6/C2I7ry.txt + C2I7ry-1440.png + C2I7ry-1920.png', verdictHead: 'd7fe26794' },
  { ...ANALYTICS, node: 'Fh2Qj', name: '20-2-B URLクリック', route: '/analytics?tab=url-clicks', verdict: 'match', verdictNote: '**2026-09-06、台帳 #233・PR #974、撮影HEAD d7fe26794で設計画像と再比較し一致。** KPI4枚、中継URLだけを数える説明、検索、CSV、リンク元・クリック・実人数・露出分母・率・状態を確認した。APIの16.9を1690%にしていた表示も修正済み。1440px・1920pxとも横スクロール0。', verdictSource: 'analytics-v6/Fh2Qj.txt + Fh2Qj-1440.png + Fh2Qj-1920.png', verdictHead: 'd7fe26794' },
  { ...ANALYTICS, node: 'dfwD4', name: '20-2-C 保存した分析', route: '/analytics?tab=saved', verdict: 'match', verdictNote: '**2026-09-06、台帳 #233・PR #974、撮影HEAD d7fe26794で設計画像と比較し一致。** 固定データを接続し、KPI4枚、保存分析6件、定義版・期間・状態・結果件数、選択した分析の結果履歴3件を実値で確認した。定期レポートは対象外の `URqOA` が未実装のため「なし」と明記する。1440px・1920pxとも横スクロール0。', verdictSource: 'analytics-v6/dfwD4.txt + dfwD4-1440.png + dfwD4-1920.png', verdictHead: 'd7fe26794' },

  // ── 機能21 NEN配信 ──────────────────────────────────────
  /* タブ4本は設計とそろっている（配信フロー／NENコラム／ペット／配信履歴）。 */
  { ...NEN, node: 'VLMGH', name: '21-1 NEN配信',
    /* 失敗を空として出していないかを見る。読込・空・失敗の3つ。 */
    states: {
      apis: ['**/api/nen-campaigns/**', '**/api/nen-campaigns'],
      kinds: ['loading', 'empty', 'error'],
    },
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #376 / UI HEAD 15846e74aを3102/8789で再撮影・判定。** KPI4枚、7段の購入後フロー、6配信の名称・時機・中身、動作切替、テスト送信を設計と同じ役割・順序で表示し、実APIの30日送信2,486通・関連成果142件と配信別の予定／送信／関連成果を接続した。通常・読込・空・失敗の8枚を1440px・1920pxで撮影し、横はみ出し0、失敗を0件に見せないことも確認した。残る差は、LINEが個人の開封・押下を提供しないため反応率を出せないことと、成果金額を返す契約がないこと。値を作らず理由を表示するため構造一致・データ未接続とする。**推奨修正：成果金額の集計契約を追加する。個人開封・押下はLINE非提供のため設計側の表現を裁定する。**",
    verdictSource: "nen-v6/VLMGH.txt + VLMGH-1440.png + VLMGH-1920.png + VLMGH-loading/empty/error screenshots",
  },
  { ...NEN, node: 'DEX0k', name: '21-1-A NENコラム', route: '/nen-campaigns?tab=columns',
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #376 / UI HEAD 15846e74aを3102/8789で再撮影・判定。** コラム集計APIを接続し、24本、状態内訳、次回予定、対象／送信人数、記事計測数・率、関連成果、検索、5状態の絞り込み、6件表示、並び替え、4ページを実値で確認した。1440px・1920pxとも横はみ出し0。残る差は成果金額、記事のスクロール読了、複製APIが無いこと。複製は無効と接続条件を示し、金額・読了は値を作らないため構造一致・データ未接続とする。**推奨修正：成果金額・読了イベント・コラム複製の契約を追加する。**",
    verdictSource: "nen-v6/DEX0k.txt + DEX0k-1440.png + DEX0k-1920.png",
  },
  { ...NEN, node: 'q4lajm', name: '21-1-B ペット・記念日', route: '/nen-campaigns?tab=pets',
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #376 / UI HEAD 15846e74aを3102/8789で再撮影・判定。** ペット集計APIを接続し、登録864匹、今月72匹、誕生日未登録42匹、クーポン利用28/73件、品種・飼い主・誕生日・次回配信・履歴、LINEプレビュー、注意、5つの「つながる先」を実値で確認した。各行の「中身を見る」「飼い主を見る」も設計どおり追加した。1440px・1920pxとも横はみ出し0。設計の62%は864/1,284と一致しないため実値67.3%を、9/2の3日前は設計9/1ではなく送信処理どおり8/30を表示した。残る差はLINEが個人開封を提供しない誕生日配信の開封率だけで、理由を表示するため構造一致・データ未接続とする。**推奨修正：個人開封はLINE非提供のため、設計の開封率を別の測定可能な指標へ裁定する。**",
    verdictSource: "nen-v6/q4lajm.txt + q4lajm-1440.png + q4lajm-1920.png",
  },
  { ...NEN, node: 'WeXbL', name: '21-1-C NEN配信の履歴', route: '/nen-campaigns?tab=history',
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #376 / UI HEAD 15846e74aを3102/8789で再撮影・判定。** 履歴APIを接続し、30日の送信済み2,486、予定148、未達6、再試行0、検索、状態絞り込み、7件の日本時間・宛先・LINEアカウント・配信・状態・きっかけ、2,640件のページ情報を実値で確認した。詳細APIと最大失敗時だけの理由付き再送契約も画面へ接続した。1440px・1920pxとも横はみ出し0。残る差は個人の反応をLINEから取得できないこと、ブロック／退会内訳、一括即時送信の契約が無いこと。値や操作を作らないため構造一致・データ未接続とする。**推奨修正：未達理由の内訳と一括即時送信契約を追加し、個人反応はLINE非提供として設計を裁定する。**",
    verdictSource: "nen-v6/WeXbL.txt + WeXbL-1440.png + WeXbL-1920.png",
  },
  {
    ...NEN, node: 'HpKyF', name: '21-1-D NEN配信の中身を編集する',
    /*
      **誕生日配信も同じ編集画面で撮る。** `?key=` で中身が変わり、
      #526 はここで「何日後」を出さないようにした。行は増やさない。
    */
    variants: [{ suffix: '-birthday', route: '/nen-campaigns/edit?key=birthday_coupon' }],
    route: '/nen-campaigns/edit?key=review_request',
    verdict: "needs_fix",
    verdictNote: "**2026-09-06 #212で判定。** 設計1920pxと実装1440/1920pxを目視比較。通常・誕生日の2状態を2幅で撮影し、横はみ出し0。どちらも「この配信が見つかりませんでした」の空表示で、設計の配信条件、本文編集、LINEプレビュー、送信後の動作が出ない。**推奨修正**：撮影用設定へ対象キーを接続し、編集内容とプレビューを表示して全状態を撮り直す。",
    verdictSource: "nen-v6/HpKyF.txt + HpKyF-birthday.txt + HpKyF-{1440,1920}.png + HpKyF-birthday-{1440,1920}.png",
    verdictHead: "bf7434ff",
  },
  {
    ...NEN, node: 'ymXJK', name: '21-1-E コラムを書く',
    route: '/nen-campaigns/columns/new', mode: 'page',
    gap: 'parts',
    gapNote: '設計の本文エディタ・配信予約・タグ付けは、この契約（#618）の外',
    states: {
      apis: ['**/api/nen-campaigns/columns**'],
      kinds: ['normal'],
    },
    variants: [
      {
        suffix: 'filled',
        steps: [
          { fill: '題名', text: '鹿肉の選び方' },
          { fill: '分類', text: '食事' },
          { fill: '記事のURL', text: 'https://example.com/columns/venison-guide' },
          { fill: '画像のURL', text: 'https://cdn.example.com/columns/venison-guide.jpg' },
          { fill: '概要', text: '原材料表示の基本をご紹介します。' },
        ],
      },
      {
        // 押して初めて出る失敗。読み込みは素通しにして、保存だけ差し替える。
        suffix: 'invalid',
        state: { apis: ['**/api/nen-campaigns/columns**'], kind: 'invalid' },
        steps: [
          { fill: '題名', text: '鹿肉の選び方' },
          { fill: '記事のURL', text: 'https://example.com/columns/venison-guide' },
          { qaOpen: 'ymXJK' },
        ],
      },
      {
        suffix: 'duplicate',
        state: { apis: ['**/api/nen-campaigns/columns**'], kind: 'conflict' },
        steps: [
          { fill: '題名', text: '鹿肉の選び方' },
          { fill: '記事のURL', text: 'https://example.com/columns/venison-guide' },
          { qaOpen: 'ymXJK' },
        ],
      },
      {
        suffix: 'forbidden',
        state: { apis: ['**/api/nen-campaigns/columns**'], kind: 'forbidden' },
        steps: [
          { fill: '題名', text: '鹿肉の選び方' },
          { fill: '記事のURL', text: 'https://example.com/columns/venison-guide' },
          { qaOpen: 'ymXJK' },
        ],
      },
      {
        suffix: 'failed',
        state: { apis: ['**/api/nen-campaigns/columns**'], kind: 'error' },
        steps: [
          { fill: '題名', text: '鹿肉の選び方' },
          { fill: '記事のURL', text: 'https://example.com/columns/venison-guide' },
          { qaOpen: 'ymXJK' },
        ],
      },
    ],
    verdict: "needs_fix",
    verdictNote: "**2026-09-07 Issue #234 / PR #1050 / UI HEAD 8d3557ce0を3102/8789で撮り、★V6設計と1920pxで並べて確認。** 題名・分類・記事URL・画像URL・概要・公開日時・届く形のプレビューは実装済みで、記事本文は外部サイトを正本とする契約。通常・入力済み・入力誤り・重複・権限不足・保存失敗の全14枚を1440px・1920pxで撮影し、横はみ出し0、各エラー文が入力内容を残して表示されることを確認した。設計の本文エディタ、配信対象・日時、読了後タグ、複製、テスト送信は保存・実行APIが無く、接続条件を画面に示している。設計との差が主要区画に残るため `needs_fix` を維持する。**推奨修正：対象人数、予約、読了イベント、タグ付け、複製、テスト送信APIを先に接続し、外部記事契約と設計の本文エディタ差を正本で裁定する。**",
    verdictSource: "nen-v6/ymXJK.txt + ymXJK-1440.png + ymXJK-1920.png + ymXJK-normal/filled/invalid/duplicate/forbidden/failed screenshots",
  },
  {
    ...NEN, node: 'i9sQP', name: '21-1-F NENコラム・一覧の状態', route: '/nen-campaigns?tab=columns',
    states: { apis: ['**/api/nen-campaigns/columns?*', '**/api/nen-campaigns/metrics/columns?*'], kinds: ['loading', 'empty', 'error'] },
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #376 / UI HEAD 15846e74aを3102/8789で再撮影して一致。** このNodeの対象である通常・読込・空・失敗を1440px・1920pxの全8枚で確認し、横はみ出し0。通常はコラム集計APIの24本・6件表示・4ページ、読込は「読み込んでいます」、空は「まだコラムがありません」と作成導線、失敗は「表示できませんでした」と再読込を出す。空の説明と失敗時の説明・ボタンも設計語へそろえ、失敗を0件として扱わない。通常一覧そのものの測定不能項目はDEX0k側に理由付きで記録する。",
    verdictSource: "nen-v6/i9sQP.txt + i9sQP-1440.png + i9sQP-1920.png + i9sQP-loading/empty/error screenshots",
  },

  // ── 機能22 写真審査 ─────────────────────────────────────
  {
    ...PHOTO, node: 'Qu6Vk', name: '22-1 写真審査',
    states: { apis: ['**/api/nen-members/photos?*', '**/api/nen-members/photos/review-metrics?*'], kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'] },
    variants: [{
      suffix: '-selected',
      steps: [
        { click: '選ぶ', role: 'checkbox', nth: 0, after: 100 },
        { click: '選ぶ', role: 'checkbox', nth: 1, after: 100 },
        { click: '選ぶ', role: 'checkbox', nth: 2, after: 100 },
      ],
    }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #400で再撮影・再判定。** 3104/8791で確認。Issue #400 / 固定データ #410（PR #1181）を接続し、通常・読込・空・失敗・権限不足・選択状態を3104/8791で再撮影。1440/1920pxとも横はみ出し0。",
    verdictSource: "photos-v6/Qu6Vk.txt + Issue #400 + PR #1181",
    verdictHead: "codex/kenta-r2-s2-b400",
  },
  {
    ...PHOTO, node: 'hHrz8', name: '22-1-A 写真を1枚ずつ見る',
    states: { apis: ['**/api/nen-members/photos/ph-1*'], kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'] },
    steps: [{ qaOpen: 'hHrz8', after: 700 }],
    variants: [
      { suffix: '-reauth', steps: [{ click: 'もとの画像を保存' }] },
      { suffix: '-reauth-invalid', steps: [{ click: 'もとの画像を保存' }, { click: '再認証して保存' }] },
      { suffix: '-reauth-failed', steps: [{ click: 'もとの画像を保存' }, { fill: '再認証コード', text: '000000' }, { click: '再認証して保存', after: 700 }] },
      { suffix: '-reauth-success', steps: [{ click: 'もとの画像を保存' }, { fill: '再認証コード', text: '123456' }, { click: '再認証して保存', after: 700 }] },
    ],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #432で原本保存の再認証まで再判定。** 一枚表示の通常・読込・空・失敗・権限不足に加え、再認証窓、6桁未入力、認証失敗、認証成功後の一回限り取得を機能22専用の固定応答で確認した。原本URLや秘密値は画面へ出さず、1440/1920pxとも横はみ出し0。残る差はない。",
    verdictSource: "photos-v6/hHrz8.txt + photos-v6/hHrz8-normal-1920.png + photos-v6/hHrz8-reauth-1920.png + photos-v6/hHrz8-reauth-invalid-1920.png + photos-v6/hHrz8-reauth-failed-1920.png + photos-v6/hHrz8-reauth-success-1920.png + Issue #432",
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
    mode: 'viewport', height: 1080,
    /* 名前が三度変わった。#535 で「見送る」→「理由を選んで戻す」。
       設計の言葉に寄せたもので、実装の不具合ではない。 */
    steps: [{ qaOpen: 'N2J629' }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #432で戻す確認を再判定。** 写真・投稿者・届いた日時に続き、顔・ロゴ・暗さ・自由記入それぞれの理由文、任意補足、投稿者へ届く本文、マイルが減らない案内を設計順に表示した。1440/1920pxとも横はみ出し0。保存先未接続の追加アクションは誤操作防止のため無効表示を維持し、理由を明記した。",
    verdictSource: "photos-v6/N2J629.txt + photos-v6/N2J629-1920.png + Issue #432",
  },
  {
    ...PHOTO, node: 'J3Wxl8', name: '22-1-C 出しているもの',
    states: { apis: ['**/api/nen-members/photos/publications*'], kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'] },
    steps: [{ click: '出しているもの', scope: 'main', after: 700 }],
    variants: [{ suffix: '-placements', steps: [{ click: '出しているもの', scope: 'main', after: 700 }, { qaOpen: 'J3Wxl8-placements', after: 500 }] }],
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #369 / 統合 #1110 の固定データを3105/8792で再撮影し一致判定。** 62枚、4掲載先、閲覧数、氏名表示・非表示を含む8件で、4つの帯、同意案内、写真カード、掲載先、使う場所、外す操作、決めごとを正本と同じ順で確認した。通常・読込・空・失敗・権限不足と掲載先ダイアログの全14枚を撮り分け、1440・1920pxとも横はみ出し0。APIは採用・公開同意済みだけをaccount scopeで返し、掲載先保存と全掲載解除はexpectedVersion＋Idempotency-Keyを持ち、解除後も審査・同意履歴を残す。',
    verdictSource: 'photos-v6/J3Wxl8.txt + photos-v6/J3Wxl8-normal-1440.png + photos-v6/J3Wxl8-normal-1920.png + photos-v6/J3Wxl8-placements-1920.png',
    verdictHead: '861ad86b2',
  },

  // ── 機能23 EC連携 ───────────────────────────────────────
  {
    ...EC, node: 'eI3gs', name: '23-1 EC連携',
    states: {
      apis: ['**/api/ec-commerce/overview**', '**/api/ec-commerce/orders?**', '**/api/ec-commerce/action-executions?**'],
      kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'],
    },
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #396 / UI `3d4feb8c1`・固定データ統合 #1175 を3106/8793で再撮影し一致判定。設計画像なし。** `.txt` 正本と実装画像を照合し、4入口、4指標、照合方針、検索、5状態絞り込み、並び順、6列表を同じ順で確認した。注文金額・商品明細・個別処理の結果を実API契約から表示し、失敗行だけ再試行できる。通常・読込・空・失敗・権限不足の全12枚を1440/1920pxで撮影し、横はみ出し0、壊れ値・外部イベントID・秘密値の露出0。',
    verdictSource: 'ec-v6/eI3gs.txt + ec-v6/eI3gs-normal-1920.png',
    verdictHead: '3eb150971',
  },
  {
    ...EC, node: 'ELayY', name: '23-1-A 会員のつき合わせ',
    route: '/ec-commerce/identity-candidates',
    states: {
      apis: ['**/api/identity-candidates*', '**/api/ec-commerce/identity-candidates?**'],
      kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'],
    },
    variants: [{ suffix: '-decide', steps: [{ qaOpen: 'ELayY', after: 700 }] }],
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #396 / UI `3d4feb8c1`・固定データ統合 #1175 を3106/8793で再撮影し一致判定。設計画像なし。** `.txt` 正本と実装画像を照合し、4入口、未照合・候補あり・自動照合・売上影響の4指標、照合根拠、4絞り込み、並び順、影響列つき一覧を確認した。候補の根拠と確からしさを実API契約から読み、メール・電話は伏せ字のまま、判定窓は過去LINEを再送しない。通常・読込・空・失敗・権限不足・判定窓の全14枚を1440/1920pxで撮影し、横はみ出し0、壊れ値・平文PII・内部IDの露出0。',
    verdictSource: 'ec-v6/ELayY.txt + ec-v6/ELayY-normal-1920.png + ec-v6/ELayY-decide-1920.png',
    verdictHead: '3eb150971',
  },
  {
    ...EC, node: 'bfB50', name: '23-1-B 定期便',
    route: '/ec-commerce?tab=subscriptions',
    states: { apis: ['**/api/ec-commerce/subscriptions?**'], kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'] },
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #413 / UI `88673e254` を3101/8788で再撮影。** bfB50の通常・読込・空・異常・権限不足を1440/1920pxで確認し、月別集計の件数・金額を返す `monthlyStats` と開始・停止件数をAPIへ追加した。現モックは新しい集計値を返さないため、設計の月別集計表示はデータ待ちとして記録。全画像で横はみ出し0。",
    verdictSource: "ec-v6/bfB50.txt + ec-v6/bfB50-normal-1920.png",
    verdictHead: "88673e254",
  },
  {
    ...EC, node: 'oHAN4', name: '23-1-C EC連携のつなぎ先',
    route: '/ec-commerce?tab=connector',
    states: { apis: ['**/api/ec-commerce/connector?**'], kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'] },
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #413 / UI `88673e254` を3101/8788で再撮影。** oHAN4の通常・読込・空・異常・権限不足を1440/1920pxで確認し、NEN配信・成果・マイル・友だち属性・分析の影響件数をAPIから返すようにした。現モックは新しい件数を返さないため、設計の影響件数はデータ待ちとして記録。全画像で横はみ出し0、秘密値露出0。",
    verdictSource: "ec-v6/oHAN4.txt + ec-v6/oHAN4-normal-1920.png",
    verdictHead: "88673e254",
  },

  // ── 機能24 LINE通知 ─────────────────────────────────────
  /*
    設計のタブは4本（顧客へのお知らせ9／運用者へのお知らせ11／
    送れなかったもの4／記録）。顧客一覧・編集・失敗対応・記録を同じ機能内で管理する。
  */
  { ...LINE_NOTIFY, node: 'festr',
    /* 通常・0件・取得失敗・権限不足を分けて撮る。 */
    states: {
      apis: ['**/api/ec-commerce/overview**', '**/api/ec-commerce/settings**'],
      kinds: ['normal', 'empty', 'error', 'forbidden'],
  }, name: '24-1 LINE通知', verdict: 'match', verdictNote: '**2026-09-07 Issue #430 で再判定。** `/api/ec-commerce/overview` と設定固定応答から通知定義・30日集計（96、148、32、132、20、96、88、74、51）を表示し、一覧の「LINE上で表示」と状態別画面を確認した。個人の開封値は契約どおり作らず、未取得表示も仕様内。1440/1920の全状態で横はみ出しはない。', verdictSource: 'line-notify-v6/festr-{normal,empty,error,forbidden}.txt + festr-normal-1920.png', verdictHead: '49484d5ab' },
  {
    ...LINE_NOTIFY, node: 'Q55bb', name: '24-1-A お知らせの中身を編集する',
    mode: 'viewport', height: 1136, /*
      **押し口は「内容を編集」。** 「発送した」は行の名前で、押せる役を持っていない
      （`role: 'text'` は ARIA に無く0件になる）。設計の並び順で3番目なので `nth: 2`。
    */
    steps: [{ click: '内容を編集', nth: 2, after: 800 }],
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #422 / HEAD e98decafa で1440・1920pxを再撮影。** 横はみ出し0。編集欄、差し込み項目、ボタン、LINEプレビュー、公開版と下書きの分離を確認した。新しい通知定義・送信テストAPIが固定データに無いため構造一致・データ待ち。",
    verdictSource: "line-notify-v6/Q55bb.txt",
    verdictHead: "e98decafa",
  },
  {
    ...LINE_NOTIFY, node: 'X8JCA5', name: '24-1-B 送れなかったもの',
    route: '/line-notifications?tab=failures', mode: 'page',
    states: { apis: ['**/api/line-notifications/deliveries?**', '**/api/ec-commerce/notification-runs?**'], kinds: ['normal', 'loading', 'empty', 'error'] },
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #430 で再判定。** `/api/line-notifications/deliveries` の固定行から失敗状態、試行3回、次回再試行日時、再試行ボタンを表示し、通常・読込・空・失敗の全状態を確認した。1440/1920とも横はみ出しはなく、契約にない到達数は追加していない。',
    verdictSource: 'line-notify-v6/X8JCA5-{normal,loading,empty,error}.txt + X8JCA5-normal-1920.png',
    verdictHead: '49484d5ab',
  },
  {
    /*
      **個人の既読を作らないことを見る。** 型（`EcNotificationRun`）に
      既読の欄はどこにも無く、あるのは `clickedAt`（短縮URLを押した時刻）だけ。
      固定データにも既読は入れていない。
    */
    ...LINE_NOTIFY, node: 'Se65i', name: '24-1-C お知らせの記録',
    route: '/line-notifications?tab=history', mode: 'page',
    states: { apis: ['**/api/line-notifications/deliveries?**', '**/api/ec-commerce/notification-runs?**'], kinds: ['normal', 'loading', 'empty', 'error'] },
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #430 で再判定。** 送信台帳の固定応答から受付・送信対象外・失敗、試行回数、次回再試行、短縮URLクリック時刻を表示し、通常・読込・空・失敗を確認した。個人の到達・既読は表示せず、契約どおり通知履歴だけを扱う。1440/1920とも横はみ出しはない。',
    verdictSource: 'line-notify-v6/Se65i-{normal,loading,empty,error}.txt + Se65i-normal-1920.png',
    verdictHead: '49484d5ab',
  },
  {
    ...LINE_NOTIFY, node: 'DpxOK', name: '24-2 運用者へのお知らせ',
    route: '/line-notifications?tab=operator', mode: 'page',
    states: { apis: ['**/api/notifications/rules?**', '**/api/notifications/rules'], kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'] },
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-06 PR #958（Issue #237）head `1a0a71ba` で設計と再比較。** 帯・作成導線・検索・絞り込み・表・CSV未接続の断りを維持。読込・通常・空・失敗・権限不足・絞込0件を data-list-state で名前付きにし、取得不能な数を0にしない。1440・1920の5状態、全12枚で横はみ出し0。送信処理と実行記録が未接続のため、構造一致・データ未接続を維持。',
    verdictSource: 'line-notify-v6/DpxOK-forbidden.txt + DpxOK-normal.txt',
    verdictHead: '1a0a71ba',
  },
  {
    ...LINE_NOTIFY, node: 'N2gAza', name: '24-2-A 運用者へのお知らせをつくる',
    route: '/line-notifications/operator/new', mode: 'page',
    verdict: 'structure_match_data_pending',
    verdictNote: '**2026-09-06 PR #958（Issue #237）head `1a0a71ba` で設計と再比較。** 「LINEログインを済ませた人にだけ届く」「担当が未設定だと届かない」「LINEにログインしていない人はメールへ切り替える」を先に明記。宛先・きっかけ・重要度・重複防止・注意・関連導線と、下書きだけ保存する安全な動きを1440・1920で確認し、横はみ出し0。スタッフ人数と送信プレビューは送信処理接続後のため、構造一致・データ未接続へ更新。',
    verdictSource: 'line-notify-v6/N2gAza.txt',
    verdictHead: '1a0a71ba',
  },

  // ── 機能25 オートメーション ─────────────────────────────
  /*
    設計のタブ帯は5本（動いているもの14／止めているもの4／動いた記録／
    見本12／共通アクション14）で、オートメーションと共通アクションが
    **同じ帯**に並ぶ。実装は `/automations` と `/common-actions` の別ページ。
  */
  { ...AUTOMATION, node: 'gief7', name: '25-1 オートメーション', route: '/automations', verdict: 'match', verdictNote: '**2026-09-07 Issue #377 / UI HEAD `bd900c36d` を3107/8794で再撮影し、★V6設計と同じ1920pxで比較。** 実API契約から18本（稼働14・停止4）、この30日8,420回・失敗6回・未実行3本、設計先頭6行の実行数と失敗表示、詳細導線を表示した。1440px・1920pxとも横はみ出し0で一致。', verdictSource: 'automations-v6/gief7.txt + automation-load-state-contract.test.ts', verdictHead: 'bd900c36d' },
  {
    ...AUTOMATION, node: 'Rv8Jv', name: '25-1-A オートメーションをつくる', route: '/automations/new',
    steps: [
      { click: 'タグが付いた・外れたとき' },
      { select: 'きっかけのタグ', label: '体験申込' },
      { select: '付いたとき・外れたとき', label: '付いたとき' },
      { fill: '#au-name', selector: true, text: '体験申込がついたらフォローを始める' },
      { select: '条件の軸', label: 'タグを持っていない' },
      { fill: '条件の値', text: '会員' },
      { select: '自動化で付けるタグ', label: '体験申込' },
      { click: '下書きに保存', after: 1000 },
      { fill: '1人テストの友だちID', text: 'friend-visual-1' },
    ],
    verdict: 'match', verdictNote: '**2026-09-07 Issue #438 / UI HEAD `e20d921b8` を固定ポート3105/8792で再撮影し、★V6設計と同じ1920pxで比較して一致を確認。** 6種のきっかけ、タグの付け外し、15軸の条件、処理、下書き保存、見込み人数286人、対象友だちを指定する1人テストを実API契約へ接続した。1440px・1920pxとも横はみ出し0。', verdictSource: 'automations-v6/Rv8Jv.txt + automation-create-v6-contract.test.ts', verdictHead: 'e20d921b8',
  },
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
    route: '/automations/runs',
    states: {
      apis: ['**/api/automation-runs*'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #438 / UI HEAD `e20d921b8` を固定ポート3105/8792で再撮影し、★V6設計と同じ1920pxで比較して一致を確認。** 4指標・7行の実行記録、対象、結果、失敗理由、実行詳細を実APIから表示する。失敗した処理だけを待機へ戻し、成功済み処理を二重実行しない安全な再実行を接続した。通常・読込中・0件・取得失敗の全10枚で横はみ出し0。',
    verdictSource: 'automations-v6/DkPY0-normal.txt + DkPY0-loading.txt + DkPY0-empty.txt + DkPY0-error.txt + automation-runs-v6-contract.test.ts',
    verdictHead: 'e20d921b8',
  },
  {
    ...AUTOMATION, node: 'WjYAC', name: '25-1-C 見本から作る',
    /*
      **#552 でタブ帯へ「見本」が入った。** `?tab=templates` で開く。
      見本は実データのIDを持たないので、固定データにも `tag-0` のような
      id は入れない（選んだ人が自分の環境のものを選び直す）。
    */
    route: '/automations?tab=templates', mode: 'page',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #299 / UI HEAD `380cd6631` を3105/8792で再撮影し、★V6設計と同じ1920pxで比較して一致を確認。** 見出し「見本から作る」、はじめから作る導線、5タブ、設計文の説明帯、実データ12件のうち先頭9件を3列×3段、きっかけ・すること・下書き作成導線で表示した。1440px・1920pxとも横はみ出し0。残り3件は続きとして扱い、カード密度を崩す絞り込み帯は通常面から外した。',
    verdictSource: 'automations-v6/WjYAC.txt',
    verdictHead: '380cd6631',
  },
  {
    ...AUTOMATION, node: 'Vdbv5', name: '25-1-D 一覧の状態（空・読込・エラー）',
    route: '/automations',
    states: { apis: ['**/api/automations*', '**/api/automations/**'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #238 / PR #989 / UI HEAD `44e671b2c` を3107/8794で通常・読込中・0件・取得失敗を再撮影し、設計の4状態と突き合わせて一致を維持。** 空は0本と作成導線、読込中は待機案内、取得失敗は登録済みルールが消えていない説明と再読込を表示し、未取得値を0にしない。全8枚で1440px・1920pxとも横はみ出し0。',
    verdictSource: 'automations-v6/Vdbv5.txt + Vdbv5-loading.txt + Vdbv5-empty.txt + Vdbv5-error.txt', verdictHead: '44e671b2c',
  },
  { ...AUTOMATION, node: 'xOpDs', name: '25-2 共通アクション', route: '/common-actions', verdict: 'match', verdictNote: '**2026-09-07 Issue #377 / UI HEAD `bd900c36d` を3107/8794で再撮影し、★V6設計と同じ1920pxで比較。** 実API契約から14件（公開11・下書き3）、呼び出し元38、今月2,847回・失敗6回、古い版2件・3か所を表示。5種の絞り込み、CSV、6行単位のAPIページ送りも接続し、1440px・1920pxとも横はみ出し0で一致。', verdictSource: 'automations-v6/xOpDs.txt + common-actions-v6-contract.test.ts', verdictHead: 'bd900c36d' },
  { ...AUTOMATION, node: 'py5CG', name: '25-2-A 共通アクションをつくる', route: '/common-actions/new', verdict: 'structure_match_data_pending', verdictNote: '**2026-09-07 Issue #438 / UI HEAD `e20d921b8` を固定ポート3105/8792で再撮影。** 名前・説明、処理順、失敗時設定、待ち時間、公開版を呼ぶ受け渡し、版の注意、下書き保存は1440px・1920pxで横はみ出し0。一覧の「複製して下書きを作る」も実APIへ接続した。正本 §4-7 は作成画面の操作を下書き保存だけと定め、条件分岐は接続契約で第2期（案）のまま、1人テストは保存後の公開版を03の一括操作から呼ぶ契約のため、設計例の押せるボタンを作らず構造一致・データ未接続とする。', verdictSource: 'automations-v6/py5CG.txt + common-actions-v6-contract.test.ts + v6-25-automation-requirements-draft.md §4-7', verdictHead: 'e20d921b8' },
  { ...AUTOMATION, node: 'syWp4', name: '25-2-B 共通アクションの版と使われている場所', route: '/common-actions/versions?id=ca-1', verdict: 'match', verdictNote: '**2026-09-07 Issue #377 / UI HEAD `bd900c36d` を3107/8794で再撮影し、★V6設計と同じ1920pxで比較。** 実API契約からv4〜v1、利用先5件・古い版1件、今月1,284回・失敗2回、実行中18件・待機中6件を表示。利用先を版履歴より先に置き、機能名・固定版・進行中件数を1行で読める形へそろえた。1440px・1920pxとも横はみ出し0で一致。', verdictSource: 'automations-v6/syWp4.txt + usage-summary.test.ts + common-actions-v6-contract.test.ts', verdictHead: 'bd900c36d' },

  // ── 機能26 外部連携 ─────────────────────────────────────
  /*
    設計のタブは4本（こちらから送る6／こちらで受け取る3／やり取りの記録／見本14）。
    4タブと通常・空・読込・エラーの共通枠は接続済み。
    接続別集計と受信本文の安全な見本は契約待ちのため、作り物を表示しない。
  */
  {
    ...WEBHOOK, node: 'k3WxrO', name: '26-1 外部連携',
    route: '/webhooks?tab=outgoing',
    verdict: 'structure_match_data_pending', verdictNote: '**2026-09-07 Issue #397 / UI HEAD `1010c7f11` を3106/8793で正式撮影し、設計 `k3WxrO` と同じ1920pxで横並び比較。** 4指標、説明帯、検索、状態・並び順、6列の一覧、ページ送りを同じ順に置き、送信先6本・受信口3本・この30日1,486回・失敗6回・受信486回を実APIから表示した。各接続も486・312・42・34・0回、直近結果、再送可否を実APIへ接続し、失敗したSlackだけ「失敗をやり直す」、ほかは「中身を見る」を出す。全URLは途中を伏せ、内部ID・合言葉・秘密値は表示しない。1440px・1920pxとも横はみ出し0。**残るデータ依存：設計の「1回試してみる」に対応するテスト送信APIが無いため、動く操作に見せず構造一致・データ未接続を維持する。**', verdictSource: 'webhooks-v6/k3WxrO.txt + webhooks-v6/k3WxrO-1920.png', verdictHead: '1010c7f11',
  },
  { ...WEBHOOK, node: 'M0Gb7', name: '26-1-A こちらで受け取る', route: '/webhooks?tab=incoming', verdict: 'structure_match_data_pending', verdictNote: '**2026-09-07 Issue #397 / UI HEAD `1010c7f11` を3106/8793で正式撮影し、設計 `M0Gb7` と同じ1920pxで横並び比較。** 選んだ受け取り口のURL、照合方法、見つからない場合、合言葉の状態、届いたらすること、マスク済み最新受信、差し込み項目、ほか2件、用語・関連先・注意を実APIへ接続した。最新受信の値はすべて `••••`、合言葉は「設定済み（再表示しません）」とし、内部の参照IDや秘密値は画面へ出さない。1440px・1920pxとも横はみ出し0。**残るデータ依存：APIが処理名を返さず、受信後のアクション実行器も `not_connected` のため、設計例のタグ名・テンプレート名を作らず「保存済みの設定」と未接続警告を表示する。**', verdictSource: 'webhooks-v6/M0Gb7.txt + webhooks-v6/M0Gb7-1920.png', verdictHead: '1010c7f11' },
    // ---- 2026-09-02 `a0bb3f44` で実装を読み直した ----
    // **「タブの言葉に内部の語が残る（受信 (Incoming)／送信 (Outgoing)）」は古い。**
    //   `webhook-operator-words-contract.test.ts:13-14` が `Incoming)` `Outgoing)` を
    //   出さないことを見張っており、`page.tsx` に0件。`k3WxrO` の注記のほうが正しい。
    // **P1「見本から作る道が無い」は実在した。** `sourceType` は自由入力で、
    //   手がかりは置き文字の `line` だけだった。見本（LINE公式アカウント／予約サービス／
    //   アンケートツール／ECサイト／決済サービス）から選ぶ形にして、その他は自由入力を残した。
    //   列見出しの「ソースタイプ」も「どこから来るか」にし、未設定の `-`（半角）を `—` にした。
    //   保存する値は今までどおりの文字列なので、口も保存の形も変えていない。
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
    verdict: 'match',
    verdictNote: '**2026-09-06 Issue #239 / PR #1005 / UI HEAD `eb86ea2df1` を3107/8794で通常・読込中・0件・取得失敗まで再撮影し、★V6設計と同じ1920pxで並べて一致を確認。** 4指標、失敗先、最長10秒、安全な送受信要約、7行の密度、絞り込み、再送、ページ送りがそろった。本文・URL・シークレットは設計の意図を保って一覧には出さない。全10枚で1440px・1920pxとも横はみ出し0。',
    verdictSource: 'webhooks-v6/KNG00-normal-1920.png + KNG00-loading.txt + KNG00-empty.txt + KNG00-error.txt',
    verdictHead: 'eb86ea2df1',
  },
  {
    ...WEBHOOK, node: 'f8SBSh', name: '26-1-C 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/webhooks/**'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'match', verdictNote: '**2026-09-07 Issue #303 / UI HEAD `d9eff7d7d` を3107/8794で通常・読込中・0件・取得失敗まで再撮影し、★V6設計と同じ1920pxで並べて一致を確認。** 4指標、説明帯、検索・絞り込み・並び順、ページ位置を共通枠に残し、表領域だけを各状態へ差し替えた。0件は作成導線、取得失敗は「登録内容は消えていない」説明と再読込を表示する。全8枚で1440px・1920pxとも横はみ出し0。',
    verdictSource: 'webhooks-v6/f8SBSh-loading.txt + f8SBSh-empty.txt + f8SBSh-error.txt', verdictHead: 'd9eff7d7d',
  },

  // ── 機能27 予約管理 ─────────────────────────────────────
  /*
    日・週の台帳は、固定予約を時間×担当／曜日の格子へ並べる。
    LINE予約は緑、LINE未連携の電話予約は青で同じ格子に載せる。
  */
  { ...BOOKING, node: 'TV2DI', name: '27-1 予約管理', verdict: 'match', verdictNote: '**2026-09-06、PR #TBD の実装を1440px・1920pxで撮影し、★V6設計と見比べた。** 時間（縦）×担当（横）の格子、LINE予約（緑）と電話予約（青）の同居、4つの集計、読み方の青帯、注意事項・今日の内訳・関連導線の右欄がそろった。固定データの予約件数と日付は撮影用データに従うが、情報の位置・余白・色・枠・角丸と操作の骨格は一致。両幅とも横はみ出し0。', verdictSource: 'booking-v6/TV2DI.txt', verdictHead: 'ed3e365aa' },
  {
    ...BOOKING, node: 'TnDbq', name: '27-1-A 予約の詳細',
    mode: 'viewport', height: 1136, /*
      **`role: 'text'` は当たらない。** ARIA にその役は無く
      `getByRole('text', …)` は0件になる。表の名前は桁なので `cell` で探す。
      `jwrbf`（16-1-E）と同じ直し。
    */
    steps: [
      { click: '一覧' },
      { click: '詳細', nth: 0 },
    ],
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #304 / PR #1095 / UI HEAD `ff26e0f1f` を3105/8792で再撮影。構造一致・顧客カルテ連携データ待ち。** 狭い引き出しを全面詳細へ広げ、予約内容、現在の履歴、予約で動いたこと、顧客・ペット、当日の注意、関連先、状態操作を設計位置へ配置した。1440px・1920pxとも横はみ出し0。予約一覧APIはペット・電話・タグ・マイル・過去予約・通知開封・前回申し送りを返さないため、推測せず「友だち情報で確認」と表示し一致扱いにしない。",
    verdictSource: "booking-v6/TnDbq.txt + TnDbq-{1440,1920}.png",
    verdictHead: "ff26e0f1f",
  },
  /*
    **判定を改めた（PR #459 head `ba0bf62d`）。** 代理予約の画面ができた
    （`/booking/bookings/new`）。ただし**LINEの友だちに限る**。
    「LINE未連携の電話客は、顧客台帳の受け皿ができるまで登録できません。」
  */
  { ...BOOKING, node: 'cpdDi', name: '27-1-B 電話の予約を入れる', route: '/booking/bookings/new',
    steps: [
      { fill: 'input[placeholder="名前・電話番号で探す"]', selector: true, text: '菅野', after: 900 },
      { click: '菅野 亮', after: 500 },
      { select: '予約メニュー', label: 'トリミング（小型犬）' },
      { select: '担当者', label: '佐々木' },
      { fill: '日付', text: '2026-09-03', after: 900 },
      { select: '空いている時間', label: '10:00〜11:45' },
    ],
    verdict: 'structure_match_data_pending', verdictNote: '**2026-09-07 Issue #421 で固定ポート3105/8792にて再撮影。** LINE友だち検索に加え、LINE未連携の電話客へ名前・電話番号・ペット名を入力し、確認時に顧客台帳へ保存して代理予約へ渡す経路を接続した。1440px・1920pxとも横はみ出し0。予約後の顧客カルテ項目や通知実績は別APIのため、構造一致・データ未接続と判定する。',
    verdictSource: 'booking-v6/cpdDi.txt', verdictHead: 'ed3e365aa',
  },
  { ...BOOKING, node: 'SbuUI', name: '27-1-C 今週の予約', steps: [{ click: '今週' }], verdict: 'match', verdictNote: '**2026-09-06、PR #TBD の実装を1440px・1920pxで撮影し、★V6設計と見比べた。** 時間（縦）×曜日（横）の週格子、LINE予約（緑）と電話予約（青）、4つの集計、読み方の青帯、注意事項・週の内訳・関連導線の右欄がそろった。固定データの予約件数と日付は撮影用データに従うが、情報の位置・余白・色・枠・角丸と操作の骨格は一致。両幅とも横はみ出し0。', verdictSource: 'booking-v6/SbuUI.txt', verdictHead: 'ed3e365aa' },
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
      { fill: 'input[placeholder="名前・電話番号で探す"]', selector: true, text: '菅野', after: 900 },
      { click: '菅野 亮', after: 500 },
      { select: '予約メニュー', label: 'トリミング（小型犬）' },
      { select: '担当者', label: '佐々木' },
      { fill: '日付', text: '2026-09-03', after: 900 },
      { select: '空いている時間', label: '10:00〜11:45' },
      { click: '予約内容を確認する', after: 700 },
    ],
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #421 で固定ポート3105/8792にて再撮影。** LINE友だち・電話客の顧客情報、予約内容、要望、通知予定、LINEプレビュー、注意、関連先、空き再確認を配置し、10:00〜11:45の枠で確認まで進めた。1440px・1920pxとも横はみ出し0。通知実績と顧客カルテの詳細は別APIのため構造一致・データ未接続と判定する。",
    verdictSource: "booking-v6/GFDqW.txt + GFDqW-{1440,1920}.png",
    verdictHead: "ff26e0f1f",
  },
  {
    ...BOOKING, node: 'GfceK', name: '27-1-E 代理予約・登録完了',
    route: '/booking/bookings/new', mode: 'page',
    steps: [
      { fill: 'input[placeholder="名前・電話番号で探す"]', selector: true, text: '菅野', after: 900 },
      { click: '菅野 亮', after: 500 },
      { select: '予約メニュー', label: 'トリミング（小型犬）' },
      { select: '担当者', label: '佐々木' },
      { fill: '日付', text: '2026-09-03', after: 900 },
      { select: '空いている時間', label: '10:00〜11:45' },
      { click: '予約内容を確認する', after: 700 },
      { click: 'この内容で予約を入れる', after: 1200 },
    ],
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #304 / PR #1095 / UI HEAD `ff26e0f1f` を3105/8792で再撮影。構造一致・通知実績データ待ち。** PR #1088の固定応答で実際に登録完了まで進み、返された予約ID・カレンダー状態、お客様・日時・メニュー・担当・受付方法、LINE処理開始、同じ予約台帳への記録、次の操作、LINEプレビューと関連先を表示した。1440px・1920pxとも横はみ出し0。登録結果APIは送信・開封実績、登録者、予定通知の実行結果、成果計上結果を返さないため、送信済みと作らず一致扱いにしない。",
    verdictSource: "booking-v6/GfceK.txt + GfceK-{1440,1920}.png",
    verdictHead: "ff26e0f1f",
  },
  {
    ...BOOKING, node: 'Lg8ff', name: '27-1-F 代理予約・予約枠の重なりと入力エラー',
    route: '/booking/bookings/new', mode: 'page',
    steps: [
      { fill: 'input[placeholder="名前・電話番号で探す"]', selector: true, text: '菅野', after: 900 },
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
        { fill: 'input[placeholder="名前・電話番号で探す"]', selector: true, text: '菅野', after: 900 },
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
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #304 / PR #1095 / UI HEAD `ff26e0f1f` を3105/8792で再撮影。構造一致・重複詳細データ待ち。** 実際のHTTP 409から赤い要約、保持した入力、選択日だけの空き候補、別担当の確認案内、注意、関連先を表示し、選び直した後は登録完了まで到達した。競合・回復を各1440px・1920pxで撮影し、全4枚とも横はみ出し0。エラーAPIは機械コードだけで、重複時間の範囲・件数・別担当の候補を返さないため、入力へ戻って確認と表示し一致扱いにしない。",
    verdictSource: "booking-v6/Lg8ff.txt + Lg8ff-recovered.txt + Lg8ff-{1440,1920}.png + Lg8ff-recovered-{1440,1920}.png",
    verdictHead: "ff26e0f1f",
  },

  // ── 機能28 予約設定 ─────────────────────────────────────
  /* 設計の4入口を同じ帯へ置き、受付枠・休業日は既存の勤務設定へつないだ。 */
  { ...BOOKING_SET, node: 'QSLEH', name: '28-1 予約設定', clock: '2026-08-26T00:00:00.000Z', verdict: 'match', verdictNote: '**2026-09-07 Issue #370 / UI HEAD `e1126c5c9` を3107/8794で再撮影し、★V6設計と一致。** PR #1107 の店舗設定と8件のメニューを実API契約で読み、4入口、出している6件・休止2件、最多メニュー、9:00〜19:00の受付時間、60日先までの受付範囲、設計順の6列表、担当者、料金、公開操作、ページ送りをそろえた。1440・1920pxとも横はみ出し0、内部語・壊れ値0件。', verdictSource: 'booking-settings-v6/QSLEH.txt + 2026-09-07 QSLEH 1440/1920px screenshots', verdictHead: 'e1126c5c9' },
  { ...BOOKING_SET, node: 'tksPc',
    clock: '2026-09-07T00:00:00.000Z',
    states: {
      apis: ['**/api/booking/admin/settings*', '**/api/booking/admin/menus*', '**/api/booking/admin/availability*'],
      kinds: ['normal', 'loading', 'error'],
    }, name: '28-1-A 受付枠と休業日', route: '/booking/staff/shifts',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #433 で実値を再判定。** #1198/#1188の固定応答を読み、曜日ごとの上限（3/3/休/3/4/2/2件）、顧客向け○・△・×・休、時間帯の「残り1/2・0/2」、休業日、設備A/Bを画面で確認した。通常・読込中・失敗を1440/1920で再撮影し、全8枚で横はみ出し0。",
    verdictSource: "booking-settings-v6/tksPc-{normal,loading,error}.txt + tksPc-{normal,loading,error}-{1440,1920}.png",
    verdictHead: "58989eeaa",
  },
  { ...BOOKING_SET, node: 'GhOb3', name: '28-1-B 予約メニューをつくる', route: '/booking/menus/new',
    variants: [{ suffix: '-pencil-input', steps: [
      { fill: 'メニュー名', text: 'トリミング（小型犬）' },
      { fill: '所要時間（分）', text: '105' },
      { fill: '料金', text: '8400' },
      { fill: '分類', text: 'トリミング' },
      { fill: '説明', text: 'カット・シャンプー・爪切り・耳そうじが入ります。' },
    ] }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #433 で入力例を入力後に再判定。** #1184の`variant=\"v6\"`骨格で番号付き5節、右側プレビュー・注意、下部固定アクションを確認した。撮影時にメニュー名「トリミング（小型犬）」、105分、¥8,400、分類「トリミング」、説明文を実際に入力し、1440/1920の変種画像で一致・横はみ出し0を確認した。",
    verdictSource: "booking-settings-v6/GhOb3.txt + GhOb3-pencil-input-{1440,1920}.png + 2026-09-07 visual comparison",
    verdictHead: "58989eeaa",
  },
  {
    ...BOOKING_SET, node: 'W6465r', name: '28-1-C 一覧の状態（空・読込・エラー）',
    /* `**' + '/api/booking/admin/menus*` は `/menus/:id/staff` に届かない（`*` は `/` をまたがない）。この画面は呼ばないが、呼ぶようになったとき静かに素通りするのを防ぐ。 */
    clock: '2026-08-26T00:00:00.000Z',
    states: { apis: ['**/api/booking/admin/settings*', '**/api/booking/admin/menus*', '**/api/booking/admin/menus/**', '**/api/booking/admin/staff*'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'match', verdictNote: '**2026-09-07 Issue #370 / UI HEAD `e1126c5c9` を3107/8794で通常・読込中・空・失敗まで再撮影し、★V6設計と一致。** 4入口と4指標を同じ位置に保ち、読込中・失敗は未取得の —、空はメニュー0件と設定未取得を言い分けた。空の返事でも画面全体を落とさず作成誘導を出し、失敗時だけ再読込を出す。通常を含む4状態を1440・1920pxで撮影し、全8枚で横はみ出し0、内部語・壊れ値0件。',
    verdictSource: 'booking-settings-v6/W6465r.txt + W6465r-{loading,empty,error}.txt + 2026-09-07 normal/loading/empty/error 1440/1920px screenshots', verdictHead: 'e1126c5c9',
  },

  // ── 機能29 イベント予約 ─────────────────────────────────
  {
    ...EVENT,
    node: 'ugP5y',
    name: '29-1 イベント予約',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #403 / PR #1176 で実APIの自動繰上げ取り込み後に再撮影し、一致。** #351 / PR #1168 の席解放・案内期限切れを再試行台帳へ積む処理と、定期処理から先頭のキャンセル待ちへ期限付き案内する処理を確認した。これにより、前回唯一出せなかった青い自動化案内を設計と同じ位置・文言で表示した。3102/8789 の1440px・1920pxはいずれも横はみ出し0。一覧、4つの判断帯、検索、並び順、絞り込み、行操作に後退なし。設計との差分として検出される人数・日付・店舗名は撮影用固定データの値で、画面構造の差ではない。',
    verdictSource: 'events-v6/ugP5y.txt + ugP5y-{1440,1920}.png + apps/worker/src/services/event-waitlist.ts',
    verdictHead: 'ea4284f42',
  },
  { ...EVENT, node: 'MKrPY', name: '29-1-A イベントをつくる', route: '/events/new', verdict: 'match', verdictNote: '**2026-09-06 Issue #242 / PR #1015 / UI HEAD c31b32f90 を3105/8792で最終照合して一致。** 概要と同じ画面で最初の開催日・開始・所要時間・定員を入力し、イベント本体と予約枠を続けて保存する。右側に入力連動のLINEプレビュー、満席時のキャンセル待ち、承認制、前日通知を配置した。保存途中で枠だけ失敗してもイベントを重複作成しない。1440・1920pxとも横スクロール0。', verdictSource: 'events-v6/MKrPY.txt + 2026-09-06 1440/1920px screenshots', verdictHead: 'c31b32f90' },
  {
    /*
      **#593 で拒否とキャンセルの窓が入った。**押し口は `data-qa-open` で
      開ける（文言に頼らない）。通常・読込・空・失敗と、2つの窓を撮る。
    */
    ...EVENT, node: 'i5SN2j', name: '29-1-B 申込者の一覧', route: '/events/bookings?id=ev-1',
    states: {
      apis: ['**/api/events/admin/events*', '**/api/events/admin/events/**'],
      kinds: ['normal', 'loading', 'empty', 'error'],
    },
    variants: [
      { suffix: '-reject', steps: [{ qaOpen: 'i5SN2j-reject', after: 900 }] },
      /* 運営キャンセルは確定の行にしか出ないので、先に札を切り替える。 */
      { suffix: '-cancel', steps: [{ click: '確定', after: 800 }, { qaOpen: 'i5SN2j-cancel', after: 900 }] },
    ],
    verdict: 'match', verdictNote: '**2026-09-07 Issue #371 / 統合 #1110 の固定データを3105/8792で再撮影し一致判定。** 承認待ちの申込者、申込日時、予約枠、同伴ペット、初回来店、状態と操作を1行で確認し、以前不足していた拒否ダイアログも撮影できた。通常・読込・空・失敗・拒否・運営キャンセルの全14枚を撮り分け、1440・1920pxとも横はみ出し0。日時欠落は Invalid Date にせず未取得と表示し、拒否理由は内部記録、運営キャンセルはLINE通知とリマインダ停止を事前確認できる。', verdictSource: 'events-v6/i5SN2j-normal.txt + events-v6/i5SN2j-reject.txt + events-v6/i5SN2j-cancel.txt + 2026-09-07 screenshots', verdictHead: '9889bca8b',
  },
  {
    ...EVENT, node: 'k5m5Bc', name: '29-1-C 一覧の状態（空・読込・エラー）',
    states: { apis: ['**/api/events/admin/events*', '**/api/events/admin/events/**'], kinds: ['loading', 'empty', 'error'] },
    verdict: 'match', verdictNote: '**2026-09-06 Issue #242 / PR #1015 / UI HEAD c31b32f90 を3105/8792で最終照合して一致。** 通常・読込・空・失敗を1440・1920pxで撮影し、全状態で横スクロール0。読込・失敗では4つの帯を — にし、空では数えて0と未取得を分けた。失敗時は空の作成誘導を出さず、再読込を案内する。内部語、Invalid Date、API error、Failed to fetchは0件。',
    verdictSource: 'events-v6/k5m5Bc-error.txt + k5m5Bc-empty.txt', verdictHead: 'c31b32f90',
  },

  // ── 機能30 ログインユーザー ─────────────────────────────
  {
    ...STAFF, node: 'e3jz3', name: '30-1 ログインユーザー',
    states: { apis: ['**/api/access/users*', '**/api/access/roles*'], kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'] },
    verdict: "match",
    verdictNote: "**2026-09-07 #425 / 3101・8788で固定行追加後に再撮影・再判定。** access/users・access/roles の機能30固定契約へ職位、役割bundle、担当範囲、機能別権限を追加し、通常・読込・空・失敗・権限不足を1440/1920px撮影。1ページ6行、ページ送り、役割・職位・担当範囲・最終ログイン・二段階認証、確認が必要な注意札を表示し、横はみ出し0。設計の表示項目と固定契約の値が一致する。",
    verdictSource: "staff-v6/e3jz3.png + staff-v6/e3jz3-{normal,loading,empty,error,forbidden}.txt + 2026-09-07 visual comparison",
    verdictHead: "5c9238525",
  },
  {
    ...STAFF, node: 'EOTS4', name: '30-1-A 見せる範囲を決める',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #434 / 3101・8788で再撮影・再判定。** `access/roles` の機能30固定行を読み、管理者・運用・見るだけの3役割を横に、対象機能を縦に並べ、編集・閲覧・対象外を比較できる表として表示した。個人通知は比較表から分離し、ユーザー編集側へ残した。1440/1920pxとも対象画面へ到達し、横はみ出し0。',
    verdictSource: 'staff-v6/EOTS4.txt + staff-v6/EOTS4-{1440,1920}.png + 2026-09-07 visual comparison',
    mode: 'viewport', height: 1080, /*
      **行の押し口は「範囲を編集」。** 人の名前は文字で、押せる役を持っていない。
      名前で探していたので、固定データを足したあとも0件のままだった
      （`page.tsx:142` の行末が `範囲を編集`）。
    */
    steps: [{ wait: 1500 }, { qaOpen: 'EOTS4' }],
    verdictHead: '54f1910a7',
  },
  { ...STAFF, node: 'jwVlo', name: '30-1-B 入った記録', route: '/staff?tab=audit',
    states: { apis: ['**/api/audit/events*'], kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'] },
    verdict: "match",
    verdictNote: "**2026-09-07 #425 / 3101・8788で再撮影・再判定。** 通常・読込・空・失敗・権限不足を1440/1920pxで撮影し、横はみ出し0。監査イベント契約へ `regionLabel` を追加し、既知のIP接頭辞は地域名、契約が地域を返さない場合は「—」として確定した。各行に詳細ボタンを追加し、変更前後・対象・場所を確認できる。位置情報を推測していないため、契約値と表示が一致する。",
    verdictSource: "staff-v6/jwVlo.png + staff-v6/jwVlo-{normal,loading,empty,error,forbidden}.txt + 2026-09-07 visual comparison",
    verdictHead: "5c9238525",
  },
  {
    ...STAFF, node: 'I3ZSrU', name: '30-1-C 人を招待する', route: '/staff/new',
    verdict: 'match',
    verdictNote: '**2026-09-07 Issue #434 / 3101・8788で再撮影・再判定。** 認証済みセッションのまま `/staff/new` へ到達し、ログイン画面へ戻らないことを確認した。名前・メールアドレス・役割・最初に表示するLINEアカウント・スタッフの機能別担当範囲・通知先と、追加後の流れを表示。1440/1920pxとも横はみ出し0。',
    verdictSource: 'staff-v6/I3ZSrU.txt + staff-v6/I3ZSrU-{1440,1920}.png + 2026-09-07 visual comparison',
    verdictHead: '54f1910a7',
  },

  // ── 機能31 機能設定 ─────────────────────────────────────
  { ...FEATURE_SET, node: 'c4R6F', name: '31-1 機能設定',
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #422 / HEAD e98decafa で1440・1920pxを再撮影。** 横はみ出し0。説明、必須表示、切替、並び替え、初期値復元、利用中/作成数を確認した。一部利用数が未取得のため構造一致・データ待ち。",
    verdictSource: "settings-v6/c4R6F.txt",
    verdictHead: "e98decafa",
  },

  // ── 機能32 運用状態 ─────────────────────────────────────
  /* タブ3本は設計とそろっている（健全性チェック／緊急コントロール／更新履歴）。 */
  { ...OPERATIONS, node: 'UgonK', name: '32-1 運用状態・健全性チェック', route: '/emergency?tab=health',
    verdict: "match",
    verdictNote: "**2026-09-07、Issue #387・`88912c59c3` を固定ポート3105/8792で1440・1920撮影し、設計と目視比較して一致。** 6列、次回確認時刻、判定の見方4種を設計の情報順で表示。サーバー保存の健全性結果と観測時刻を読み、古い結果を未確認にし、手動確認も同じ契約へ保存する。両幅とも横はみ出し0。",
    verdictSource: "operations-v6/UgonK.txt + operations-v6/UgonK-{1440,1920}.png + 2026-09-07 visual comparison",
    verdictHead: "88912c59c3",
  },
  {
    /* 通常・読込・失敗を見る。**下見が取れないと停止を押せないはず**。 */
    ...OPERATIONS, node: 'b3HfZ', name: '32-1-A 緊急コントロール', route: '/emergency?tab=control',
    states: { apis: ['**/api/operations/control/preview*'], kinds: ['normal', 'loading', 'error'] },
    verdict: "match",
    verdictNote: "**2026-09-07、Issue #387・`88912c59c3` の通常・読込・失敗を固定ポート3105/8792で1440・1920撮影し、設計と目視比較して一致。** サーバーの下見値で件数・人数・理由・アカウント・補足・復旧を表示し、取得失敗は0件にせず操作不可。停止・復旧は操作専用の6桁本人確認、重複防止、版番号確認を通し、ログインユーザーへのLINE・メール通知もサーバー契約へ接続した。全状態・両幅とも横はみ出し0。",
    verdictSource: "operations-v6/b3HfZ-normal.txt + operations-v6/b3HfZ-loading.txt + operations-v6/b3HfZ-error.txt + operations-v6/b3HfZ-*-{1440,1920}.png + 2026-09-07 visual comparison",
    verdictHead: "88912c59c3",
  },
  { ...OPERATIONS, node: 'UhC2O', name: '32-1-B 更新履歴', route: '/emergency?tab=history',
    verdict: "match",
    verdictNote: "**2026-09-07、Issue #387・`88912c59c3` を固定ポート3105/8792で1440・1920撮影し、設計と目視比較して一致。** サーバーが保存した停止・復旧と管理画面更新を統合履歴から読み、期間、CSV、4つの概要、停止記録と更新履歴の2表、右欄を設計の構造で表示する。反映時間・停止時間・移行内容を含む配備記録も同じ履歴へ接続済み。両幅とも横はみ出し0。",
    verdictSource: "operations-v6/UhC2O.txt + operations-v6/UhC2O-{1440,1920}.png + 2026-09-07 visual comparison",
    verdictHead: "88912c59c3",
  },
  {
    ...OPERATIONS, node: 'U0BwS', name: '32-1-C 緊急停止の最終確認',
    route: '/emergency?tab=control', mode: 'viewport', height: 1136,
    /*
      **停止するものを1つ選んでから押す。** 何も選ばずに押すと
      「停止する配信を1つ以上選んでください」で窓が開かない
      （`emergency/page.tsx:361`）。
    */
    steps: [{ click: '緊急停止する', after: 900 }],
    verdict: "match",
    verdictNote: "**2026-09-07、Issue #387・`88912c59c3` の最終確認を固定ポート3105/8792で1440・1920撮影し、設計と目視比較して一致。** 下見と同じ件数・人数、アカウント、対象、理由、止まらないもの、取り消せない配信を表示。「停止」入力後に操作専用の6桁本人確認を行い、重複防止キーと版番号を付けて停止する。ログインユーザーへのLINE・メール通知も実送信契約へ接続済み。両幅とも横はみ出し0。",
    verdictSource: "operations-v6/U0BwS.txt + operations-v6/U0BwS-{1440,1920}.png + 2026-09-07 visual comparison",
    verdictHead: "88912c59c3",
  },

  // ── 機能4 友だち属性（PR #402 で比較した残り10枚を台帳へ統合） ──
  /*
    タグ・情報欄・対応マーク・保存した検索は `/tags` の4タブ。
    CSV取り込みの4枚は、ファイルを選ばせる必要があるので
    `capture.spec.mjs` が撮っている（`tags-csv-*`）。
  */
  { node: 'hqrOv', feature: 4, name: '4-1 友だち属性・タグ', dir: 'friend-attributes-v6', route: '/tags', mode: 'page',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #297で修正・再判定。** 一致。4指標、4タブ、フォルダ帯、3絞り込み、5つのよく使う条件、10列の一覧、ページ送りを設計順に表示した。設計の先頭6行と101件の固定データで確認し、1440・1920pxとも横はみ出し0。",
    verdictSource: "friend-attributes-v6/hqrOv.txt + friend-attributes-v6/hqrOv-{1440,1920}.png",
  },
  {
    node: 'dKlkz', feature: 4, name: '4-1-F タグ削除の確認ダイアログ',
    dir: 'friend-attributes-v6', route: '/tags', mode: 'viewport', height: 1080,
    steps: [{ click: 'NEN会員 を削除', scope: 'main' }],
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #330で実API接続後に再判定。** 構造・表示データ一致、実行API待ち。固定タグの128人、マイル連動、5件の参照先、版を実APIから表示し、削除前の影響確認を設計順に再現した。タグを保管・削除する更新APIが無いため、事故防止のため確定操作は無効のままにしている。2幅とも横はみ出し0。",
    verdictSource: "friend-attributes-v6/dKlkz.txt + friend-attributes-v6/dKlkz-{1440,1920}.png + 2026-09-07同一状態比較",
    verdictHead: "5959c1756",
  },
  {
    node: 'H374MR', feature: 4, name: '4-1-H タグCSV一括登録',
    dir: 'friend-attributes-v6', route: '/tags', mode: 'page',
    status: 'elsewhere', shots: 'tags-csv-select',
    why: 'ファイルを選ばせる操作が要る。`capture.spec.mjs` の `tags-csv-select` が撮っている',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #297で修正・再判定。** 一致。CSV選択、UTF-8・500件上限、確認してから登録する説明、未分類の扱い、取消・確認を同じダイアログに配置した。専用Playwrightで1440・1920pxを撮影し、横はみ出し0。",
    verdictSource: "friend-attributes-v6/H374MR.txt + H374MR-{1440,1920}.png",
  },
  {
    node: 'sfTEW', feature: 4, name: '4-1-H-A CSV取り込み・確認（dry-run）',
    dir: 'friend-attributes-v6', route: '/tags', mode: 'page',
    status: 'elsewhere', shots: 'tags-csv-preview',
    why: '同上。`tags-csv-preview` が撮っている',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #328で修正・再判定。** 一致。CSV名、4件数、状態絞り込み、代表5行、行別の扱いと理由、部分登録の注意、取消・登録を設計順に表示した。件数はAPI応答で変わるため、固定データの500行・作成404・飛ばす73・エラー23で照合した。1440・1920pxとも横はみ出し0、壊れた値0。",
    verdictSource: "friend-attributes-v6/sfTEW.txt + friend-attributes-v6/sfTEW-{1440,1920}.png",
  },
  {
    node: 'op1rh', feature: 4, name: '4-1-H-B CSV取り込み・完了',
    dir: 'friend-attributes-v6', route: '/tags', mode: 'page',
    status: 'elsewhere', shots: 'tags-csv-success',
    why: '同上。`tags-csv-success` が撮っている',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #328で修正・再判定。** 一致。完了の緑帯、登録404件、フォルダ別内訳（VIP120・会員200・未分類84）、飛ばした73件、一覧へ戻る操作を設計順に表示した。1440・1920pxとも横はみ出し0、壊れた値0。",
    verdictSource: "friend-attributes-v6/op1rh.txt + friend-attributes-v6/op1rh-{1440,1920}.png",
  },
  {
    node: 'QzRsJ', feature: 4, name: '4-1-H-C CSV取り込み・一部失敗',
    dir: 'friend-attributes-v6', route: '/tags', mode: 'page',
    status: 'elsewhere', shots: 'tags-csv-partial',
    why: '同上。`tags-csv-partial` が撮っている',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #328で修正・再判定。** 一致。部分失敗の黄帯、登録404件・未登録23件、代表5行の異なる理由、失敗行CSV、一覧へ戻る操作を設計順に表示した。フォルダ名は失敗CSVへ残し、画面表は設計どおり行・タグ名・理由の3列に絞った。1440・1920pxとも横はみ出し0、壊れた値0。",
    verdictSource: "friend-attributes-v6/QzRsJ.txt + friend-attributes-v6/QzRsJ-{1440,1920}.png",
  },
  { node: 'HBTk0', feature: 4, name: '4-2 友だち情報欄', dir: 'friend-attributes-v6', route: '/tags?tab=fields', mode: 'page',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #330で実API接続後に再判定。** 一致。全12件・入力済み187人・回答フォーム6件・表示先3か所の指標と、項目名、差し込み名、種類、入力人数、フォーム、表示先、操作を実APIから表示した。2幅とも横はみ出し0。",
    verdictSource: "friend-attributes-v6/HBTk0.txt + friend-attributes-v6/HBTk0-{1440,1920}.png + 2026-09-07同一状態比較",
    verdictHead: "5959c1756",
  },
  {
    node: 'yKEdO', feature: 4, name: '4-2-C 一覧の状態（空・読込・エラー）',
    dir: 'friend-attributes-v6', route: '/tags?tab=fields', mode: 'page',
    states: { apis: ['**/api/friend-fields*', '**/api/list-stats*'], kinds: ['loading', 'empty', 'error'] },
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #297で修正・再判定。** 一致。読込中・0件・取得失敗を別々に描き、取得失敗を0件として扱わない。失敗時だけ再読み込み、作成可能な0件時だけ作成導線を表示した。3状態を1440・1920pxで撮影し、全状態で横はみ出し0。",
    verdictSource: "friend-attributes-v6/yKEdO-{loading,empty,error}.txt + 同名-{1440,1920}.png",
  },
  { node: 'rIhbN', feature: 4, name: '4-3 対応マーク', dir: 'friend-attributes-v6', route: '/tags?tab=marks', mode: 'page',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #330で実API接続後に再判定。** 一致。全4件、初期値、未割り当て人数、使用中ルール数、4行の人数・自動変更・表示先・操作を実APIから表示した。2幅とも横はみ出し0。",
    verdictSource: "friend-attributes-v6/rIhbN.txt + friend-attributes-v6/rIhbN-{1440,1920}.png + 2026-09-07同一状態比較",
    verdictHead: "5959c1756",
  },
  { node: 'QKx8Q', feature: 4, name: '4-4 保存した検索', dir: 'friend-attributes-v6', route: '/tags?tab=searches', mode: 'page',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #330で実API接続後に再判定。** 一致。全12件、配信使用中5件、共有2件、今月84回、5行の条件・該当人数・共有・使用先・作成者日時・操作を実APIから表示した。2幅とも横はみ出し0。",
    verdictSource: "friend-attributes-v6/QKx8Q.txt + friend-attributes-v6/QKx8Q-{1440,1920}.png + 2026-09-07同一状態比較",
    verdictHead: "5959c1756",
  },

  // ── 機能4 友だち属性 ─────────────────────────────────────
  // 一覧・状態・削除・CSVは `capture.spec.mjs` で基準画像として撮っている。
  // ここには、設計と並べるために撮るものだけを置く。
  {
    node: 'l25rlp', feature: 4, name: '4-1-A タグを作る・初期状態',
    dir: 'friend-attributes-v6', route: '/tags/new', mode: 'page',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #297で修正・再判定。** 一致。タグの所属・名前・一覧表示、自動付与、マイルと連動の説明、既存友だちへの反映、右側の要約と保存操作を同じ段組みで表示した。保存操作は共通ルールどおり下部の安全な帯に置く。2幅とも横はみ出し0。",
    verdictSource: "friend-attributes-v6/l25rlp.txt + friend-attributes-v6/l25rlp-{1440,1920}.png",
  },
  {
    node: 'tP0RW', feature: 4, name: '4-1-B タグを作る・連動ON',
    dir: 'friend-attributes-v6', route: '/tags/new?copy=tag-0', mode: 'page',
    steps: [{ fill: 'タグ名', text: 'NEN会員（定期）' }, { click: 'タグ連動', role: 'switch', onlyIfOff: true }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #330で実API接続後に再判定。** 一致。固定タグを複製し、購入フォルダ、NEN会員（定期）、本人10mile、紹介者5mile、1.5倍・優先度3、3件の連動アクションと右側4項目の要約を同じ状態で表示した。2幅とも横はみ出し0。",
    verdictSource: "friend-attributes-v6/tP0RW.txt + friend-attributes-v6/tP0RW-{1440,1920}.png + 2026-09-07同一状態比較",
    verdictHead: "5959c1756",
  },
  {
    node: 'LfrQs', feature: 4, name: '4-1-C 連動アクション追加ドロワー',
    dir: 'friend-attributes-v6', route: '/tags/new?copy=tag-0&reference=1', mode: 'viewport', height: 1320,
    steps: [{ fill: 'タグ名', text: 'NEN会員（定期）' }, { click: 'タグ連動', role: 'switch', onlyIfOff: true }, { click: '＋ アクションを追加' }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #430 / #1194 の固定応答で再判定。** 「NEN会員（定期）」のテキスト送信・タグ追加・シナリオ開始、即時/24時間後、本人+10・紹介者+5・1.5倍を読み、追加ドロワーと要約を確認した。1440/1920とも横スクロールはない。",
    verdictSource: "friend-attributes-v6/LfrQs.txt",
    verdictHead: "49484d5ab",
  },
  {
    node: 'ee0sk', feature: 4, name: '4-1-D タグを編集・既存設定あり',
    dir: 'friend-attributes-v6', route: '/tags/edit?id=tag-0', mode: 'page',
    steps: [{ click: '遡及反映', role: 'switch', onlyIfOff: true }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #330で実API接続後に再判定。** 一致。既存タグの128人・紹介者34人、本人10mile、紹介者5mile、1.5倍・優先度3、3件の連動アクション、既存友だちへの遡及反映と右側4項目の要約を実APIから同じ状態で表示した。2幅とも横はみ出し0。",
    verdictSource: "friend-attributes-v6/ee0sk.txt + friend-attributes-v6/ee0sk-{1440,1920}.png + 2026-09-07同一状態比較",
    verdictHead: "5959c1756",
  },
  {
    node: 'VjXGX', feature: 4, name: '4-1-E 遡及反映の確認ダイアログ',
    dir: 'friend-attributes-v6', route: '/tags/edit?id=tag-0', mode: 'viewport', height: 1590,
    steps: [{ click: '遡及反映', role: 'switch', onlyIfOff: true }, { click: 'タグを保存' }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #297で修正・再判定。** 一致。設計と同じNEN会員（定期）の対象128人、紹介者34人、本人1,280mile、紹介者170mile、合計1,450mile、倍率、アクション、取り消せない注意、確認チェック、2つの保存方法を表示した。固定データ取り込み後に2幅で再比較し、横はみ出し0。",
    verdictSource: "friend-attributes-v6/VjXGX.txt + friend-attributes-v6/VjXGX-{1440,1920}.png",
  },
  {
    node: 'byqIW', feature: 4, name: '4-1-G 属性フォルダを追加・色編集',
    dir: 'friend-attributes-v6', route: '/tags/folders/new?id=g-purchase', mode: 'page',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #328で修正・再判定。** 一致。「お問い合わせフォロー」の名前、保存済みの紫、8色と選択中表示、一覧プレビュー、追加・編集共用の案内、削除・取消・保存を設計と同じ編集窓に配置した。色はAPIの保存値を表示する可変項目。1440・1920pxとも横はみ出し0、壊れた値0。",
    verdictSource: "friend-attributes-v6/byqIW.txt + friend-attributes-v6/byqIW-{1440,1920}.png",
  },
  {
    node: 'A1ZYeP', feature: 4, name: '4-2-A 友だち情報欄の項目を追加',
    dir: 'friend-attributes-v6', route: '/tags/fields/new', mode: 'page',
    steps: [
      { fill: 'input[placeholder="例：愛犬のお名前"]', selector: true, text: '愛犬のお名前' },
      { fill: 'input[placeholder="pet_name"]', selector: true, text: 'pet_name' },
    ],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #430 / #1194 の固定応答で再判定。** 「ペットプロフィール」フォルダと、1行・複数行・数値・日付・日時・選択・真偽・URL・電話・メール・画像・PDFの13種類、例示プレースホルダーをフォームで確認した。1440/1920とも横スクロールはない。",
    verdictSource: "friend-attributes-v6/A1ZYeP-1920.png",
    verdictHead: "49484d5ab",
  },
  {
    /*
      **#420（head `87c150ad`）で `/tags/fields/migrate` が入った。**
      使用中の項目（`usageCount > 0`）の行にだけ「移行」が出る
      （`field-list.tsx:143`）。使っていない項目は消せるので出ない。
    */
    node: 'KoT6c', feature: 4, name: '4-2-B 友だち情報欄・項目移行',
    dir: 'friend-attributes-v6', route: '/tags/fields/migrate?id=field-birthday', mode: 'page',
    steps: [{ click: '事前確認する' }],
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #430 / #1194 の固定応答で再判定。** 移行元/移行先、13種類、差し込み名、事前確認の注意書きを確認した。固定応答のプレビューは値あり141人・そのまま137人・要確認3人・空欄1人で、設計の確認導線と一致する。1440/1920とも横スクロールはない。",
    verdictSource: "friend-attributes-v6/KoT6c.txt",
    verdictHead: "49484d5ab",
  },
  {
    node: 'GMvBd', feature: 4, name: '4-3-A 対応マークを追加・編集',
    /*
      **マークの設定は専用の画面へ移った**（`/tags/marks/edit?id=`）。
      前は一覧で「保留」を押して撮っていたが、いま一覧の名前は編集画面への
      入口で、設計 `GMvBd` の印（`data-design-node`）も編集画面が持つ。
      直接そこを開く。押して辿ると、一覧の固定データ次第で撮れなくなる。
      設計は名前・色・並び順・初期値と自動変更ルールを同じ面で扱う。
    */
    dir: 'friend-attributes-v6', route: '/tags/marks/edit?id=mark-hold', mode: 'page',
    states: {
      apis: ['**/api/support-marks/*/automation-rules**'],
      kinds: ['normal', 'loading', 'empty', 'error', 'forbidden'],
    },
    variants: [
      {
        // 版競合。**押して初めて出る失敗**なので、読み込みは素通しにする。
        suffix: 'conflict',
        state: { apis: ['**/api/support-marks/**/automation-rules**', '**/api/support-mark-rules/**'], kind: 'conflict' },
        steps: [
          { qaOpen: 'GMvBd' },
          { fill: 'ルールの名前', text: '期限を過ぎたら確認待ちへ' },
          { qaOpen: 'GMvBd-save' },
        ],
      },
    ],
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #330で実API接続後に再判定。** 構造一致・同一状態契約待ち。基本情報、自動変更ルール、使用先、優先順位、手動変更後の保護時間を実APIへ接続し、通常・読込・0件・失敗・権限不足・競合を確認した。設計は新規作成、現在のルールAPIは作成済みmarkId必須のため実装画像は編集状態で、同一状態の値だけ未照合。全状態2幅で横はみ出し0。",
    verdictSource: "friend-attributes-v6/GMvBd-{normal,loading,empty,error,forbidden,conflict}.txt + 同名-{1440,1920}.png",
    verdictHead: "5959c1756",
  },
  {
    node: 'zGZMA', feature: 4, name: '4-3-B 対応マーク削除の確認ダイアログ',
    dir: 'friend-attributes-v6', route: '/tags?tab=marks', mode: 'viewport', height: 1080,
    /*
      **設計は「削除」、実装は「保管」。** 設計 `zGZMA` は
      「対応マーク削除の確認ダイアログ」だが、実装の行の操作は
      「対応中を保管」で、消さずにしまう作りになっている。
      撮るために実装の言葉へ合わせたが、**どちらが正しいかは
      決着していない**（消すのか、しまうのか）。要判断として残す。
    */
    steps: [{ click: '保留を保管', scope: 'main' }],
    verdict: "structure_match_data_pending",
    verdictNote: "**2026-09-07 Issue #330で実API接続後に再判定。** 構造・影響データ一致、操作差あり。保留3人、利用ルール、表示先、置換先、履歴保持、取消・保管を実APIから表示した。設計の物理削除に対し、現行要件とAPIは履歴を残す保管なので、安全側の操作差を維持している。2幅とも横はみ出し0。",
    verdictSource: "friend-attributes-v6/zGZMA.txt + friend-attributes-v6/zGZMA-{1440,1920}.png + 2026-09-07同一状態比較",
    verdictHead: "5959c1756",
  },
  {
    /* **#421（head `71aff344`）で `/tags/searches/edit` が入った。** */
    node: 'XBkiQ', feature: 4, name: '4-4-A 保存した検索の条件確認・編集',
    dir: 'friend-attributes-v6', route: '/tags/searches/edit?id=ss-1', mode: 'page',
    verdict: "match",
    verdictNote: "**2026-09-07 Issue #330で実API接続後に再判定。** 一致。固定の保存条件を読み、名前・説明・共有範囲、AND・OR条件、該当18人、LINE15人・MAIL3人、3件の使用先、一覧表示、削除・取消・保存を実APIから表示した。2幅とも横はみ出し0。",
    verdictSource: "friend-attributes-v6/XBkiQ.txt + friend-attributes-v6/XBkiQ-{1440,1920}.png + 2026-09-07同一状態比較",
    verdictHead: "5959c1756",
  },

  // ── pen から届いた新画面（台帳 kentavndng/line-harness-board#18） ──────────

  {
    /*
      §7 #6「CSV操作の専用画面」。3-4 UID移行（`vtBCu`）と同じ束で、
      移行そのものの口がまだ無い。
    */
    node: 'ux7of', feature: 3, name: '3-4-A UID・顧客データ移行／CSV',
    dir: 'friends-v6', route: '/friends/migrations', mode: 'page',
    verdict: 'unjudged',
    verdictNote: '**2026-09-06 #246 で実装・撮影。設計画像なし。** `docs/design-reference/friends-v6/ux7of.txt` の文言・節・状態と照合し、全件書き出し、CSV数式の無害化、7日期限、追加・更新・変更なし・競合・エラーの事前確認、同一ファイルの二重反映防止、履歴を本物のAPIへ接続した。実装の1440・1920pxは横はみ出し0。`undefined`・`NaN`・`Invalid Date`・`API error` は0件。',
    verdictSource: 'friends-v6/ux7of.txt + docs/design-qa/friends-v6/ux7of.txt + apps/web/src/app/friends/migrations/page.tsx + apps/worker/src/routes/friend-migrations.ts',
  },
  {
    /*
      §7 #108 で描いた「担当者の未読が数えられないとき」。
      **実装はもう在る**——skmtmst/line-harness-oss#741 で、集計が読めないときは
      数だけ `—` にして担当者一覧そのものは残す形にした。
      `YZaDK` の `-error` と同じ面だが、設計が別ノードを持つので別行で撮る。
    */
    ...INBOX, node: 'ohj8J', name: '2-8-A 担当者の未読が数えられないとき',
    steps: [...OPEN_CHAT, { click: '担当者で絞り込む' }],
    states: { apis: ['**/api/chats/stats**'], kinds: ['error'] },
    verdict: 'match',
    verdictNote: '**2026-09-04 台帳へ登録して初めて撮った（board#18 の pen からの申し送り）。** ルート `/chats`（「担当者で絞り込む」を開いた形）。通常と集計失敗の2状態を1440・1920で撮った（4枚、はみ出し0）。 **実装はもう在った**——skmtmst/line-harness-oss#741 で、集計が読めないときは**数だけ `—` にして担当者一覧そのものは残す**形にしてある。担当者は `/api/operators` の別の口なので、集計が落ちても消さない。 **実値0と未取得を別の文字にしている**（0件なら「Kenta 0」、読めないなら「Kenta —」）。 P2 設計 `ohj8J` の文字がまだ書き出されていないので、文言の突き合わせは書き出し後。',
    // #217 の最新判定。上の文はそれまでの判定履歴として残す。
    ...{ verdictNote: '**2026-09-06 #217で一致。** `/chats` で会話を開き、未読集計API失敗状態を1440・1920pxで撮影し、はみ出し0。担当者一覧は残し、数だけを「—」にし、「0件とは違う」ことと次の行動を黄色の警告帯で表示。設計の配置・色・文言と目視比較した。' },
    verdictSource: 'inbox-v6/ohj8J-error.txt + inbox-v6/ohj8J-error-1440.png + inbox-v6/ohj8J-error-1920.png', verdictHead: '70fac89c4',
  },

  // ── 機能33 LINEアカウント設定（§7 #28） ──────────────────────────────

  /*
    **`/accounts` と `/accounts/new` は、いま別の画面への転送になっている。**

      /accounts      → /hq（統括コンソール）
      /accounts/new  → /restaurant-test/stores/new（飲食店向けのテスト機能）

    そのまま撮ると**別の画面を 33-1・33-2 として台帳に入れる**ので、
    実装が無いものとして扱う。撮影ハーネスの「飛ばされた」検査が拾った。
    どちらのルートを 33 に使うかは決めごとが要る（board#18 へ返した）。
  */
  {
    node: 'QT91v', feature: 33, name: '33-1 LINEアカウント一覧',
    dir: 'settings-v6', route: '/accounts', mode: 'page',
    verdict: 'match',
    verdictNote: '**2026-09-07 S0 が固定データ統合後に1440/1920pxを再撮影し一致。** 2幅とも横スクロール0。稼働3・停止1・アーカイブ2・接続問題1、友だち231/186/42人、既定・親子、4指標、検索、5状態の絞り込み、7列表をAPI値で再現した。並び順と親子の操作は既存の保存APIへ接続した。**設計画像なし**のため、Pencil書き出しの1920pxテキストと実装画像を目視比較し、位置・文言・状態の過不足がないことを確認した。',
    verdictSource: 'settings-v6/QT91v.txt + settings-v6/QT91v-1440.png + settings-v6/QT91v-1920.png', verdictHead: '529b8d1825',
  },
  {
    node: 'b2NGxk', feature: 33, name: '33-2 LINEアカウントを登録する',
    dir: 'settings-v6', route: '/accounts/new', mode: 'page',
    steps: [
      { fill: '表示名', text: '然-NEN- TEST' },
      { fill: '役割メモ（任意）', text: '検証用。本番の配信には使わない' },
      { fill: 'input[placeholder="例：123456789"]', text: '2007123456', selector: true },
      { fill: 'label:has-text("チャネルシークレット必須") input', text: 'visual-channel-secret', selector: true },
      { fill: 'チャネルアクセストークン', text: 'visual-channel-access-token' },
      { fill: 'LoginチャネルID', text: '2007999888' },
      { fill: 'Loginチャネルシークレット', text: 'visual-login-secret' },
      { fill: 'LIFF ID', text: '2007999888-AbCdEfGh' },
      { fill: '友だち数の上限', text: '50000' },
      { fill: '警告を出す友だち数', text: '45000' },
      { click: '接続を確かめて保存' },
    ],
    verdict: 'match',
    verdictNote: '**2026-09-07 S0 が実API契約へ接続し、1920px設計と1440/1920px実装を再撮影して一致。** タイムゾーン・国・役割メモ・親アカウントを登録内容として送信し、入力済み値と保存前の接続確認失敗を固定応答で再現した。接続確認は設計どおり1・2が「通りました」、3が「直してください」、4が「確かめていません」で止まり、保存しない。右欄にWebhook・Callback・LIFFのURLとコピー操作を表示する。2幅とも横スクロール0、壊れ値0、秘密値の平文表示0。',
    verdictSource: 'settings-v6/b2NGxk.txt + settings-v6/b2NGxk-{1440,1920}.png', verdictHead: '712903532',
  },
  {
    node: 'T9rA9', feature: 33, name: '33-3 LINEアカウントの詳細・編集',
    dir: 'settings-v6', route: '/accounts/detail?id=visual-qa-account', mode: 'page',
    verdict: 'match',
    verdictNote: '**2026-09-07 S0 が固定データ統合後に1440/1920pxを再撮影し一致。** 2幅とも横スクロール0。登録内容、友だち231人、資格情報3種の末尾4文字・8/12更新、8/13の署名確認、8/19の最終受信、Webhook突合をAPI値で表示した。主欄と右欄、4操作、つながる先、注意の順も設計どおり。秘密値そのものは表示していない。**設計画像なし**のため、Pencil書き出しの1920pxテキストと実装画像を目視比較した。',
    verdictSource: 'settings-v6/T9rA9.txt + settings-v6/T9rA9-1440.png + settings-v6/T9rA9-1920.png', verdictHead: '529b8d1825',
  },
  {
    node: 'nx3XW', feature: 33, name: '33-4 乗り換え・引き継ぎ',
    dir: 'settings-v6', route: '/accounts/handover?id=visual-qa-account', mode: 'page',
    verdict: 'match',
    verdictNote: '**2026-09-07 S0 が固定データ統合後に1440/1920pxを再撮影し一致。** 2幅とも横スクロール0。実APIから引き継ぎコード、受け取り先、事前確認186/23/18/4、判断候補3行、残り20人を読み、4区分の合計231人が元人数と一致するときだけ表示する。5段階、プロバイダー注意、下部操作、右欄の戻せること・注意も設計どおり。**設計画像なし**のため、Pencil書き出しの1920pxテキストと実装画像を目視比較した。',
    verdictSource: 'settings-v6/nx3XW.txt + settings-v6/nx3XW-1440.png + settings-v6/nx3XW-1920.png', verdictHead: '529b8d1825',
  },

  // ── 機能34 はじめの設定と案内（§7 #29） ──────────────────────────────

  {
    node: 'RAW35', feature: 34, name: '34-1 はじめの設定',
    dir: 'settings-v6', route: '/getting-started', mode: 'page',
    verdict: 'match',
    verdictNote: '**2026-09-07、Issue #391・`82f3dccf7c` を固定ポート3107/8794で1440・1920撮影し、設計と目視比較して一致。** `GET /api/getting-started` のサーバ判定を読み、完了2段・停止1段・未着手1段・権限不足1段、進捗帯、次の行動、右欄の停止理由を設計どおり表示する。両幅とも横はみ出し0。',
    verdictSource: 'settings-v6/RAW35.txt + settings-v6/RAW35-{1440,1920}.png + 2026-09-07 visual comparison', verdictHead: '82f3dccf7c',
  },
  {
    node: 'y0P0Qx', feature: 34, name: '34-2 レシピ一覧',
    dir: 'settings-v6', route: '/recipes', mode: 'page',
    verdict: 'match',
    verdictNote: '**2026-09-07、Issue #391・`82f3dccf7c` を固定ポート3107/8794で1440・1920撮影し、設計と目視比較して一致。** レシピ一覧APIの3件、必要機能、複製回数12・5・0回、機能オフ理由を読み、作成可能な2件だけ「このレシピで作る」を表示する。両幅とも横はみ出し0。',
    verdictSource: 'settings-v6/y0P0Qx.txt + settings-v6/y0P0Qx-{1440,1920}.png + 2026-09-07 visual comparison', verdictHead: '82f3dccf7c',
  },
  {
    node: 'D5UaX', feature: 34, name: '34-3 レシピを複製する',
    dir: 'settings-v6', route: '/recipes/clone?id=signup-7day-follow', mode: 'page',
    verdict: 'match',
    verdictNote: '**2026-09-07、Issue #391・`82f3dccf7c` を固定ポート3107/8794で1440・1920撮影し、設計と目視比較して一致。** レシピ詳細APIの16件・内訳・必要機能・版を読み、作成先と接頭辞を冪等キー付き複製APIへ送る実行可能状態を表示する。主欄、右390欄、下部操作とも設計順で、両幅とも横はみ出し0。',
    verdictSource: 'settings-v6/D5UaX.txt + settings-v6/D5UaX-{1440,1920}.png + 2026-09-07 visual comparison', verdictHead: '82f3dccf7c',
  },
  {
    node: 'f9oUm', feature: 34, name: '34-4 マニュアルの正本表',
    dir: 'settings-v6', route: '/settings/manual-links', mode: 'page',
    verdict: 'match',
    verdictNote: '**2026-09-07、Issue #391・`82f3dccf7c` を固定ポート3107/8794で1440・1920撮影し、設計と目視比較して一致。** マニュアル正本APIの総数266件、代表5行、開けない2件、URL、確認日時、状態を6列で表示し、全件確認もAPIへ接続した。検索・状態選択・残り261件の注記を含め、両幅とも横はみ出し0。',
    verdictSource: 'settings-v6/f9oUm.txt + settings-v6/f9oUm-{1440,1920}.png + 2026-09-07 visual comparison', verdictHead: '82f3dccf7c',
  },
]

// 判定は各画面定義のみを正とする。
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
  PhxG6: [1920, 1080], LT8RS: [1920, 1080], Igi72: [1920, 1080], IAf7j: [1920, 1251],
  I6UAdr: [1920, 1384], bzDn6: [1920, 1220], YzxU1: [1920, 1431], InCDe: [1920, 1220],
  r7eSi: [1920, 1080], w8W4Eh: [1920, 1080], vtBCu: [1920, 1064],
  /* pen から届いた新画面（台帳 kentavndng/line-harness-board#18 の実測）。 */
  ux7of: [1920, 1080], ohj8J: [1920, 1840],
  QT91v: [1920, 1080], b2NGxk: [1920, 1940], T9rA9: [1920, 1120], nx3XW: [1920, 1100],
  RAW35: [1920, 1010], y0P0Qx: [1920, 720], D5UaX: [1920, 856], f9oUm: [1920, 700],
  vUXKb: [1920, 1668], ZN0ov: [1920, 1754], JN6mQ: [1920, 1668],
  NjK9q: [1920, 1668], Alekb: [1920, 1668],
  l25rlp: [1920, 1080], tP0RW: [1920, 1320], LfrQs: [1920, 1320],
  ee0sk: [1920, 1590], VjXGX: [1920, 1590], byqIW: [1920, 1080],
  A1ZYeP: [1920, 1080], KoT6c: [1920, 1080], GMvBd: [1920, 1080],
  zGZMA: [1920, 1080], XBkiQ: [1920, 1136],
  bfB50: [1920, 1080], oHAN4: [1920, 1080],
  uLQQc: [1920, 1080], s9gAx: [1920, 1080], W1wzCa: [1920, 1080],
  K0Dbr2: [1920, 1080], txMO9: [1920, 1080], U3SI5: [1920, 1080], Q3qP1r: [1920, 1080],
}

/** 撮る幅。V6の設計は1920だが、1440でも横スクロールが出てはいけない。 */
export const WIDTHS = [1440, 1920]

/** その機能の画面。`--feature 1` で引く。 */
export function screensOf(feature) {
  const requested = new Set((process.env.VISUAL_QA_NODES ?? '').split(',').map((node) => node.trim()).filter(Boolean))
  return SCREENS.filter((s) => s.feature === Number(feature) && (requested.size === 0 || requested.has(s.node)))
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
  14: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['WuKzU','gBtaK','uNBlA','yPkWe'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  15: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['g89Tc','voJtX','eXAJP','YfTfJ','h8pBZr'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  16: [
    { pr: 1191, head: 'e98decafa', on: '2026-09-07', screens: ['GqFTV'], note: 'Issue #422 / PR #1191。1920px設計PNGが無いため1440px設計と1920px実装を本文・配置で照合し、横はみ出し0のmatchへ更新した。' },
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['PouPn','GH8VL','n5VVTb','xqT1Z','GPWzq'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  17: [
    { pr: 1191, head: 'e98decafa', on: '2026-09-07', screens: ['N46cQ','k8VCU','BmoGY','p9CcEB'], note: 'Issue #422 / PR #1191。機能17の4画面を3102/8789で再撮影。p9CcEBは撮影が固まるため保留、残りは横はみ出し0で判定した。' },
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['s98Vfw','N46cQ','MvZm5','BmoGY','HIU5O','k8VCU','z3PB2'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  18: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['Q4bkTg','IhSBB','v0HaI','TEVk8','JupxW','UIaM7','BMmxU','BuVDB','Im2b1'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
    { pr: 951, head: '43b3aae50', on: '2026-09-06', screens: ['Q4bkTg','IhSBB','v0HaI','TEVk8','JupxW','UIaM7','BMmxU','BuVDB','Im2b1'],
      note: 'Issue #231。9 Node・30状態を1440pxと1920pxで撮影し、Pencil設計画像と同じ幅で並べて確認した。全画像で横はみ出し0、9画面を一致へ更新。' },
  ],
  19: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['ZrpKn','GUxsj','GtylA'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
    { pr: 981, head: '83be84278', on: '2026-09-06', screens: ['ZrpKn','GUxsj','GtylA'],
      note: 'Issue #232。3 Nodeを1440px・1920pxで撮影し、★V6設計の1920px画像と並べて確認。全6枚で横はみ出し0。実数表示を接続し、残るAPI・保存契約の差を判定注記へ記録した。' },
    { pr: 1093, head: 'bfff7afa0', on: '2026-09-07', screens: ['GtylA','d8d3Mz'],
      note: 'Issue #296。入力済みの作成画面と停止確認を3104/8791で1440px・1920px撮影し、★V6設計1920pxと1枚に並べて確認。両幅とも横はみ出し0。既存契約で扱える操作を接続し、残るAPI差を理由付き構造一致として記録した。' },
    { pr: 1172, head: '81af44a7f', on: '2026-09-07', screens: ['ZrpKn','GUxsj'],
      note: 'Issue #395。definitions・report・CSVの実API契約を接続し、3104/8791で1440px・1920pxを再撮影。両幅とも横はみ出し0、コンソールエラー0。残る利用先名・成果地点別経路・取消内訳・代表日の差を理由付き構造一致として記録した。' },
  ],
  20: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['Zxezb','J6Inc','YBGtm','QQ1SR','f5HsX','C2I7ry','Fh2Qj','dfwD4'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  21: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['VLMGH','DEX0k','q4lajm','WeXbL','ymXJK','i9sQP'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  22: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['Qu6Vk'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  23: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['eI3gs','ELayY'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  24: [
    { pr: 1191, head: 'e98decafa', on: '2026-09-07', screens: ['Q55bb'], note: 'Issue #422 / PR #1191。通知編集画面を3102/8789で1440・1920px撮影し、横はみ出し0。固定入力不足はデータ待ちとして記録した。' },
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['festr','X8JCA5','Se65i','DpxOK','N2gAza'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  25: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['gief7','Rv8Jv','WjYAC','Vdbv5','xOpDs','py5CG','syWp4'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  26: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['k3WxrO','M0Gb7','KNG00','f8SBSh'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
    { pr: 1083, head: 'd9eff7d7d', on: '2026-09-07', screens: ['k3WxrO','M0Gb7','f8SBSh'],
      note: 'Issue #303 第2周。送信一覧と受信詳細の骨格、通常・読込中・0件・取得失敗を3107/8794で撮り直した。**絵は版に残さない**ので、証拠は `.txt` と判定の注記。' },
  ],
  27: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['TV2DI','cpdDi','SbuUI'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  28: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['QSLEH','GhOb3','W6465r'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  29: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['ugP5y','MKrPY','i5SN2j','k5m5Bc'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  30: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['e3jz3','jwVlo'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
    { pr: 1039, head: '1b4774050', on: '2026-09-07', screens: ['e3jz3','jwVlo'], note: 'Issue #243。3105/8792で通常・読込・空・失敗・権限不足の全24枚を1440/1920px撮影。全画像で横はみ出し0。残る集計・共通監査API差は各画面の判定注記へ記録した。' },
    { pr: 1182, head: '04057fb9da53', on: '2026-09-07', screens: ['e3jz3','EOTS4','jwVlo','I3ZSrU'], note: 'Issue #405。#1175後の access/users・roles・audit/events 固定契約へ接続し、3101/8788で4画面を1440・1920px撮影。横はみ出し0、設計との差は各画面の判定注記へ記録した。' },
    { pr: 1201, head: '5c9238525', on: '2026-09-07', screens: ['e3jz3','EOTS4','jwVlo','I3ZSrU'], note: 'Issue #425。職位・権限bundle・担当範囲・機能別権限の固定行を追加し、権限比較、6行ページ送りと注意札、監査記録の地域・詳細表示を3101/8788で4画面と全状態撮影。横はみ出し0、各画面を再判定した。' },
    { pr: 1213, head: '54f1910a7', on: '2026-09-07', screens: ['EOTS4','I3ZSrU'], note: 'Issue #434。権限比較と認証済み招待フォームを3101/8788で1440・1920px再撮影し、旧Issueの上書きを外して2画面の実効判定をmatchへ更新した。横はみ出し0。' },
  ],
  31: [
    { pr: 1191, head: 'e98decafa', on: '2026-09-07', screens: ['c4R6F'], note: 'Issue #422 / PR #1191。機能設定を3102/8789で1440・1920px再撮影。説明・切替・並び替え・利用数表示を確認し、未取得の利用数はデータ待ちで記録した。' },
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['c4R6F'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  32: [
    { pr: 0, head: '31293424', on: '2026-09-04', screens: ['UgonK','b3HfZ','UhC2O','U0BwS'],
      note: 'S3 第1段。**土台を直してから撮り直した。** 撮影ハーネスの押し口とルートが入れ替え前の固定データを指していたのと、モックに口が無くて画面が落ちていたのを直した（台帳の直しはこの枝、モックの直しは #728）。実装は `codex/development` そのもの。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
    { pr: 1001, head: '1121a74eee', on: '2026-09-06', screens: ['UgonK', 'b3HfZ', 'UhC2O', 'U0BwS'],
      note: '#245。サーバー共通の停止・復旧・追記履歴へ接続し、通常・読込・失敗・最終確認を1440/1920で撮影。絵は版に残さず、追跡済みの `.txt` を証拠にする。' },
    { pr: 1064, head: '875d5f74e', on: '2026-09-07', screens: ['b3HfZ', 'UhC2O', 'U0BwS'],
      note: 'Issue #300。対象3画面と定義済み状態の12枚を固定ポート3105/8792で1440/1920px撮影。全画像で横はみ出し0。右欄・固定操作帯・履歴2表・最終確認をV6の情報順へそろえ、3画面を構造一致へ更新した。' },
    { pr: 0, head: '88912c59c3', on: '2026-09-07', screens: ['UgonK', 'b3HfZ', 'UhC2O', 'U0BwS'],
      note: 'Issue #387。固定ポート3105/8792で4画面14枚（通常・読込・失敗を含む）を1440/1920px撮影。全画像で横はみ出し0。健全性保存、停止・復旧、統合履歴、本人確認、通知の本流契約へ接続し、4画面を一致へ更新した。' },
  ],
  4: [
    { pr: 420, head: '87c150ad', on: '2026-08-28', screens: ['HBTk0', 'yKEdO', 'KoT6c', 'A1ZYeP', 'l25rlp', 'rIhbN'] },
    { pr: 421, head: 'f7b7974a', on: '2026-08-28', screens: ['QKx8Q', 'XBkiQ'] },
  { pr: 541, head: 'e929f22a', on: '2026-08-29', screens: ['QKx8Q', 'XBkiQ'], note: '保存した検索から内部IDを外し、選ぶ形へ。**#541 は #539 を含む**。束3' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['hqrOv', 'dKlkz', 'sfTEW', 'HBTk0', 'yKEdO', 'rIhbN', 'tP0RW', 'LfrQs', 'VjXGX', 'byqIW', 'KoT6c', 'zGZMA'], note: '判定を具体化するため撮り直した（本文が無かった）。development そのもの' },
    { pr: 420, head: 'f77de350', on: '2026-08-30', screens: ['HBTk0', 'yKEdO', 'KoT6c'], note: '入力済みを withUsage で読み、未取得は —。帯4つと表示先の列。項目移行の画面も撮れた' },
      { pr: 605, head: '3b5098a3', on: '2026-08-31', screens: ['l25rlp', 'ee0sk'], note: 'Claudeが直した。連動OFF時の説明・★の切り替え方・OFFに戻したときの断り。#422 の上' },
      { pr: 578, head: 'a744c582', on: '2026-08-31', screens: ['A1ZYeP', 'hqrOv'], note: 'Claudeが撮り直して判定を書き直した。A1ZYeP は絵ではなく `FriendFieldType` を読んで数え直した' },
    { pr: 0, head: '3aef8ded', on: '2026-08-31', screens: ['GMvBd'], note: 'Claudeが実装して撮った。契約枝 codex/kenta-v6-support-mark-rules-api（head e95ac2b5）の上。**doctorが要確認のため push していない。ローカルcommitのみ**' },
    { pr: 605, head: '3b5098a3', on: '2026-09-01', screens: ['l25rlp', 'ee0sk'], note: '**#605 が codex/development へマージされた**（#422 の取り込み後）' },
    { pr: 670, head: 'df3f4e3b', on: '2026-09-02', screens: ['l25rlp', 'tP0RW', 'LfrQs', 'ee0sk', 'byqIW', 'A1ZYeP', 'XBkiQ'],
      note: '第1群5本（#666 #667 #668 #670 #674）と第2群4本（#660 #661 #664 #665）が入った木で撮った。'
        + '**撮っただけで、判定は書き換えていない**（絵を1枚ずつ見ていないため）。'
        + '`VjXGX`（遡及反映の確認ダイアログ）と `zGZMA`（対応マーク削除の確認）は、固定データにボタンが出ず撮れなかった。'
        + '**#670 の主対象 `rIhbN`・`QKx8Q`・`hqrOv` は撮っていない** — 本流 `codex/development` の台帳は95行しかなく、この3件の行が無いため。'
        + '撮影は内蔵SSDのクローンで実施（外付けドライブが障害のため）' },
    { pr: 670, head: '7d830282', on: '2026-09-02',
      screens: ['l25rlp', 'tP0RW', 'LfrQs', 'ee0sk', 'VjXGX', 'byqIW', 'A1ZYeP', 'KoT6c', 'HBTk0', 'yKEdO', 'dKlkz', 'hqrOv', 'rIhbN', 'QKx8Q', 'XBkiQ', 'H374MR', 'sfTEW', 'op1rh', 'QzRsJ'],
      note: '最新 development `7d830282` で撮った。第1群5本（#666 #667 #668 #670 #674）と'
        + '第2群4本（#660 #661 #664 #665）が入った木。撮影は内蔵SSDのクローン（外付けは障害のため使わない）。'
        + '19 Node が撮れた（前回は本流の台帳が95行で `rIhbN`・`QKx8Q`・`hqrOv` の行が無く撮れなかった）。'
        + '`GMvBd`（「保留」）と `zGZMA`（「対応中を保管」）は、固定データにその行やボタンが出ず撮れていない。' },
  ],
  10: [
    { pr: 1081, head: 'a55f719b9b', on: '2026-09-07', screens: ['ZC13r', 'PV1Vh', 'd3rFGD', 'Ho8z4', 'Xjk8q', 'GB0NR', 'D6yO7e', 'TimXl', 'Q8sHa', 'yxyzQ', 'zCQXe'], note: 'Issue #324。一覧API PR #1071 と固定データを列車92まで取り込んだ枝で、対象11画面を3102/8789・1440/1920pxで再撮影し、全画像で横はみ出し0。一覧2画面を一致へ更新し、残る9画面は未提供APIを判定注記へ個別に残した。' },
    { pr: 1070, head: 'a325ab485', on: '2026-09-07', screens: ['ZC13r', 'PV1Vh', 'd3rFGD', 'Ho8z4', 'Xjk8q', 'GB0NR', 'D6yO7e', 'TimXl', 'Q8sHa', 'yxyzQ', 'LKuAQ', 'zCQXe'], note: 'Issue #289。UI HEAD a571acc25 と固定データ PR #1060 を含む統合 #1067 を3102/8789で通常・全状態、1440/1920pxの対象38枚に最終撮影。全画像で横はみ出し0。一致1、構造一致・データ未接続11。' },
    { pr: 1011, head: '98e104b7c', on: '2026-09-06', screens: ['lvaY5'], note: 'Issue #223。3102/8789で1440・1920を撮影し、両方とも横スクロール0。5段・設定サマリー・LINEプレビューへ整え、構造一致／保存API待ちへ更新した。' },
    { pr: 962, head: '9b8f7451', on: '2026-09-06', screens: ['ZC13r', 'PV1Vh', 'd3rFGD', 'Ho8z4', 'Xjk8q', 'GB0NR', 'D6yO7e', 'Q8sHa', 'yxyzQ', 'LKuAQ', 'zCQXe'], note: 'Issue #211。割当ポート3104/8791で11画面を1440・1920px撮影し、設計画像または同Nodeの設計本文と照合。11画面を要修正と判定し、横はみ出し0を確認' },
    { pr: 917, head: 'c5e1095e', on: '2026-09-06', screens: ['ZC13r', 'PV1Vh', 'd3rFGD', 'Ho8z4', 'Xjk8q', 'GB0NR', 'D6yO7e', 'Q8sHa', 'yxyzQ', 'LKuAQ', 'zCQXe'], note: '#251 の11画面を実データへ接続して1440・1920pxで撮影。最終判定はlane確認待ちのため未判定のまま' },
    { pr: 508, head: '61eeb3c7', on: '2026-08-29', screens: ['TimXl', 'GB0NR'], note: '公開完了と公開ページの導線。**#508 は #507 を含む**' },
    { pr: 546, head: 'de0848b9', on: '2026-08-29', screens: ['Ho8z4'], note: '通知とリマインド。既存の申込と5分ごとの仕掛けを使う' },
    { pr: 623, head: '988cc37a', on: '2026-08-31', screens: ['PV1Vh', 'd3rFGD', 'Ho8z4', 'Xjk8q', 'D6yO7e', 'Q8sHa', 'yxyzQ'], note: 'Claudeが実装して撮った。編集画面を設計の段（STEP 1〜5）へ。#546 の上（#546 は #524 → #508 → #507 を含む）。**`Xjk8q` はそれまで「いつ見られるようにするか」タブを撮っていて、視聴後の話が写っていなかった**' },
  { pr: 524, head: 'a6c35ee0', on: '2026-08-29', screens: ['zCQXe'], note: 'ウェビナーの帯を未取得 `—` に。束4' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['ZC13r', 'lvaY5', 'PV1Vh', 'd3rFGD', 'Xjk8q', 'Q8sHa', 'yxyzQ'], note: 'development そのもので撮った' },
    { pr: 0, head: 'f4c3f012', on: '2026-09-01', screens: ['ZC13r', 'Ho8z4'], note: 'Claudeが実装して撮った。契約枝 codex/kenta-v6-webinar-contracts-v2（head 7b2dc2f9）の上。**doctorが要確認のため push していない。ローカルcommitのみ**' },
    { pr: 0, head: '96ed41b6', on: '2026-09-01', screens: ['PV1Vh', 'd3rFGD', 'Ho8z4', 'Q8sHa'], note: 'Claudeが実装して撮った。**doctorが合格になったが、この3本はまだ push していない**' },
  ],
  11: [
    { pr: 1208, head: '68d536652', on: '2026-09-07', screens: ['M9cij'], note: 'Issue #426。PR #1197で修正されたPencil正本を取り込み、使用中3か所の削除不可・使用先一覧・差し替え導線を実装。3102/8789で1440/1920pxを再撮影し、両幅とも横はみ出し0、一致へ更新した。' },
    { pr: 1024, head: '031081d69', on: '2026-09-07', screens: ['W7LBc', 'NNDMR', 'M9cij'], note: 'Issue #224。割当ポート3104/8791で3画面を1440・1920px再撮影し、Pencil正本と同じ比較入力で照合。W7LBcとNNDMRを一致へ更新し、M9cijは要件とPencilの矛盾を根拠に要修正を維持。CzndJはPR #1019を正として差分から除外' },
    { pr: 944, head: '98abf756a', on: '2026-09-06', screens: ['W7LBc', 'GFlD7', 'FRkls', 'NNDMR', 'j9ixI', 'hsBtl', 'J3GxEZ', 'M9cij', 'NKyoA'], note: '割当ポート3104/8791で通常・状態別を含む36枚を撮影。対象9画面は一致6、構造一致・集計未接続1、要修正2。横はみ出し0' },
    { pr: 433, head: '51020a97', on: '2026-08-28', screens: ['M9cij'] },
    { pr: 493, head: '62ddaebe', on: '2026-08-28', screens: ['CzndJ', 'M9cij'], note: '#493 は #433 を含む' },
  { pr: 572, head: 'e4ab641f', on: '2026-08-29', screens: ['NNDMR'], note: '質問のひな形。下書き/公開の送信内容、シナリオの選択肢、回答先の往復、配信の契約テストまで確認。撮影は既存の2枚を維持' },
    { pr: 528, head: '1b95452d', on: '2026-08-29', screens: ['NKyoA'], note: 'タブとフォルダの件数を未取得 `—` に。束4' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['W7LBc', 'GFlD7', 'FRkls', 'j9ixI', 'hsBtl', 'J3GxEZ'], note: '同上。質問のひな形に `createdAt`/`updatedAt` を足すまで `Invalid Date` で撮れなかった' },
    { pr: 493, head: 'cdbfe42c', on: '2026-08-30', screens: ['W7LBc'], note: '縦帯が category ではなく folderId で数えるようになった。通常・読込・0件・失敗と、押した2つ' },
    { pr: 626, head: 'd0af5581', on: '2026-08-31', screens: ['CzndJ', 'M9cij', 'GFlD7', 'FRkls', 'j9ixI', 'hsBtl', 'J3GxEZ', 'NKyoA'], note: 'Claudeが実装して撮った。#528 の上（#528 は #493 と #433 の両方を含む）。**M9cij の推奨修正は到達しないコードだったので取りやめた**' },
  ],
  6: [
    { pr: 543, head: '819895dd', on: '2026-08-29', screens: ['h0kahp'], note: 'テスト送信と本番予約で同じ下書きを使う直し。押すたびに配信が増える件は解決' },
    { pr: 497, head: '84e5bab9', on: '2026-08-28', screens: ['FpgxH'], note: 'Claudeが作ったDraft。#495 の上に積んである' },
    {
      pr: 503, head: '6db5ad7f', on: '2026-08-28',
      screens: ['q76C35', 'zZ9fA', 'XQfMD', 'p97Tf', 'Bw0zt', 'vW4Es', 'u6gHt', 'EGMb1', 'xkRDb', 'TmHjF'],
      note: '固定データ（配信の帯・1件の配信）を足して撮り直した。**`FpgxH` は #497 の絵に戻した。** 機能ごと撮り直すと、別のPRで直った1枚が直る前に戻る',
    },

    { pr: 531, head: '1a943082', on: '2026-08-29', screens: ['u6gHt'], note: '内部語を外し、開封の母数を明記。束3と束6' },
    { pr: 561, head: '51827fe1', on: '2026-08-29', screens: ['bPF0s'], note: '予約完了の5段とSTEP帯、右390pxの取り消し導線、確認窓、409の文。取り消しの口だけモックで405に落とさず、Workerと同じく状態を見て分ける' },
    { pr: 557, head: '697cee2c', on: '2026-08-29', screens: ['q76C35'], note: '帯の未取得を `—` に。返事を差し替えて失敗・一部欠け・実値0の3つを見た' },
    { pr: 554, head: '875a9ed3', on: '2026-08-29', screens: ['EGMb1'], note: '配信の削除を画面内の確認窓へ' },
    { pr: 550, head: 'f7c5a99e', on: '2026-08-29', screens: ['cPk8A', 'sqFXf'], note: '対象条件の保存と呼び出し。**固定データの形は `SegmentCondition`**（`{operator, rules}`）。別名で書いて画面を落とした' },
      { pr: 602, head: 'd02be6d8', on: '2026-08-31', screens: ['q76C35', 'xkRDb', 'EGMb1', 'TmHjF'], note: 'Claudeが一覧を直した。帯の4枚・フォルダの「…」・権限不足の分離' },
    { pr: 603, head: 'c86d7242', on: '2026-08-31', screens: ['zZ9fA', 'cPk8A', 'XQfMD', 'p97Tf', 'Bw0zt', 'vW4Es'], note: '同じくClaude。節の番号・本文の上限5,000字・内部の語の除去。#602 の上に積む' },
    { pr: 0, head: '0857c068', on: '2026-09-01', screens: ['vW4Es'], note: 'Claudeが実装して撮った。#603（codex/kenta-v6-feature6-form-ui）の上。**doctorが要確認のため push していない。ローカルcommitのみ**' },
    { pr: 674, head: 'df3f4e3b', on: '2026-09-02',
      screens: ['q76C35', 'zZ9fA', 'XQfMD', 'p97Tf', 'Bw0zt', 'h0kahp', 'vW4Es', 'FpgxH', 'bPF0s', 'u6gHt', 'EGMb1', 'xkRDb'],
      note: '第1群5本（#666 #667 #668 #670 #674）と第2群4本（#660 #661 #664 #665）が入った木で撮った。'
        + '**絵を見て判定し直したのは `q76C35` だけ。** 残りは撮っただけで判定は据え置き。'
        + '`cPk8A`（保存した条件から選ぶ）と `sqFXf`（この条件を保存）は押せる形になっておらず撮れていない。'
        + '`TmHjF`（一覧の状態）は口の返事を差し替える手順が仕組みに無く撮れない。'
        + '撮影は内蔵SSDのクローンで実施（外付けドライブが障害のため）' },
    { pr: 674, head: '7d830282', on: '2026-09-02',
      screens: ['q76C35', 'zZ9fA', 'XQfMD', 'p97Tf', 'Bw0zt', 'h0kahp', 'vW4Es', 'FpgxH', 'bPF0s', 'u6gHt', 'EGMb1', 'xkRDb', 'TmHjF'],
      note: '最新 development `7d830282` で撮った。第1群5本（#666 #667 #668 #670 #674）と'
        + '第2群4本（#660 #661 #664 #665）が入った木。撮影は内蔵SSDのクローン（外付けは障害のため使わない）。'
        + '`TmHjF`（一覧の状態）が今回は撮れた。'
        + '**24枚（12 Node）撮れた。** はじめ `h0kahp`・`vW4Es`・`FpgxH` が `locator.fill` の時間切れで撮れなかったが、'
        + '原因は実装ではなく**撮る側**だった——`capture-screens.mjs` の `fill` が必ず `getByLabel` を通しており、'
        + '台帳が `selector: true`（CSS選択子）で書いた10件を1つも拾えていなかった。両方を読むように直して撮れた。'
        + '`cPk8A`・`sqFXf` は「詳細条件で絞り込んで配信する」が見つからず撮れない。' },
    { pr: 979, head: '3c6e4ec948', on: '2026-09-06',
      screens: ['q76C35', 'zZ9fA', 'cPk8A', 'XQfMD', 'p97Tf', 'Bw0zt', 'h0kahp', 'vW4Es', 'FpgxH', 'u6gHt', 'EGMb1', 'sqFXf', 'TmHjF'],
      note: 'Issue #219。作成を正本の5段へ分け、対象13画面と状態別を3104/8791の1440・1920pxで撮影。全画像で横はみ出し0。一致2、構造一致・データ未接続5、要修正6。' },
  ],
  12: [
    { pr: 1191, head: 'e98decafa', on: '2026-09-07', screens: ['kQ1bs'], note: 'Issue #422 / PR #1191。対象条件画面を3102/8789で1440・1920px再撮影し、横はみ出し0。条件軸・対象人数・優先順位を確認し、固定入力不足は構造一致・データ待ちで記録した。' },
    { pr: 1129, head: 'af74a0bbd', on: '2026-09-07', screens: ['GO8RQ', 'XtfO3', 'UMiJ9', 'TL7tp', 'szXsT'], note: 'Issue #367。統合済みの月間人数・外部メニュー面アクション・削除影響人数を画面へ接続し、3104/8791で1440・1920pxを撮影。全10枚で横はみ出し0。共有固定応答に残る不足を理由付きで5画面の判定へ記録した。' },
    { pr: 1007, head: 'f2be359e5', on: '2026-09-06', screens: ['GO8RQ', 'XtfO3', 'TL7tp', 'RW5Tb'], note: 'Issue #225。3102/8789で1440・1920と一覧4状態を撮影し、全画像で横スクロール0。要修正4枚を、一致1・構造一致／不足API待ち3へ更新した。' },
    { pr: 509, head: 'e148615c', on: '2026-08-29', screens: ['DIUbO', 'NXdDk'], note: '切替のつながり。既存の pages / areas から解析する。固定データに切替ボタンを足した' },
    { pr: 523, head: '47e7846e', on: '2026-08-29', screens: ['RW5Tb'], note: '内部の言葉の直し（束3）。**束4は半分**——タップ側は `—` だが、メニュー・公開中・出し分けは失敗時も0を数える' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['GO8RQ', 'XtfO3', 'kQ1bs', 'UMiJ9', 'TL7tp'], note: '同上。**`DIUbO` `NXdDk`（#509）と `RW5Tb`（#523）は別PRの絵なので戻した**' },
    { pr: 583, head: '0218ef61', on: '2026-08-30', screens: ['GO8RQ'], note: '出す順番を既定にし、断りと並べ替えの口を足した。Workerの選ぶ順と同率の決め方まで一致' },
    { pr: 509, head: '4cf82bd9', on: '2026-08-30', screens: ['DIUbO', 'NXdDk'], note: 'つながりの通常・読込・空・失敗を本文まで取った。空を失敗と混ぜない' },
    { pr: 575, head: 'ab5750ec', on: '2026-08-30', screens: ['szXsT'], note: '削除確認が ConfirmDialog へ。管理画面のものとLINE上のものが別の窓。失敗しても閉じない' },
    { pr: 577, head: '7b8df2f4', on: '2026-08-30', screens: ['RW5Tb'], note: '失敗のとき帯を — に。実値0と未取得を言い分ける' },
    { pr: 583, head: 'bb1e4dfd', on: '2026-08-30', screens: ['kQ1bs', 'XtfO3'], note: '編集画面に「出す順番」。表示は1番始まり、保存は0始まりのまま' },
    { pr: 592, head: '84f35a0b', on: '2026-08-30', screens: ['XtfO3'], note: 'Claudeが直した。3段の進み方。段の見た目は cCB7r と共通の部品へ切り出した。直した本人が比較している' },
      { pr: 616, head: '0a11c9e8', on: '2026-08-31', screens: ['szXsT'], note: 'Claude実装。影響4つに加え、409の最新影響と別メニューの遅延応答も再監査で確認した' },
  ],
  14: [
    { pr: 1150, head: 'bc92f54ea', on: '2026-09-07', screens: ['WuKzU', 'gBtaK', 'uNBlA', 'yPkWe'],
      note: 'Issue #385。PR #1131の実APIとPR #1142の固定データへ4画面を接続し、3104/8791で1440px・1920pxの10枚を撮影。全画像で横はみ出し0。3画面を一致、履歴の担当者表示名が契約にない編集画面だけを理由付き構造一致とした。' },
    { pr: 1099, head: 'bb8a139b3', on: '2026-09-07', screens: ['WuKzU', 'gBtaK', 'yPkWe'],
      note: 'Issue #327。PR #1077の固定データを使い、3104/8791で一覧・会社名変更後・使用中／未使用の削除確認を1440px・1920px撮影。Pencil 1920pxと同じ比較画像で確認し、全画像で横はみ出し0。一覧を一致へ更新し、編集と削除確認に残るAPI差を記録した。' },
    { pr: 1075, head: '24313778e', on: '2026-09-07', screens: ['WuKzU', 'gBtaK', 'yPkWe'],
      note: 'Issue #295。共通情報3画面を3104/8791で1440・1920px撮影し、★V6設計と同じ比較入力で確認。全画像で横はみ出し0。3画面とも、存在しないAPI値を作らず理由つきの構造一致・データ未接続へ更新した。' },
    { pr: 548, head: 'd4a85ad4', on: '2026-08-29', screens: ['uNBlA', 'gBtaK'], note: '保存前に影響を見る面。値を変えてから保存を押さないと出ない' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['WuKzU', 'gBtaK'], note: 'development そのもので撮った' },
      { pr: 619, head: '31b44202', on: '2026-08-31', screens: ['yPkWe'], note: 'Claude実装。#611 の delete-impact で、差し込まれている場所と空欄のまま送られることを削除の窓へ出した。差し替えの口は契約待ち' },
    { pr: 668, head: '7d830282', on: '2026-09-02',
      screens: ['gBtaK', 'yPkWe', 'WuKzU'],
      note: '最新 development `7d830282` で撮った。第1群5本（#666 #667 #668 #670 #674）と'
        + '第2群4本（#660 #661 #664 #665）が入った木。撮影は内蔵SSDのクローン（外付けは障害のため使わない）。'
        + '`uNBlA`（変える前に影響を見る）は `#cv-value` が見つからず撮れていない。'
        + '`fill` の選択子を読むように直したあとも残ったので、**その id の欄が画面に無い**（ルートは200を返す）。' },
  ],
  26: [
    { pr: 547, head: '48715569', on: '2026-08-29', screens: ['KNG00'], note: 'やり取りの記録。送受信・安全な再送・通常/読込/空/失敗' },
    { pr: 515, head: '09054b78', on: '2026-08-29', screens: ['f8SBSh'], note: '外部連携の失敗を空と分ける。束1' },
    { pr: 527, head: 'c6fd4388', on: '2026-08-29', screens: ['k3WxrO', 'f8SBSh'], note: 'タブの英語を外す（束3）。**#527 は #515 を含む**' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['M0Gb7'], note: 'development そのもので撮った' },
  ],
  15: [
    { pr: 1157, head: '0cc67ed91d', on: '2026-09-07', screens: ['g89Tc', 'voJtX', 'eXAJP', 'YfTfJ'], note: 'Issue #392。統合済みの容量・直接アップロード・版追加・使用先差し替え契約へ接続し、固定ポート3105/8792で1440px・1920pxを再撮影。対象10枚は横はみ出し0。一覧・詳細・削除確認を一致へ更新し、ファイル投入を撮影器で表現できない登録窓だけ理由付き構造一致を維持した。' },
    { pr: 997, head: '3eae16770', on: '2026-09-06', screens: ['g89Tc', 'voJtX', 'eXAJP', 'YfTfJ', 'h8pBZr'], note: 'Issue #228。10件・3フォルダ・使用先3件の固定データで、通常・詳細・登録・削除2状態・一覧4状態を1440pxと1920pxで再撮影。18枚すべて横はみ出し0。' },
    { pr: 559, head: '7922c002', on: '2026-08-29', screens: ['g89Tc'], note: '未取得を一括削除で選べないようにした。**#559 は #438 を含む**' },
    { pr: 560, head: '7c1acd0f', on: '2026-08-29', screens: ['g89Tc'], note: '寸法・並び順・表示件数。**#560 は #559 を取り込んでいる**（`7922c002` が親）ので、一括削除の止め方もこの head で見ている' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['eXAJP'], note: 'development そのもので撮った' },
      { pr: 617, head: 'b7e58a51', on: '2026-08-31', screens: ['YfTfJ'], note: 'Claude実装。使われている場所と確認時刻を表示。差し替えAPI待ちに加え、アカウント切替の遅延応答P1を監査で記録' },
    { pr: 667, head: '7d830282', on: '2026-09-02',
      screens: ['g89Tc', 'eXAJP', 'YfTfJ', 'h8pBZr'],
      note: '最新 development `7d830282` で撮った。第1群5本（#666 #667 #668 #670 #674）と'
        + '第2群4本（#660 #661 #664 #665）が入った木。撮影は内蔵SSDのクローン（外付けは障害のため使わない）。'
        + '`voJtX`（詳細と差し替え）は「夏の定番セット.jpgの使用箇所」が見つからず撮れていない。' },
  ],
  16: [
    { pr: 1180, head: '3721857fb', on: '2026-09-07', screens: ['jwrbf', 'GqFTV', 'njLGA'], note: 'Issue #394。締め・支払い台帳を実API契約へ接続し、3102/8789で3画面と支払い一覧の全状態を1440/1920px撮影。全画像で横はみ出し0。2画面を一致、設計PNGが無い確定画面だけ理由付き構造一致とした。' },
    { pr: 558, head: 'ef7b5773', on: '2026-08-29', screens: ['PouPn', 'xqT1Z', 'jwrbf'], note: '案件ごとの決まった額を紹介者一覧へ反映。率が0のときだけ確定した定額へ切り替える' },
    { pr: 563, head: '64798425', on: '2026-08-29', screens: ['jwrbf'], note: '帯から `ref_tracking` を外した。**`ref_code` は列見出しに残っている**' },

    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['PouPn', 'GH8VL', 'n5VVTb', 'xqT1Z', 'GPWzq'], note: '同上' },
    { pr: 585, head: '75d6eb9a', on: '2026-08-30', screens: ['njLGA'], note: '支払いのタブ。承認済みだけを集計し、保留期間内と承認日時未取得を分ける。通常・読込・0件・取得失敗の4状態' },
    { pr: 585, head: '3857365b', on: '2026-08-30', screens: ['njLGA'], note: '取得失敗のとき帯を — にする直し。0円と見分けがつくようになった' },
    { pr: 667, head: '7d830282', on: '2026-09-02',
      screens: ['n5VVTb', 'PouPn', 'GH8VL', 'njLGA', 'GPWzq', 'xqT1Z'],
      note: '最新 development `7d830282` で撮った。第1群5本（#666 #667 #668 #670 #674）と'
        + '第2群4本（#660 #661 #664 #665）が入った木。撮影は内蔵SSDのクローン（外付けは障害のため使わない）。'
        + '**`n5VVTb`（成果承認）が撮れるようになった。** 撮影の口（`/api/conversions/approvals`）を足したため。'
        + '`jwrbf`（成果内訳）は「田中 明」が見つからず撮れていない。' },
  ],
  27: [
    { pr: 459, head: 'ba0bf62d', on: '2026-08-29', screens: ['GFDqW', 'GfceK', 'Lg8ff'], note: '代理予約の入力→確認→完了→競合を実際に操作して撮った。競合だけ回復画面に届かない' },
    { pr: 562, head: '45789965', on: '2026-08-29', screens: ['Lg8ff'], note: '重なりから選び直して登録まで通した。`ApiError.code` を足して、機械コードと人へ見せる文を別の契約に分けている' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['TV2DI', 'TnDbq', 'SbuUI'], note: 'development そのもので撮った' },
    { pr: 587, head: '425a6b1a', on: '2026-08-30', screens: ['GFDqW', 'GfceK', 'Lg8ff'], note: '確認直前の空き再取得、完了画面のリマインダ時刻と台帳の事実。撮影データの slots[].date を要件どおりに直した' },
  ],
  24: [
    { pr: 1076, head: '8e7c374991', on: '2026-09-07', screens: ['festr', 'Q55bb', 'X8JCA5', 'Se65i'], note: 'Issue #291。固定ポート3102/8789で通常・読込・空・失敗の全状態を1440/1920px撮影し、全画像で横はみ出し0。4画面の構造をV6へそろえた。通知実行の通常fixtureと配信・開封・再試行・版管理のAPI契約が未提供のため、理由つきの構造一致・データ未接続とした。' },
    { pr: 504, head: '806ed169', on: '2026-08-30', screens: ['festr', 'Q55bb'], note: '顧客通知の一覧とテンプレート。**`DpxOK` はここでは撮らない**——#504 に運用者タブは無く、撮ると #564 の絵を巻き戻す（実際に一度やって git から戻した）' },
    { pr: 545, head: 'c9bb193d', on: '2026-08-30', screens: ['X8JCA5', 'Se65i', 'DpxOK', 'N2gAza'], note: '顧客通知の記録と失敗、運用者通知の一覧と作成。**#545 は #504 を含む**。個人の既読は作っていない。**head が `03022681` → `c9bb193d` へ動いたが撮り直していない**——`notification-run-list.tsx`・`operator/new/page.tsx`・`operator-notification-rules.tsx` の blob がいずれも同一（差分は development の取り込み）' },
    { pr: 564, head: 'ad59fde6', on: '2026-08-29', screens: ['DpxOK'], note: '絞り込みチップを状態で言い分ける。失敗・権限不足は `—`' },
    { pr: 0, head: '4af43fb6', on: '2026-09-01', screens: ['festr'], note: 'Claudeが実装して撮った。**doctorが合格になったが、この3本はまだ push していない**' },
  ],
  17: [
    { pr: 1215, head: '65390c132', on: '2026-09-07', screens: ['N46cQ', 'BmoGY', 'p9CcEB', 'k8VCU'], note: 'Issue #429 / PR #1215。決めごとの並び順・公開版・15軸条件と、使い道の共通アクション選択を実装し、3102/8789で1440/1920pxを撮影。全画像で横はみ出し0。k8VCUは一致、残るAPI契約は3画面の判定注記へ記録した。' },
    { pr: 1137, head: '5e1ccd22d', on: '2026-09-07', screens: ['s98Vfw', 'N46cQ', 'qlVLJ', 'MvZm5', 'BmoGY', 'HIU5O', 'vz0Ji', 'k8VCU', 'z3PB2'], note: 'Issue #373。機能17の新しい残高・付与ルール・使い道・履歴契約へ接続し、固定ポート3105/8792で通常と定義済みの全状態を1440/1920px撮影。全画像で横はみ出し0。友だち明細は全体履歴を友だちIDで絞り込んで表示するようにした。残差は画面とAPIに分けて各verdictNoteへ記録。' },
    { pr: 549, head: '0ae3e094', on: '2026-08-29', screens: ['qlVLJ', 'p9CcEB'], note: 'マイルの使い道を交換まで接続。公開版の固定・二重交換の防止・渡せなかったときの決めごとが入っている' },
    { pr: 441, head: '05c5b103', on: '2026-08-28', screens: ['MvZm5', 'BmoGY', 'HIU5O'] },
    { pr: 441, head: 'e953109c', on: '2026-08-28', screens: ['s98Vfw', 'N46cQ', 'k8VCU'] },
    { pr: 494, head: '0ca45f98', on: '2026-08-28', screens: ['HIU5O'], note: '#494 は #441 を含む。**新head `5470ede3` でも撮り直していない**——apps/web の20ファイルすべて blob が同一で、差分は Worker の機能設定だけ' },
    { pr: 495, head: '55301679', on: '2026-08-30', screens: ['z3PB2', 'vz0Ji'], note: '**`codex/development` 直結へ張り替えられたが撮り直していない**——`mileage/page.tsx` と `action-score-tab.tsx` の blob が `7d890d3b` と同一。**`pRHvc` は `screens.mjs` に無いNode**なので判断待ちで飛ばした' },
    { pr: 496, head: '4dac7986', on: '2026-08-28', screens: ['s6MBc'], note: '#496 は #495 を含む' },
    { pr: 499, head: '642b8222', on: '2026-08-30', screens: ['s6MBc'], note: 'Claudeが作ったDraft。#496 の上に積んである。**head は動いたが撮り直していない**——`apps/web` の差分0件' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['s98Vfw', 'N46cQ', 'BmoGY', 'k8VCU'], note: 'development そのもので撮った' },
    { pr: 582, head: '78e2f065', on: '2026-08-30', screens: ['vz0Ji'], note: '手で調整したときの失敗を日本語に。405を実際に起こして確かめた' },
    { pr: 624, head: '5e8f32d3', on: '2026-08-31', screens: ['z3PB2', 'p9CcEB', 's98Vfw', 'MvZm5', 'HIU5O', 'N46cQ', 'qlVLJ'], note: 'Claudeが実装して撮った。#549 の上。**`z3PB2` の「層の境目が違う」は誤りで、40は撮影用の固定データの誤り**（`DEFAULT_BANDS` は 30 / 70 で設計と一致）。固定データを直して撮り直した' },
    { pr: 667, head: '7d830282', on: '2026-09-02',
      screens: ['MvZm5', 'HIU5O', 'z3PB2', 'k8VCU', 's98Vfw', 'N46cQ', 'qlVLJ', 'BmoGY'],
      note: '最新 development `7d830282` で撮った。第1群5本（#666 #667 #668 #670 #674）と'
        + '第2群4本（#660 #661 #664 #665）が入った木。撮影は内蔵SSDのクローン（外付けは障害のため使わない）。'
        + '**機能17は直前まで4枚とも「画面を表示できませんでした」で1枚も撮れなかった。** 撮影の口と固定データを直して8 Node が撮れた。'
        + '`vz0Ji` は「マイルを手で増やす・減らす」が見つからず撮れていない。' },
    { pr: 914, head: '48742a352', on: '2026-09-06',
      screens: ['s98Vfw', 'N46cQ', 'qlVLJ', 'MvZm5', 'BmoGY', 'HIU5O', 'k8VCU', 'z3PB2', 's6MBc'],
      note: 'Issue #230 のS3第2段。Pencilの実ノードと同じ状態を1440・1920で横に並べて確認した。全対象で横スクロール0。絵は版に残さず `.txt` と判定注記を証拠にする。' },
    { pr: 1041, head: '16e2331cb', on: '2026-09-07', screens: ['s98Vfw', 's6MBc'], note: 'Issue #230 の残件2画面。3104/8791で通常と全状態を1440・1920px撮影し、正本と同じ入力で左右比較した。全12枚で横はみ出し0。s6MBcは一致、s98Vfwは未接続API値を作らず構造一致・データ未接続。' },
  ],
  7: [
    { pr: 1030, head: 'a828e5afc3', on: '2026-09-07', screens: ['M1EXwB', 'GC4St'], note: 'Issue #73。一覧の操作メニューと、実行台帳を公開状態 planned で絞る配信予定画面を3104/8791で1440・1920px撮影。正本と同じ入力で比較し、横はみ出し0。' },
    { pr: 429, head: '0f612926', on: '2026-08-29', screens: ['uJP22'], note: '**撮り直していない。** 旧head `838116b4` から `reminders/new` の blob が不変（差分は Worker の機能設定だけ）。#429 の受入条件5項目だけをコードで確認した。画面全体は要修正のまま' },
    { pr: 551, head: '44692a37', on: '2026-08-29', screens: ['s7T2dz', 'JCz6J', 'W98zZQ', 's6Vvp', 'PSmHo'], note: '公開までの5段。`?stage=` で1枚ずつ開く。届く予定・公開前チェック・公開の3つの口だけモックで405に落とさず、**公開の人数は公開前チェックと同じ数から作る**' },

    { pr: 514, head: '9a72dba6', on: '2026-08-29', screens: ['Y0Sn3', 'M1EXwB'], note: '削除確認と、未送信だけ取り消して送信済みを残す直し。**#514 は #498 を含む**。**#498 単体（`ac288d48`）では撮り直さない**——`reminders/page.tsx` の blob は違うが、それは #514 が #498 の上でさらに直したため。撮った木のほうが新しく（`ac288d48` は `9a72dba6` の祖先）、#498 で撮り直すと #514 の直りを絵から巻き戻すことになる' },
    { pr: 500, head: '409f00bb', on: '2026-08-28', screens: ['GC4St'] },
    { pr: 511, head: '4bc71249', on: '2026-08-29', screens: ['GC4St'], note: '実行結果から内部IDを外す。束3' },
    { pr: 498, head: 'f30890f2', on: '2026-08-30', screens: ['Y0Sn3'], note: '`codex/development` 直結へ張り替え。削除確認の窓は入っているが、失敗の文が `API error: 405` のまま' },
    { pr: 514, head: 'd064bded', on: '2026-08-30', screens: ['Y0Sn3'], note: '一部失敗を1件ずつ扱う直し。窓の API error: 405 が日本語になった' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['M1EXwB'], note: 'development そのもので撮った' },
      { pr: 613, head: 'a504fec0', on: '2026-08-31', screens: ['dC0yg', 's6Vvp', 'JCz6J', 'W98zZQ', 'M1EXwB', 'uJP22', 'J64xI', 'PSmHo', 'GC4St'], note: 'Claudeが #551 の head で9枚を撮り直した。4枚が一致。文言の直しは dC0yg のみ' },
    { pr: 927, head: 'eb41ad0d', on: '2026-09-06', screens: ['M1EXwB', 'uJP22', 'J64xI', 's7T2dz', 'JCz6J', 'W98zZQ', 's6Vvp', 'PSmHo', 'Y0Sn3', 'dC0yg'], note: '★V6の対象10画面を1440・1920と全状態で比較。横はみ出し0。' },
  ],
  8: [
    { pr: 1135, head: 'a86933ba8', on: '2026-09-07', screens: ['cmDfJ', 'K7vg2', 'nzWIX', 'ivDoe'], note: 'Issue #375。4画面を実API契約へ接続し、統合 #1132 の固定データで3101/8788・1440/1920pxを正式撮影。横はみ出し0。3画面を一致、受信元の保存値を契約が返さない1画面だけ理由付き構造一致・データ待ちとした。' },
    { pr: 1082, head: 'c1355bb54', on: '2026-09-07', screens: ['K7vg2', 'nzWIX', 'ivDoe', 'U9hzqH', 't7UtYQ'], note: 'Issue #292。編集3段を画面ごとに分割し、競合と実行結果を固定データへ接続。3106/8793で1440・1920と全状態を比較し、横はみ出し0。' },
    { pr: 955, head: '564c91d0fe', on: '2026-09-06', screens: ['g46ja', 'Yj6CQ', 'e6iJG'], note: '競合確認、実在する友だちでのdry-run、最終確認、冪等な有効化を通し、1440・1920pxで設計と目視比較。横はみ出し0。' },
    { pr: 544, head: '6053c271', on: '2026-08-29', screens: ['Gy9OK', 'cmDfJ', 'K7vg2', 'nzWIX', 'ivDoe'], note: '削除確認の窓。**#544 は #491 を含む**' },
    { pr: 501, head: '93edbe17', on: '2026-08-28', screens: ['t7UtYQ'], note: '#501 は #500 を含む' },
    { pr: 566, head: 'd0680774', on: '2026-08-29', screens: ['q8wSqO', 'cmDfJ'], note: '内部の言葉9つを画面の言葉へ。失敗のとき帯を `—` にし、前の数を残さない。**#540 では直らない**（一覧の言葉はこちら）' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['K7vg2'], note: '判定を具体化するため撮った' },
    { pr: 596, head: 'edb94936', on: '2026-08-30', screens: ['U9hzqH', 'g46ja', 'Yj6CQ', 'e6iJG'], note: 'Claudeが実装した。#595 の契約の上に公開までの4段。実装した本人が比較している' },
  ],
  5: [
    { pr: 1218, head: '52cdb3fa6', on: '2026-09-07',
      screens: ['r6Gzsu', 'hz9ti', 'EvVO5', 'RUxNf', 'NrBkW', 'g2UNV', 'M2b2B'],
      note: 'Issue #436。#1199 のAPI契約と #1204 の固定データを使い、7画面を3104/8791で1440・1920px撮影した。試算、開始記録、V6下書き、通別結果を実API経由で表示し、7画面すべて一致。全画像で横はみ出し0。' },
    { pr: 1121, head: '1d9e8d36c', on: '2026-09-07',
      screens: ['kk8dz', 'r6Gzsu', 'hz9ti', 'EvVO5', 'RUxNf', 'g2UNV', 'NrBkW', 'M2b2B'],
      note: 'Issue #366 / PR #1121 の差し戻し対応。機能5の8画面を試算・開始記録・V6下書きAPIへ接続し、3104/8791で1440・1920pxと結果画面3状態を撮影。全22枚で横はみ出し0。1画面を一致、契約が返さない値だけを理由付き構造一致・データ待ちとして記録した。' },
    { pr: 1084, head: '31c2fddcc', on: '2026-09-07',
      screens: ['TC1b1', 'kk8dz', 'bV5Vs', 'r6Gzsu', 'hz9ti', 'RUxNf', 'g2UNV'],
      note: 'Issue #325。#1073の固定データを含む木を3104/8791で1440・1920px撮影し、設計1920pxと同じ状態で横並び比較した。全14枚で横はみ出し0。固定データで差が解消した2画面を一致へ更新し、残る5画面は不足する固定値またはAPI契約を理由に残した。' },
    { pr: 1069, head: '9294bdeeb', on: '2026-09-07',
      screens: ['TC1b1', 'cCB7r', 'kk8dz', 'bV5Vs', 'xfYLn', 'r6Gzsu', 'hz9ti', 'RUxNf', 'g2UNV'],
      note: 'Issue #294。3104/8791で9画面を1440・1920px撮影し、正本と同じ状態・同じ横幅で横並び比較した。全18枚で横はみ出し0。2画面は一致、7画面は存在しないAPI値を作らず理由つきの構造一致・データ待ち。' },
    { pr: 954, head: 'c03ebf864', on: '2026-09-06',
      screens: ['TC1b1', 'cCB7r', 'kk8dz', 'bV5Vs', 'xfYLn', 'r6Gzsu', 'hz9ti', 'dqFft', 'EvVO5', 'RUxNf', 'NrBkW', 'g2UNV', 'M2b2B', 'q5G45'],
      note: 'Issue #266。latest developmentを取り込み、1440・1920と全状態を3102/8789で撮影。全画像で横はみ出し0。' },
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
    { pr: 0, head: '2d0ee180', on: '2026-08-30', screens: ['cCB7r', 'TC1b1', 'RUxNf', 'q5G45'], note: '同上。配信方式の見本は設計より丁寧に入っていた' },
    { pr: 590, head: 'a133916a', on: '2026-08-30', screens: ['RUxNf'], note: 'Claudeが直した。配信前チェック4項目。確かめられない2つは —（未取得）。直した本人が比較している' },
    { pr: 625, head: '73d25b41', on: '2026-08-31', screens: ['bV5Vs', 'xfYLn', 'r6Gzsu', 'hz9ti', 'dqFft', 'EvVO5', 'g2UNV'], note: 'Claudeが実装して撮った。#591 の上（#591 は #553 と scenario-started を含む）。**dqFft の「シナリオごと削除がまだ confirm」は #591 で解決済みだった**' },
  ],
  2: [
    { pr: 513, head: '60b39036', on: '2026-08-29', screens: ['tBlkL', 'AuSDY', 'LHjwD'], note: '保存の成否を窓へ返す直し。**P0は解決**' },
    { pr: 555, head: 'e873eeb9', on: '2026-08-29', screens: ['ANgda', 'tBlkL', 'AuSDY', 'LHjwD'], note: '保存した検索の窓。未入力は赤帯＋押せない保存ボタン。同じ部品を使う4枚を撮り直した' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['xGLVe'], note: 'development そのもので撮った' },
    { pr: 583, head: '0218ef61', on: '2026-08-30', screens: ['GO8RQ'], note: '出す順番を既定にし、断りと並べ替えの口を足した。Workerの選ぶ順と同率の決め方まで一致' },

    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['f0zn6'], note: '本文が取れていなかったので撮った。development そのもの' },
    { pr: 555, head: '9eee9655', on: '2026-08-30', screens: ['tBlkL', 'ANgda', 'AuSDY', 'LHjwD'], note: '重複エラーの文言を設計へ。変更はこの1行だけ' },
      { pr: 604, head: '6011cfeb', on: '2026-08-31', screens: ['ASsb3', 'Xi4x9', 'NfgOs', 'NWbuF', 'TUveA', 'w72a2', 'B7CER8', 'YZaDK', 'L35UOV', 'H3lAOB'], note: 'Claudeが直した。古い形の保存を開くと受信箱が落ちる不具合を撮影中に見つけた。条件の要約と「…」、右パネルの「初期状態に戻す」も足した' },
    { pr: 0, head: '4196cc7b', on: '2026-09-01', screens: ['YZaDK'], note: 'Claudeが実装して撮った。契約枝のローカルcommit 4b97fab1 の上。**doctorが要確認のため push していない。ローカルcommitのみ**' },
    { pr: 1059, head: '6f9a64684', on: '2026-09-07', screens: ['xGLVe', 'NfgOs', 'H3lAOB', 'Xi4x9', 'f0zn6', 'NWbuF', 'B7CER8', 'IYjvu', 'TUveA', 'w72a2', 'ASsb3', 'ANgda', 'tBlkL', 'LHjwD'], note: 'Issue #293。受信箱専用部品と撮影用固定データを設計状態へそろえ、3104/8791で1440・1920pxを撮影。同じ状態のPencilと横並び比較し、要修正14画面をすべて一致へ更新した。' },
  ],
  13: [
    { pr: 436, head: '35c613a6', on: '2026-08-29', screens: ['EMBIK', 'v9tYhl'], note: '#436 の最新head。**`ZOPyc` は撮り直していない**——旧head `950073ab` から `apps/web` の差分0件で、判定は #556 `6037aeef` のまま。受入条件5項目の確認と、画面全体の一致判定は分けて記録した' },
    { pr: 436, head: '950073ab', on: '2026-08-29', screens: ['ZOPyc'], note: '読込・空・失敗を分ける直し。**P0は解決**。帯の2枚が0件のまま残る' },
    { pr: 556, head: '1c1546cb', on: '2026-08-30', screens: ['ZOPyc'], note: '回答フォームの帯を未取得と0件で分ける。失敗のときは作成の誘いを出さない。**`codex/development` 直結へ張り替えられたが撮り直していない**——`page.tsx` と `form-kpi-value.tsx` の blob が `6037aeef` と同一' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['vCqUj', 'cSqvP'], note: 'development そのもので撮った' },
    { pr: 586, head: '7428a314', on: '2026-08-30', screens: ['EMBIK'], note: '回答の保存先をフォーム定義から数える。重複は Set で除く。固定データにわざと重複を入れて確かめた' },
  ],
  25: [
    { pr: 502, head: '75b010fc', on: '2026-08-28', screens: ['DkPY0'], note: '#502 は #500 を含む。新しい表は作らず既存の automation_runs を読む' },
    { pr: 552, head: '6ce43563', on: '2026-08-29', screens: ['gief7', 'Rv8Jv', 'WjYAC', 'Vdbv5'], note: 'タブ帯5本と見本から下書きを作る道。**`DkPY0` は撮り直していない**（#502 `75b010fc` のまま）' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['xOpDs', 'py5CG', 'syWp4'], note: 'development そのもので撮った' },
    { pr: 0, head: '2d0ee180', on: '2026-08-30', screens: ['xOpDs', 'py5CG', 'syWp4'], note: 'development そのもので撮り直した。帯4つと複製は既に入っていた' },
    { pr: 594, head: 'a389b70a', on: '2026-08-30', screens: ['syWp4'], note: 'Claudeが直した。使われている場所に何機能からかを添えた。直した本人が比較している' },
    { pr: 989, head: '44e671b2c', on: '2026-09-06', screens: ['gief7', 'Rv8Jv', 'WjYAC', 'Vdbv5', 'xOpDs', 'py5CG', 'syWp4'], note: 'Issue #238。撮影用APIへ18本の通常一覧、見本12件、v4〜v1と利用先5件を接続し、通常・読込中・0件・取得失敗を含む全対象を1440・1920pxで再撮影。設計画像と同じ入力で比較し、一致1・構造一致2・要修正4を実態どおり記録した。' },
    { pr: 1055, head: '08369795c', on: '2026-09-07', screens: ['gief7', 'Rv8Jv', 'DkPY0', 'WjYAC', 'py5CG'], note: 'Issue #299。5画面をV6の情報順と密度へそろえ、PR #1051 の通常データを含む通常・読込中・0件・取得失敗を固定ポート3105/8792で撮影。全30枚で1440・1920pxの横はみ出し0を確認し、一致1・構造一致4を記録した。' },
    { pr: 1151, head: 'bd900c36d', on: '2026-09-07', screens: ['gief7', 'Rv8Jv', 'DkPY0', 'WjYAC', 'Vdbv5', 'xOpDs', 'py5CG', 'syWp4'], note: 'Issue #377。30日実績、共通アクション集計、CSV、APIページ送り、版ごとの利用状況を接続し、3107/8794で全30枚を再撮影。1440・1920pxとも横はみ出し0。一致を3画面増やし、契約が無い2画面は理由付き構造一致を維持した。' },
  ],
  32: [
    { pr: 482, head: 'b346d467', on: '2026-08-29', screens: ['b3HfZ', 'U0BwS'], note: '緊急停止の下見と最終確認。**撮る前に `pnpm dev` で起こす**（`predev` が `@/generated/release-log.json` を作る。`npx next dev` 直叩きだと500で真っ白になる）' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['UgonK', 'UhC2O'], note: 'development そのもので撮った' },
  ],
  3: [
    { pr: 520, head: '4848a8f3', on: '2026-08-29', screens: ['bzDn6'], note: '友だち一覧の帯を未取得 `—人` に。**development 直結の根元PR**' },
    { pr: 565, head: 'ea2e730d', on: '2026-08-29', screens: ['r7eSi'], note: '統合ユーザーの7列。内部の統合キーを外し、未取得と0件を分ける。空の返事の形も直した（`rows` の無い返事だと画面ごと落ちる）' },
  { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['PhxG6', 'Igi72', 'I6UAdr', 'YzxU1'], note: '判定を具体化するため撮った' },
      { pr: 600, head: '484c0cd8', on: '2026-08-31', screens: ['InCDe'], note: 'Claudeが #598 の読み口の上に実装した2画面のうち友だち同士のほう。5状態＋判定窓で12枚' },
      { pr: 601, head: 'cfab56e0', on: '2026-08-31', screens: ['w8W4Eh'], note: 'Claudeが #599 の読み口の上に実装した統合ユーザー詳細。通常・読込・空・失敗・権限不足＋変更窓＋版競合で14枚' },
    { pr: 628, head: '846be01f', on: '2026-08-31', screens: ['PhxG6', 'Igi72', 'I6UAdr', 'bzDn6', 'YzxU1', 'r7eSi'], note: 'Claudeが実装して撮った。#520 の上（`/friends/page.tsx` を触る唯一の開いているPR）。**#565 が development 経由で入っていることを確かめてから撮った**' },
    { pr: 628, head: '846be01f', on: '2026-09-01', screens: ['bzDn6'], note: '**#628 が codex/development へマージされた**（#520 の取り込み後）。私の画面修正が初めて本流に入った1本' },
    { pr: 645, head: '6e9ed4d6', on: '2026-09-01', screens: ['IAf7j'], note: 'Claudeが実装して撮った。#606 の契約の上（development 直結）。**ACCOUNT に role が無く、権限で出し分ける画面がすべて権限なし側に倒れていた**のを固定データ側で直した' },
    { pr: 966, head: 'baa097e99', on: '2026-09-06', screens: ['PhxG6','LT8RS','Igi72','IAf7j','I6UAdr','bzDn6','YzxU1','InCDe','r7eSi','w8W4Eh'], note: 'Issue #265。10 Node・68枚を1440/1920pxと全状態で撮影し、全画像で横はみ出し0。一覧と表示件数を一致へ更新し、詳細検索は不足APIを明示して構造一致へ更新。IAf7j-pick の撮影手順二重実行も直して再撮影した。' },
    { pr: 975, head: 'bdf6abfa7', on: '2026-09-06', screens: ['vtBCu', 'ux7of'], note: 'Issue #246。UID移行とCSV移行を本物のAPIへ接続し、1440/1920pxで撮影。vtBCuは設計画像と一致、ux7ofは設計画像なしのため本文照合で未判定。両画面とも横はみ出し0、壊れ値0。' },
    { pr: 983, head: '36e8b070b', on: '2026-09-06', screens: ['IAf7j','I6UAdr','bzDn6','YzxU1','r7eSi'], note: 'Issue #265 続き。残り5画面を設計構造へ直し、3102/8789で定義済み全状態32枚を1440/1920px撮影。5画面を一致へ更新し、全画像で横はみ出し0、壊れ値・内部ID0。' },
  ],
  28: [
    { pr: 1177, head: '7ebf0d654', on: '2026-09-07', screens: ['tksPc', 'GhOb3'], note: 'Issue #401。店舗営業時間・休業日・予約ルール・空きプレビュー、価格種別・店舗共通ルール継承を実契約へ接続。3105/8792で1440/1920pxを撮影し、全10枚で横はみ出し0。未提供APIとPencil入力例の差は理由付き構造一致・データ未接続とした。' },
    { pr: 1126, head: 'e1126c5c9', on: '2026-09-07', screens: ['QSLEH', 'W6465r'], note: 'Issue #370。店舗設定と8件のメニューを実API契約へ接続し、通常・読込中・空・失敗を3107/8794で1440/1920px撮影。全10枚で横はみ出し0、2画面を一致へ更新した。' },
    { pr: 1096, head: 'a89279ce7', on: '2026-09-07', screens: ['tksPc'], note: 'Issue #305。3107/8794で通常・読込中・取得失敗を1440/1920px撮影し、全6枚で横はみ出し0。曜日別受付時間と右側プレビューをV6構造へそろえ、未提供APIに依存する値は作らず理由つきの構造一致・データ未接続とした。' },
    { pr: 517, head: '43d3d20e', on: '2026-08-30', screens: ['tksPc'], note: '受付時間。Googleカレンダーとの関係を先に書く' },
    { pr: 532, head: '6cc74968', on: '2026-08-29', screens: ['W6465r'], note: '予約設定の帯を未取得 `—` に。束1と束4' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['QSLEH', 'GhOb3'], note: 'development そのもので撮った' },
    { pr: 0, head: '595c8359', on: '2026-09-01', screens: ['tksPc'], note: 'Claudeが実装して撮った。**doctorが合格になったが、この3本はまだ push していない**' },
    { pr: 1022, head: 'abae52d46', on: '2026-09-07', screens: ['QSLEH', 'GhOb3', 'W6465r'], note: 'Issue #241。予約設定の一覧・作成・一覧状態をV6構造へ直し、3105/8792で通常・読込・空・失敗を含む20枚を1440/1920px撮影。全画像で横はみ出し0。残るAPI差は各画面の判定注記へ記録した。' },
  ],
  29: [
    { pr: 1176, head: 'ea4284f42', on: '2026-09-07', screens: ['ugP5y'], note: 'Issue #403。キャンセル待ちの自動繰上げ処理を確認し、案内を設計どおり表示。3102/8789で1440/1920pxを撮影し、横はみ出し0で一致へ更新した。' },
    { pr: 533, head: 'd1070487', on: '2026-08-29', screens: ['k5m5Bc'], note: 'イベント予約の帯を未取得 `—` に。**#533 は #518 を含む**' },
    { pr: 467, head: '6bb950f3', on: '2026-08-30', screens: ['MKrPY', 'i5SN2j', 'ugP5y'], note: 'イベント予約の作成・予約者・一覧。キャンセル待ちの口を撮影モックへ足した（無いと `waitlist.length` で落ちる）' },
    { pr: 533, head: 'c9d33d95', on: '2026-08-30', screens: ['ugP5y', 'k5m5Bc'], note: '帯が「次に何をするか」になった。あと少しで満席・申し込みが少ない。未取得と実値0も言い分ける' },
    { pr: 593, head: 'f9619297', on: '2026-08-30', screens: ['i5SN2j'], note: '帯が次の行動に。拒否は運用メモ、運営キャンセルは3点を示す。撮影モックに申込者の口を足した' },
  ],
  30: [
    { pr: 475, head: '15febf7f', on: '2026-08-30', screens: ['EOTS4', 'I3ZSrU', 'e3jz3', 'jwVlo'], note: 'ログインユーザーの一覧・追加・役割。development 直結' },
    { pr: 1182, head: '04057fb9da53', on: '2026-09-07', screens: ['e3jz3', 'EOTS4', 'jwVlo', 'I3ZSrU'], note: 'Issue #405。アクセスユーザー・権限bundle・共通監査の読み取り契約へ接続し、4画面を3101/8788で撮影・判定した。' },
  ],
  31: [
    { pr: 478, head: '66883866', on: '2026-08-30', screens: ['c4R6F'], note: '機能設定。オフにしても消えないことを先に書く' },
  ],
  1: [
    { pr: 419, head: 'c84baa63', on: '2026-08-30', screens: ['vUXKb', 'ZN0ov', 'JN6mQ', 'NjK9q', 'Alekb'], note: 'ダッシュボード。お知らせの口を撮影モックへ足した（`counts` の4つが欠けると `undefined.all` で落ちる）' },
    { pr: 971, head: 'd69099cd9', on: '2026-09-06', screens: ['vUXKb', 'JN6mQ'], note: 'Issue #267。3102/8789で対象2画面を1440・1920px撮影し、Pencil設計と比較。両画面とも横はみ出し0。構造は一致し、設計値と公式プロフィール短縮URLを返すAPIがないためデータ未接続を維持した。' },
    { pr: 1028, head: '7cc11af48', on: '2026-09-07', screens: ['vUXKb', 'JN6mQ'], note: 'Issue #267。#270の指標APIと#277の撮影モックを接続し、3102/8789で1440・1920pxを再撮影。両画面とも横はみ出し0、表示中の本文差0。有効友だち398人、送信枠197/200、7日推移、公式lin.ee URL、実QRを確認して一致にした。' },
  ],
  23: [
    { pr: 1190, head: '88673e254', on: '2026-09-07', screens: ['bfB50', 'oHAN4'], note: 'Issue #413。月別集計と下流影響件数のAPIを追加し、bfB50・oHAN4を3101/8788で通常・読込・空・異常・権限不足の各状態まで撮影。横はみ出し0。' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['eI3gs'], note: '同上' },
    { pr: 600, head: '484c0cd8', on: '2026-08-31', screens: ['ELayY'], note: '同じ候補部品・状態部品・判定窓を使うECのほう。再処理の既定は「今後だけ」' },
    { pr: 1006, head: 'f7623915e', on: '2026-09-06', screens: ['bfB50', 'oHAN4'], note: 'Issue #258。定期便とつなぎ先を実APIへ接続し、通常・読込・空・失敗・権限不足の全24枚を1440・1920pxで撮影。全画像で横はみ出し0、壊れ値・秘密値露出0。設計画像なしのため本文照合で未判定。' },
  ],
  9: [
    { pr: 1079, head: 'f13421d869', on: '2026-09-07', screens: ['uLQQc', 's9gAx', 'W1wzCa', 'K0Dbr2', 'txMO9', 'U3SI5', 'P2J0Te', 'Q3qP1r'], note: 'Issue #290。固定ポート3105/8792で対象8画面を1440/1920px撮影し、P2J0Teは正常・読込・空・失敗も比較。機能9全体48枚で横はみ出し0。固定データの正常4件と集計を表示し、現APIで取得不能な値は未取得と明記して要修正を0にした。' },
    { pr: 1010, head: '3d6b7e7e8', on: '2026-09-06', screens: ['ec9vg', 'quhg6'], note: 'Issue #222。3104/8791で最終確認5状態と有効化完了を1440・1920px撮影し、設計本文に構造・文言を合わせた。現APIで取得不能・未接続の項目はデータ待ちとして明記' },
    { pr: 962, head: '9b8f7451', on: '2026-09-06', screens: ['uLQQc', 's9gAx', 'W1wzCa', 'K0Dbr2', 'txMO9', 'U3SI5', 'Q3qP1r'], note: 'Issue #211。割当ポート3104/8791で7画面を1440・1920px再撮影し、設計画像または同Nodeの設計本文と再照合。7画面の要修正判定を具体化し、横はみ出し0を確認' },
    { pr: 431, head: '2ab18c88', on: '2026-08-30', screens: ['uLQQc', 'txMO9', 'U3SI5'], note: '友だち追加時の配信。はじめての人と以前からの友だちを分ける説明が入っている' },
    { pr: 506, head: '5dc99107', on: '2026-08-29', screens: ['P2J0Te'], note: '友だち追加時配信の実行結果。既存の `/api/friend-add-routing/events` を読む' },
      { pr: 615, head: '5873f18b', on: '2026-08-31', screens: ['ec9vg', 'quhg6'], note: 'Claude実装。#597 の公開の読み口の上に、最終確認と有効化完了を1本で作った' },
  ],
  18: [
    { pr: 443, head: 'f372ff30', on: '2026-08-28' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['Q4bkTg', 'IhSBB', 'v0HaI', 'TEVk8', 'JupxW', 'BMmxU', 'BuVDB', 'Im2b1'], note: 'development そのもので撮った（根元9本のマージ後）' },
    { pr: 574, head: '0906b8fa', on: '2026-08-30', screens: ['JupxW', 'BMmxU', 'UIaM7'], note: 'refの初期選択、一覧の4状態、削除確認の窓。撮影モックに詳細・ファネル・流入元の口を足した' },
    { pr: 589, head: '45b3efc5', on: '2026-08-30', screens: ['TEVk8'], note: 'Claudeが直した。タグをフォルダで束ねる。直した本人が比較している' },
    { pr: 627, head: 'd80ef8ce', on: '2026-08-31', screens: ['Q4bkTg', 'IhSBB', 'v0HaI', 'BuVDB', 'Im2b1', 'BMmxU', 'UIaM7'], note: 'Claudeが実装して撮った。#574 の上（#574 は #443 を含む）' },
    { pr: 666, head: '7d830282', on: '2026-09-02',
      screens: ['Q4bkTg', 'BMmxU', 'IhSBB', 'v0HaI', 'BuVDB', 'Im2b1', 'TEVk8', 'JupxW', 'UIaM7'],
      note: '最新 development `7d830282` で撮った。第1群5本（#666 #667 #668 #670 #674）と'
        + '第2群4本（#660 #661 #664 #665）が入った木。撮影は内蔵SSDのクローン（外付けは障害のため使わない）。'
        + '9 Node すべて撮れた。' },
    { pr: 951, head: '43b3aae50', on: '2026-09-06', screens: ['Q4bkTg','IhSBB','v0HaI','TEVk8','JupxW','UIaM7','BMmxU','BuVDB','Im2b1'],
      note: 'Issue #231。9 Node・30状態を1440pxと1920pxで撮影し、Pencil設計画像と同じ幅で並べて確認した。全画像で横はみ出し0、9画面を一致へ更新。' },
  ],
  19: [
    { pr: 1207, head: '46a869f74', on: '2026-09-07', screens: ['ZrpKn', 'GUxsj'], note: 'Issue #432。利用先名・30日推移・成果地点別経路・取消未提供理由を固定API応答から表示し、3104/8791で1440・1920pxを撮影。横はみ出し0で2画面を一致へ更新した。' },
    { pr: 444, head: 'ccbd0975', on: '2026-08-28' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['ZrpKn', 'GUxsj', 'GtylA'], note: 'development そのもので撮った' },
    { pr: 1183, head: 'b5e3dd6a3', on: '2026-09-07', screens: ['ZrpKn', 'GUxsj'], note: 'Issue #408。利用先名・成果地点ごとの経路・取消内訳を反映し、3104/8791で1440・1920pxを撮影。横はみ出し0。固定モックが旧契約のためデータ未接続を判定注記に記録した。' },
  ],
  20: [
    { pr: 445, head: '787a4b46', on: '2026-08-28', note: '**#445 は 2026-08-29 に `codex/development` へマージ済み**（merge commit `6a00834f`）' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['Zxezb', 'J6Inc', 'YBGtm', 'QQ1SR', 'f5HsX', 'C2I7ry', 'Fh2Qj', 'dfwD4'], note: 'development そのもので撮った（根元9本のマージ後）' },
    { pr: 584, head: 'd0e62d59', on: '2026-08-30', screens: ['QQ1SR'], note: '使われ方の4つの帯と片づけの導線。通常・読込・空・失敗の4状態' },
    { pr: 676, head: 'a0bb3f44', on: '2026-09-02',
      screens: ['Zxezb', 'J6Inc', 'YBGtm', 'QQ1SR', 'f5HsX', 'C2I7ry', 'dfwD4'],
      note: '#676・#677 が入った木で撮り直した。**それまで機能20は9枚とも「画面を表示できませんでした」で1枚も撮れていなかった。**'
        + '原因は実装ではなく撮影側で、`/api/analytics/friends`・`reactions`・`routes`・`usage` の口がモックに無く、'
        + '既定の器 `{items,total,page,limit}` が返って `overview.metrics` で投げていた。契約どおりの形を返すようにして7 Node が撮れた。'
        + '`Fh2Qj`（ファネル）はまだ撮れない。' },
    { pr: 924, head: 'bd8f0482', on: '2026-09-06', screens: ['Zxezb','J6Inc','YBGtm','QQ1SR','f5HsX','C2I7ry','Fh2Qj','dfwD4'],
      note: '台帳 #233。PR headの同じ実装を1440px・1920pxで撮影し、22枚すべて横スクロール0。設計との比較は一致5枚、構造一致・データ未接続3枚。**絵は版に残さない**（#730 の決めごと）ので、証拠は `.txt` と判定の注記。' },
  ],
  21: [
    { pr: 446, head: '4307088d', on: '2026-08-28' },
    { pr: 525, head: 'deff5ffb', on: '2026-08-29', screens: ['DEX0k'], note: '状態の内部語を日本語へ。束3' },
    { pr: 526, head: 'dfcc9a53', on: '2026-08-29', screens: ['HpKyF'], note: 'きっかけの内部名を日本語へ。束3' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['VLMGH', 'q4lajm', 'WeXbL', 'i9sQP'], note: 'development そのもので撮った' },
    { pr: 526, head: '1c91a7bc', on: '2026-08-30', screens: ['HpKyF', 'VLMGH'], note: '誕生日配信の効かない「何日後」を外し、3日前10:00の固定を書いた。Workerの birthdayDeliveryTarget と突き合わせ済み' },
    { pr: 620, head: 'ed5c0932', on: '2026-08-31', screens: ['ymXJK'], note: 'Claudeが実装して撮った。コラムの下書き作成（#618 の作成契約の上）。通常・入力の誤り・重複・権限不足・保存失敗の5状態。**本文エディタは作っていない**——引き継ぎが「本文の入力欄を作らない」と定めており、記事の正本はEC側' },
    { pr: 1050, head: '8d3557ce0', on: '2026-09-07', screens: ['VLMGH','DEX0k','q4lajm','WeXbL','ymXJK','i9sQP'],
      note: 'Issue #234。6 Node・18状態を1440px・1920pxで撮影し、★V6設計の1920px画像と並べて確認。全36枚で横はみ出し0。要修正2画面を構造一致・データ未接続へ更新し、残るAPI・正本契約の差を判定注記へ記録した。' },
  ],
  22: [
    { pr: 1207, head: '46a869f74', on: '2026-09-07', screens: ['hHrz8', 'N2J629'], note: 'Issue #432。原本保存の再認証4状態と、戻す理由・補足・通知本文を3104/8791で撮影。1440・1920pxとも横はみ出し0で2画面を一致へ更新した。' },
    { pr: 447, head: '65adbc59', on: '2026-08-28' },
    { pr: 0, head: 'c275749d', on: '2026-08-30', screens: ['Qu6Vk', 'N2J629'], note: 'development そのもので撮った。「理由を選んで見送る」→「見送る」に名前が変わっていた' },
    { pr: 1044, head: '98588d0275', on: '2026-09-07', screens: ['Qu6Vk'], note: 'Issue #235。3105/8792で通常・読込・空・失敗・権限不足の全12枚を1440/1920px撮影。全画像で横はみ出し0。残る審査時間・注意候補・一括審査API差は判定注記へ記録した。' },
    { pr: 1185, head: 'c992fbd82', on: '2026-09-07', screens: ['Qu6Vk', 'hHrz8', 'N2J629'], note: 'Issue #400。固定データ #410（PR #1181）反映後、3104/8791で3画面を全状態撮影。42枚すべて横はみ出し0。Qu6Vkを一致、残る2画面は再認証・設計差分を理由付き未接続とした。' },
  ],
}
