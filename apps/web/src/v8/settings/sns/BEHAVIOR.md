# SNS 連携（V8）の動き

入口：`app/settings/sns/page.tsx`（新しい画面なので V8 だけ）。絵：★V8-B `YINmJ`（未接続）・`DFnll`（Instagram 接続済み）／2026-10-07 利用者承認。板は `y3GGTs`。Googleビジネスと Instagram の2つだけ（X は入れない）。

- 形：カードは**1列で横幅いっぱい**に縦へ並べる（上下左右20・行の間12・角丸12、カードの間14、板の中身の余白は上16/左右24/下24）。
- 段の頭：題（15/700）と説明（12）の縦並び、間は2。
- 行：「ことば（12）＋余白＋こたえ（12/700）」。未取得は「—」。
- 設定の中のメニュー：ほかの設定の画面のメニューの末尾に「SNS 連携」を出す。この画面は絵にメニューが無いので出さない（`useHideSettingsNav`）。
- 絵の板の頭は「SNS連携」（空白なし）だが、画面の題と設定メニューの札は既存の「SNS 連携」（空白あり）に揃える。`settings-inner-nav.react.test.tsx` がこの札を見ているため。説明文は絵のことば「Googleビジネスや Instagram とつないで、お店の情報をまとめて発信します。」をそのまま使う。

## Googleビジネス プロフィール

- 口：`GET /api/restaurant-test/google/connection`（`restaurantGoogleApi.connection`）。
- 説明：「お店の情報と投稿を、Google 検索とマップに出します」。
- 行「いまの状態」：接続しています／店舗を選んでいません／認可が切れています／権限がありません／未接続。
- 行「接続しているビジネス」：`connection.locationTitle`（無ければ「—」）。
- ボタンの行：［Googleビジネスの設定を開く］（`/restaurant-test/google?tab=settings`）。つないでいるときは右端に［接続を解除する］（文字のボタン・管理できる人だけ）。押すと確認の小窓（取り消せない操作）→ `POST …/google/disconnect`。
- 読み取れないときは行の代わりに読み込み失敗の案内（`ListState kind="error"`・やり直せる）。

## Instagram

- 口：`GET /api/instagram/connection`（`api.instagram.connection`）。
- 説明：「Googleビジネスの投稿を、Instagram にも同時に出せます」。
- 行「いまの状態」：接続しています／未接続／認可が切れています／設定がありません。
- 未接続・認可切れ：注記「Instagram のビジネスアカウント（またはクリエイターアカウント）でログインしてください。個人のアカウントは接続できません。」＋［Instagram にログインして接続］（主ボタン・管理できる人だけ）。押すと `POST /api/instagram/oauth/start` で受け取った URL へ飛ぶ。**ページを選ぶ段は出さない**（利用者の決め：Instagram にログインするだけでつながる）。
- 認可切れのときは右端に［接続を解除する］も出す。
- 接続済み：行「接続しているアカウント」＝`@ユーザー名（ビジネス）`、行「できること」＝「写真つき投稿の同時公開」。ボタンの行は［接続を確かめる］（`POST /api/instagram/refresh`）＋右端に［接続を解除する］（確認の小窓 → `DELETE /api/instagram/connection`・`expectedVersion` に `connection.version` を渡す）。
- 「設定がありません」（`unconfigured`／この環境に Meta の設定が無い）：注記だけを出し、**押せないボタンは置かない**（「出す＝使える」）。
- 閲覧のみ（owner・admin 以外）には接続・解除・確認のボタンを置かない。
- 戻り先：Instagram のログインから戻ると `/settings/sns?instagram=connected`（または `failed`）。帯でうまくいった／失敗を知らせ、閉じると `router.replace` で印を消す。
- ボタンの中の印：この版の `lucide-react` に Instagram の印が無いので、写真の印（`Camera`）を使う（`aria-hidden`。読み上げはボタンのことばだけ）。

## 今の口で出せないもの

- Instagram の DM・コメントの返信（口が無い）。受信箱での見え方の見本も、実際の口ができるまで置かない。
- 投稿の「今月 N件・次の予約」（投稿の数を返す口が接続の口に無い）。
