# 参考UIの採否（V7）

決定日: 2026-09-23（オーナー「サムネイルの作り方以外全てやって」により、点検時の推奨どおり確定。kentavndng/line-harness-board#1069）
点検の全体: https://claude.ai/artifact/Xv82wiee3vN573dSgTjpZ6

## 1. 結論

参考サイトは**部品をそのまま入れる店ではなく、動き方と呼び名の見本帳**として使う。見た目の正本は Pencil（★V6、新しく描くものは ★V7）で、外のサイトの色や形は持ち込まない。

| サイト | 判定 | 使う場所 |
|---|---|---|
| [NameThatUI](https://namethatui.com/) | 常用（読むだけ） | 部品の呼び名を揃える辞書。§3 の対応表の出どころ |
| [Detail](https://detail.design/) | 常用（考え方だけ借りる） | ショートカットの長押し表示（受信箱 V7-B）、ラベルを押すと入力へ、背景に合わせた文字色（タグの色）、正規表現の試し打ち（自動応答）、日本語の改行位置（`word-break: auto-phrase`）、メールとパスワードを1欄にまとめるログイン |
| [Beautiful UI](https://www.beautifului.dev/)（MIT） | 採用候補が最多 | Loading State・Task Rows（V7-E 処理の進み）、Flowchart（V7-A 流れ図）、Diff Table（取込・設定変更の差分）、Records/Filter Table（友だち一覧の列設計）、Search（⌘K）、Prompt Bar（受信箱の返信欄） |
| [Appica UI](https://appica.dev/ui)（Base UI＋Tailwind v4＋React 19） | 土台として有力 | Combobox（タグ・友だち選択）、Date Picker（ブラウザ任せの日付欄の置き換え）、Number Field（マイル）、Color Picker（タグ色）、OTP Field（2段階認証）。**中身の Base UI を直接使い、見た目は自前のトークンで当てる。同梱の `styles.css` は入れない**（全体をリセットして既存の見た目を壊す） |
| [Spectrum UI](https://ui.spectrumhq.in/docs/animatedcard)（Apache-2.0） | 部分採用 | Loading Button（保存ボタン）、はじめの設定の案内カード（ホバーはごく控えめ） |
| [Rare UI](https://www.rareui.com/) | 3部品だけ | Duration Picker（リマインダ・シナリオの「3日後 10:00」）、OTP Input、Folder |
| [RewampUI](https://www.rewampui.com/) | **使わない** | 画面の中の装飾は GPU 負荷が高く、業務の集中を妨げる。使うとしてもログイン画面の背景だけで、静止画の代替を必ず用意する |

## 2. 守ること（例外なし）

1. **Pencil が先。** 見た目が変わる採用は、先に Pencil（新しいものは ★V7）へ描く。コードだけ変えると、次の人が絵に戻す
2. **色・角丸・影は既存トークンだけ。** 白文字が乗る緑は `--color-accent-deep`（#087a3e）
3. **重い依存を足さない。** framer-motion / motion は入れず、CSS の transition で書き直す。やむを得ないときはその画面だけ遅延読込
4. **動きを減らす設定を守る。** `prefers-reduced-motion` で止める。動きは 200ms 以下、状態の変化を伝えるときだけ
5. **ライセンスを記録する。** コードを写したら、元URL・ライセンス・写した日をファイル冒頭に書く。Rare UI・Appica・RewampUI は取り込む前にリポジトリの LICENSE を確かめる
6. **置き場所と試験。** 取り込んだ部品は `components/shared/` に置き、既存の契約試験（フォーカス表示・主ボタンの緑など）の対象に入れる。1部品1PR

## 3. 呼び名の対応表（NameThatUI 由来）

Pencil の部品名・要件書・AI への指示文で、この呼び名を使う。

| 日本語（画面での呼び名） | 英語（部品名） | 使う場所の例 |
|---|---|---|
| 骨組み表示 | Skeleton | 一覧の読み込み中（V7-E） |
| 保存結果の通知 | Toast | 保存・削除の結果（V7-E） |
| 処理の進みの行 | Task Row / Progress Row | 送信・取込・一括操作（V7-E） |
| 横断検索の窓 | Command Palette | ⌘K |
| 流れ図 | Flowchart | シナリオ・オートメーション（V7-A） |
| キーの札 | Shortcut Hint / Keycap | 受信箱（V7-B） |
| 候補つき入力 | Combobox | タグ・友だち選択 |
| 日付の選択 | Date Picker | 予約・イベント |
| 数値の入力 | Number Field / Stepper | マイル・点数 |
| コードの入力 | OTP Field | 2段階認証 |
| 差分の表 | Diff Table | 取込前・設定変更の確認 |
| 空の状態 | Empty State | 一覧の0件 |

## 4. 1部品を取り込む手順

1. 参考ページで名前・動き・状態の数（通常／押下／無効／読み込み中／失敗）を書き出す
2. Pencil の ★V7 に部品として描き、実ノードIDを取る。1440px・1920px の設計画像を書き出す
3. ライセンスを確かめ、写す場合は冒頭に出典を書く
4. `components/shared/` に CSS Modules＋トークンで作る。動きは CSS だけ
5. 契約試験を足す（状態ごとの表示・フォーカス表示・主ボタンの色）。わざと壊して落ちることも確かめる
6. まず1機能に入れて設計画像と並べて比べ、合ってから横に広げる。反映履歴に1行

## 5. kobra.systems の部品（2026-09-23 追加）

オーナーが挙げた27部品を、日本語に直して使えるかで仕分けた。**kobra.systems は一部が有料（Kobra Pro、または1部品 19 ドル）で、ライセンスの明記も無い。コードは写さず、動きと形の手本としてだけ使う。** 外部ライブラリ（`motion` など）も足さない。最初の1つ（Input OTP → 認証コード入力、★V7 `xHzFK`）は PR #609 で実装した。

数は `apps/web/src` を数えた 2026-09-23 時点の値。

### 5-1. 新しく作る（★V7 に描いてから、共通部品にする）

| 順 | kobra | 日本語の部品名 | なぜ要るか | 置き換える先 |
|---:|---|---|---|---|
| 1 | Checkbox | チェックボックス | 共通部品が無く、86 ファイルで個別に作っている | 一覧の選択・設定の ON/OFF の一部 |
| 2 | Calendar | 日付の選択 | 36 ファイルがブラウザ任せの日付欄で、表示が英語の書式になる | 予約・イベント・配信の予約日時・分析の期間 |
| 3 | Combobox | 候補つき入力 | タグ・友だち・テンプレートの選択を画面ごとに作っている | タグ付け・宛先の条件 |
| 4 | Multi Select | 複数選択 | タグの複数選択を画面ごとに作っている | 一斉配信の対象・友だちの絞り込み |
| 5 | Progress | 処理の進み | V7-E（#1074）そのもの | 一斉配信の送信・取込・一括操作 |
| 6 | Accordion | 開閉する欄 | 63 ファイルで個別に開閉を作っている | 詳細の折りたたみ・設定の補足 |
| 7 | Avatar | 友だちの顔（アイコン） | 画像なし・読み込み失敗の見せ方が画面ごとに違う | 受信箱・友だち一覧・詳細 |
| 8 | Attachment | 添付ファイルの行 | 受信箱・配信の添付の見せ方を揃える | 返信欄・配信の画像/ファイル |
| 9 | Magnetic Dropzone | ファイルを落とす場所 | 登録メディア・画像の取込。動きは控えめにし、キーボードでも選べるようにする | `ImageUploader`・メディアの取込 |
| 10 | CRM Table | 顧客の一覧表 | 友だち一覧の列の組み方（タグ・担当・最終接触）の手本。V7 で友だち一覧を描き直すときに | 友だち一覧 |
| 11 | Chart | グラフ | 分析・ダッシュボードのグラフの形を揃える | 分析・ダッシュボード |

### 5-2. 今の部品で足りる（見た目の良い所だけ ★V7 で取り入れる）

| kobra | 今の部品 | 取り入れる所 |
|---|---|---|
| Input | `TextField` | なし |
| Form | `Field`・`FormSection`・`CreatePage` | 誤りの文の置き場所 |
| Select | `Select`・`SelectField` | なし |
| Switch | `Toggle` | なし |
| Radio Group | `RadioCard`・`RadioCardGroup` | 小さい丸の形（カードでない選択肢） |
| Tabs | `Tabs` | なし |
| Pagination | `Pagination` | なし |
| Badge | `StatusBadge`・`Chip` | なし |
| Marker | `StatusBadge`（状態の点） | なし |
| Alert | `Notice`・`NoteBar` | なし |
| Empty | `ListState`（空） | 絵と次の一手の置き方 |
| Spinner | `ListState`（読込中） | 回転の形を1つに揃える（いま8ファイルで個別） |
| Item | `AsideCard`・`Tr` など | 設定の行の並べ方 |

### 5-3. 使わない

| kobra | 理由 |
|---|---|
| Sidebar | 左メニューは ★V6 の正式共通メニュー（`J33xq`）が正本 |
| Menubar | 管理画面にアプリ型のメニューバーは無い |
| Scroll Area | ブラウザの標準のスクロールで足りる。独自のスクロールは読み上げ・キーボードで不利 |

### 5-4. 進め方

1部品ずつ「★V7 に描く → 共通部品にする（試験つき）→ 1画面で置き換えて見比べる → 横へ広げる」。上の表の順番で進める。
