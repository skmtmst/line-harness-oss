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
