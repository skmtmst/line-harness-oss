# 固定した絵との見た目合わせ（c）2026-10-11

## 今の進捗を全体像から整理するとこれ

- CODEX-NEXT 34。開始前診断は `DOCTOR_LOCAL=1` で「合格」。開始時・停止時のLINE作業ツリーはクリーン。親リポジトリは変更していない。
- 指定どおり列車18から専用ワークツリー `/Users/kentakenta/lh-work/lh-pages-matchc`、ブランチ `codex/kenta-match-c-1011` を作った。本線は取り込んでいない。
- 基準コードSHA: `fc073798f0638d54f82d7977ecde3747800847c1`。地図はこのSHAの `scripts/visual-qa/v8-design-map.json`（613枚）。
- 担当281枚＝管理画面243枚＋LIFF38枚。LIFFは `app:liff` の11枚に加え、名前がLIFFでURLが空の27枚を含む。前者だけ数えると漏れる。
- **未完了・地図の状態指定の確認待ち**。コード修正に入る前に、固定した地図で別のタブ・状態を撮ってしまう問題を確認した。画面の見た目・保存・送信・API・DB・権限は変更していない。
- `MEASURE_MAP=<列車18の地図> zsh ~/lh-work/tools/hq/measure.sh matchc <管理画面243枚>` を実行。共通枠1つ、開発サーバー1つ、Playwright1つ。5枚は既存MEASURE-EXCLUDEにより除外。22枚の比較画像を取得したところで意図的に停止。残り216枚は撮影停止による未取得であり、製品の画面障害ではない。
- 取得した初回値はすべて**参考値・数えない**。画像JSONのcodeVerifiedをfalse、理由を状態指定確認待ちとして記録。合格や合格候補にしない。サーバーと見本APIは停止済み。
- 完了した機能: なし。初回測定準備と地図の欠落調査まで。共通部品の修正、一時許可の解除、全試験・型検査・ビルド・1152/1440/1920見張り・verify:designは未実施。push・PR・D1・配備は実施しない。

## 測定を止めた理由

- 同じ板IDの撮影指定を測定ツール側の保存済み地図と比較すると、担当管理画面の117枚でURLまたはstateが異なる。うち71枚はstateが消え、54枚はURLのクエリが消えている（重複あり）。保存済みの地図は撮影指定の比較にだけ使用し、古い絵・古い要件を実装の根拠にはしていない。
- 例: `Eo56k`（レポート）が `/affiliates?tab=report` → `/affiliates`、`aINnz`（支払い）が `/affiliates?tab=payment` → `/affiliates`。`CVz5d`（銀行用CSV）はタブ指定と3回のクリック、`v9JWQ`（閲覧のみ）は役割とスタッフAPIの指定が消えている。
- 固定した絵にコードを合わせる前提となる「同じ画面・同じ状態で比較する」を満たせない。別の一覧や未開封の窓の数字を根拠にCSSを変更すると、動きや正常な画面を壊す。
- 司令塔へ確認済み（返答待ち）: 同じ板IDの撮影指定だけを補った測定専用の写しを使用するか、司令塔が地図を修正してから進めるか。固定したHTML・座標表・元の地図は変更しない。

## 原因の分類

| 分類 | 今回確認したこと | 対応 |
|---|---|---|
| 型・共通部品の値 | 正しい状態の撮影前なので未判定 | 共通部品を変更しない |
| 画面の並び・余白 | 参考画像にずれあり。地図欠落の影響と分けられていない | 再測定後、上からずれの原因を読む |
| 見本データ・状態 | タブ・クリック・閲覧権限の撮影指定欠落 | 同じ板IDの撮影指定を照合し、司令塔の回答後に再測定 |
| 絵に無い物・コードに無い物 | 未判定。撮れていないことを機能不足と扱わない | 正しい状態での撮影後に分類 |

## 直した共通部品

なし。持ち主の見張り・verify:designは未実施。列車16の25件の一時許可はまだ解除していない。現在のlayout-defects-allow.jsonは355件で、reasonに列車16と書かれた行は無い。対応する対象を実寸で確認してから解除する。

## 機能待ち

未判定。API不足はまだ確認していない。板名の「API待ち」「将来」だけで機能不足とは断定しない。LIFFの将来決済板は現行要件と実装を確認してからここへ分類する。

## 絵との食い違い

オーナーの決まりと固定した絵の食い違いは未判定。今回確定したのは地図の撮影指定と板名が表す状態の食い違いであり、絵は変更しない。

## 板ごとの一致率（前→後）

前は取得済み22枚の参考値のみ。後は未実施。止めた後の216枚を0%としない。幅は地図の指定幅で、1440/1152の両幅照合は完了していない。LIFFは要件の375/414等の原寸を使う。

| 板ID | 板名 | 幅 | 前（参考） | 後 | 状況 |
|---|---|---:|---:|---:|---|
| jQRsr | LIFF ① スタンプカード｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定 |
| V2HU7 | LIFF ② 特典を店員に見せる｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定 |
| xe8ga | LIFF ② 使用済み｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定 |
| h2HKh | LIFF ③ 紙のカードを移す｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定 |
| etLd8 | LIFF ③ お店の確認待ち｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定 |
| sAnyy | LIFF 席の予約 ③ 受け付けました｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定 |
| aLU3r | 404 LIFF ページが見つかりません V8 | 原寸 | — | — | LIFF未測定 |
| AOWoJ | 会員 一覧 V8（機能追加 F-19・API待ち）｜状態は型の見本 LS のとおり | 1440 | 4% | — | 参考画像取得・正しい状態で再測定 |
| AnwtH | 統括 バナー生成（画像を取り込む）V8｜状態は型の見本 LS のとおり | 1440 | 70% | — | 参考画像取得・正しい状態で再測定 |
| AsfFB | 外部連携 一覧 1152 V8｜状態は型の見本 LS のとおり | 1152 | 76% | — | 参考画像取得・正しい状態で再測定 |
| AzrZq | 分析 成果地点ごとのレポート V8｜状態は型の見本 LS のとおり | 1440 | 10% | — | 参考画像取得・正しい状態で再測定 |
| B24oNg | 統括 バナー生成（一覧から外す・確認）V8｜状態は型の見本 LS のとおり | 1440 | 10% | — | 参考画像取得・正しい状態で再測定 |
| B9ZAr | 統括 バナー生成（プロジェクト一覧）V8｜状態は型の見本 LS のとおり | 1440 | 56% | — | 参考画像取得・正しい状態で再測定 |
| BBRDb | 統括 一括配信を作る（店の5つの手順と同じ・手順2に送るアカウント） | 原寸 | 0% | — | 参考画像取得・正しい状態で再測定 |
| vOtK2 | 座席・卓（融合 B-186） | 1440 | 38% | — | 参考画像取得・正しい状態で再測定 |
| BHEl9 | 統括 メンバー（権限を変更する）V8｜状態は型の見本 LS のとおり | 1440 | 34% | — | 参考画像取得・正しい状態で再測定 |
| BVSbe | 統括 作る④ 確かめて配る V8 | 1440 | 0% | — | 参考画像取得・正しい状態で再測定 |
| BVuYh | 健康日記 30日のまとめ（引き出し）V8｜状態は型の見本 LS のとおり | 1440 | 29% | — | 参考画像取得・正しい状態で再測定 |
| BnrQp | マイル たまる決めごとを作る（競合）V8｜状態は型の見本 CS のとおり | 1440 | 9% | — | 参考画像取得・正しい状態で再測定 |
| BygrU | コンバージョン 一覧 1152 V8｜状態は型の見本 LS のとおり | 1152 | 37% | — | 参考画像取得・正しい状態で再測定 |
| C3qMCz | 統括 テンプレート クーポンを作る V8（店と同じ形＋配る） | 1440 | 0% | — | 参考画像取得・正しい状態で再測定 |
| CJlf4 | マイル 友だちの残高 V8｜状態は型の見本 CS のとおり | 1440 | 54% | — | 参考画像取得・正しい状態で再測定 |
| CVz5d | 成果とアフィリエイト 銀行用 CSV（本人確認）V8｜状態は型の見本 LS のとおり | 1440 | 0% | — | 参考画像取得・正しい状態で再測定 |
| Cfed0 | Googleビジネス 投稿 V8｜状態は型の見本 LS のとおり | 1440 | 9% | — | 参考画像取得・正しい状態で再測定 |
| CuHXG | Googleビジネス 設定 V8｜状態は型の見本 LS のとおり | 1440 | 12% | — | 参考画像取得・正しい状態で再測定 |
| D0AOyx | プール管理 プールを作る V8｜状態は型の見本 CS のとおり | 1440 | 8% | — | 参考画像取得・正しい状態で再測定 |
| D6fh3 | 統括 お問い合わせ（運営のLINEを登録）V8｜状態は型の見本 LS のとおり | 1440 | 7% | — | 参考画像取得・正しい状態で再測定 |
| DA0Ag | 外部連携 やり取りの中身 V8（機能追加 F-18・API待ち）｜状態は型の見本 LS のとおり | 1440 | 59% | — | 参考画像取得・正しい状態で再測定 |
| DkRDE | 分析 ファネル V8｜状態は型の見本 LS のとおり | 1440 | 33% | — | 参考画像取得・正しい状態で再測定 |
| DxAAA | 外部連携 Google Sheets V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| DzdC3 | 統括 友だち属性 タグ V8（店と同じ形＋配る）｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| E14GFm | 流入と計測 作る（競合の比べ）V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| E2Any | マイル たまる決めごと（閲覧のみ）V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| E2l8cw | ★V8-B コンバージョン 一覧の状態｜状態は型の見本 LS のとおり | 1440 | — | — | 既存の測定除外 |
| EMUl9 | 流入と計測 一覧（閲覧のみ）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| En14p | オートメーション 一覧 1152 V8｜状態は型の見本 LS のとおり | 1152 | — | — | 初回停止・未測定 |
| Eo56k | 成果とアフィリエイト レポート V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| EpTBB | 統括 一括配信を作る① テンプレート・過去の配信を窓で選ぶ V8（オーナー 2026-10-08 夜） | 原寸 | — | — | 初回停止・未測定 |
| FDBsG | 流入と計測 広告とのつなぎ V8（機能追加 F-21・API待ち）｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| Fkv3w | 統括 テンプレート リサーチを作る V8（店と同じ形＋配る） | 1440 | — | — | 初回停止・未測定 |
| G83vi | 分析 レポートを作る（競合）V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| GKgRk | ★V8 統括 一括配信③ カルーセルをここで作る（引き出し）（G-9 採用 2026-10-09） | 1440 | — | — | 初回停止・未測定 |
| GmVR5 | 設定 EC連携 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| Gqve5 | 成果とアフィリエイト アフィリエイターを作る（競合）V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| GtI4Y | 流入と計測 QR コードの小窓 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| H031gC | 外部連携 受け取る設定を追加 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| H5UoIu | 分析 レポートを作る V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| HMpVx | 統括 アカウント（アカウントの設定）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| HfK0O | 統括 テンプレート メッセージを作る V8（店と同じ形＋配る） | 1440 | — | — | 初回停止・未測定 |
| I0w2e | 統括 バナー生成（アーカイブ・確認）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| IRPw8 | マイル 行動スコア V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| IY3nx | 統括 テンプレート 質問を作る V8（店と同じ形＋配る） | 1440 | — | — | 初回停止・未測定 |
| J1VA8 | オートメーション 下書きを仕上げる V8（機能追加 F-15・API待ち）｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| J7HNK | 採用 2026-10-08 G-4 アカウントへ配る（左にフォルダ）（B-89） | 原寸 | — | — | 初回停止・未測定 |
| JB8V1 | 統括 請求 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| JKjsE | 統括 アカウント（ホーム）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| JUTGz | Googleビジネス プロフィール V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| Jn95h | 投稿 写真の審査（閲覧のみ）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| Jxmqh | NEN配信 コラム一覧 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| K7HYu | 統括 統括の情報 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| KMaMk | 流入と計測 作る V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| KdFRI | 成果とアフィリエイト アフィリエイター 1152 V8｜状態は型の見本 LS のとおり | 1152 | — | — | 初回停止・未測定 |
| L2Bzp | マイル 使い道を作る V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| L4Uov | 分析 友だちの増減（閲覧のみ）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| LRc93 | 統括 テンプレート（ひな形の一覧）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| LWQXd | オートメーション 一覧 V8（機能追加 F-14・API待ち）｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| LnGNw | オートメーション 共通アクション V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| M2tJM | 統括 一括配信 詳細（送った後）V8（店の tPm3e と同じ形） | 1440 | — | — | 初回停止・未測定 |
| M4jS9 | 統括 メンバー 権限を変える（確認）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| M4torY | オートメーション ルールを作る V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| M8zhjL | マイル マイルを手で増やす・減らす V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| ME78d | 統括 作る②（1152） V8 | 1152 | — | — | 初回停止・未測定 |
| MFgPZ | 統括 友だち属性 タグのひな形を作る V8（店の Qat9s と同じ形＋配る）｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| MJoJR | メニュー管理 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| MLgjO | 採用 2026-10-08 G-3 統括のテンプレート まず保存→配りますか？（B-88） | 原寸 | — | — | 初回停止・未測定 |
| MV5Os | メニュー管理 停止の確認 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| MuhWR | NEN配信 一覧（自動配信）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| N1br7 | 投稿 報酬の決まり 版の履歴 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| N4T9mO | 統括 回答フォーム 編集（予約を入れるブロック） V8（店の ijxur と同じ形＋配る） | 1440 | — | — | 初回停止・未測定 |
| N8ZrUl | 分析 使われ方 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| NGh7b | 外部連携 送り先を作る（競合）V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| Ni0V8 | 統括 テンプレート リッチビデオを作る V8（店の G-2b と同じ形＋配る・B-130）｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| NkmwU | メニュー管理 メニューを追加・変更 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| Nv7An | マイル 行動スコアを手で直す V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| OC0gy | マイル たまる決めごと V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| OhguS | 統括 お問い合わせ（やり取り）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| OylSV | 成果とアフィリエイト 成果承認 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| PFe9c | 分析 経路と成果 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| PUWyq | 重ねた板｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| Q5le3 | 流入と計測 詳細（新）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| Qgjmc | 統括 友だち属性 対応マーク V8（店と同じ形＋配る）｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| R6kIG | マイル 友だちのマイル詳細（新）V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| R8NNi | マイル 点数の変化の明細 V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| RaMf3 | 成果とアフィリエイト アフィリエイターを作る V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| S35pO | マイル 使い道 V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| S3pdQ | オートメーション 状態 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| SAUCs | 外部連携 見本 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| SDSsr | 統括 テンプレート カルーセルを作る V8（店と同じ形＋配る） | 1440 | — | — | 初回停止・未測定 |
| SrmVs | Googleビジネス パフォーマンス V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| SyQA1 | 投稿 公式サイト掲載 V8（機能追加 F-20・API待ち）｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| T1j2Sw | Googleビジネス 投稿を作る V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| Td4TN | 成果とアフィリエイト 案件を作る V8（機能追加 F-23・API待ち）｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| Tj7n4 | NEN配信 送った履歴 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| TkA4D | 投稿 写真の審査 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| U4Eep0 | 統括 一括配信 一覧 V8（店の一斉配信 EML2F と同じ形） | 1440 | — | — | 初回停止・未測定 |
| URzvC | ★V8-B 流入と計測 一覧の状態｜状態は型の見本 LS のとおり | 1440 | — | — | 既存の測定除外 |
| UVnvR | E-10 予約枠・在庫 休業日・貸切｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| UcBQ5 | 統括 バナー生成（参照画像を選ぶ）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| UgZPJ | 統括 作る③ 配る先 V8 | 1440 | — | — | 初回停止・未測定 |
| Uv9AA | 外部連携 やり取りの記録 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| VIij4 | 統括 作る① 形と画像 V8 | 1440 | — | — | 初回停止・未測定 |
| VdKOK | 飲食店向け 利用規約 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| VtJQ6 | 運営 代理ログイン中（閲覧のみ）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| W2GYgL | 採用 2026-10-09 G-7 フォルダの…から配る（B-101） | 原寸 | — | — | 初回停止・未測定 |
| W5Wxr | 統括 バナー生成（画像ライブラリ）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| W7Z57 | 統括 バナー生成（プロジェクトを作る）V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| WSGvo | コンバージョン 一覧（閲覧のみ）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| WjFWW | 統括 一括配信を作る② 送るアカウントを［選ぶ］→窓 V8（B-111 2026-10-09） | 原寸 | — | — | 初回停止・未測定 |
| X4JcOf | 統括 テンプレート（ひな形を作る）V8｜状態は型の見本 CS のとおり | 1440 | — | — | 既存の測定除外 |
| XjOte | 流入と計測 サイトスクリプト V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| eZPzk | 予約枠・在庫（融合 B-186） | 1440 | — | — | 初回停止・未測定 |
| YMVFD | E-5 枠を閉じる知らせ｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| YZ57z | 外部連携 Google Sheets の接続を解除 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| xzR4g | 予約台帳 一覧・予約の詳細（融合 B-186） | 1440 | — | — | 初回停止・未測定 |
| ZJIyl | マイル たまる決めごと 1152 V8｜状態は型の見本 CS のとおり | 1152 | — | — | 初回停止・未測定 |
| ZSbFY | 外部連携 一覧（こちらから送る）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| ZxKL5 | 流入と計測 広告費を手で入れる V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| aINnz | 成果とアフィリエイト 支払い V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| ao15G | 飲食店向け 店舗を追加 ①利用規約への同意 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| b8xBtZ | 統括 お問い合わせ V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| cgESv | 組織・権限（融合 B-186） | 1440 | — | — | 初回停止・未測定 |
| bglah | 分析 保存した分析 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| c7dxp | オートメーション 見本 V8（機能追加 F-16・API待ち）｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| cXqlS | コンバージョン 作る（競合）V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| cmRZc | 統括 作る② ボタンの動き V8 | 1440 | — | — | 初回停止・未測定 |
| cniyw | 投稿 採用 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| ctLwT | マイル たまる決めごとを作る V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| dEv6G | 会員 ランクを消す（確認）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| dzx5D | 専用機能 状態 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| e5yBLx | 会員 ランク設定（競合）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| eEhYU | 分析 友だちの増減 1152 V8｜状態は型の見本 LS のとおり | 1152 | — | — | 初回停止・未測定 |
| eLjeQ | マイペット ペットの情報を直す V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| eY9F3 | 座席・卓 卓を止める（確認）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| faGn4 | 飲食店向け 店舗を追加 ②店舗の基本情報 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| fb9NJ | 会員 ランク設定 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| g8d6ai | 統括 テンプレート リッチメッセージを作る V8（店と同じ形＋配る） | 1440 | — | — | 初回停止・未測定 |
| g98F9 | オートメーション 動いた記録 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| gBrCz | 座席・卓 卓を追加・変更 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| gSsPR | 統括 友だち属性 タグのひな形 連動アクションを追加（横から開く窓）V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| gW0F2 | 外部連携 こちらで受け取る V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| h1G4d | 分析 Search Console V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| h7A2F | マイペット ごはんの目安 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| h7dmB | 成果とアフィリエイト 案件 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| qwIZr | 今日のお店（融合 B-186） | 1440 | — | — | 初回停止・未測定 |
| mVUo3 | 予約枠・在庫 予約経路の連携（融合 B-186） | 1440 | — | — | 初回停止・未測定 |
| hadfk | 成果とアフィリエイト 成果をまとめて操作（操作を選ぶ）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| hsD8e | 外部連携 送り先を作る V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| i0Ao0R | 統括 テンプレート 一覧 V8（店と同じ形＋配る）｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| iK4cQ | 分析 URLクリック V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| iLJmw | EC連携 つなぎ先 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| iMnph | 統括 バナー生成（プロジェクトの中）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| j0Wcg | Googleビジネス V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| j2hfkS | オートメーション 共通アクションを作る V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| j8p3yj | コンバージョン 作る V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| l5SRfT | 外部連携 一覧（閲覧のみ）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| R2w4j | 予約台帳 今日（融合 B-186） | 1440 | — | — | 初回停止・未測定 |
| mIwA4 | 健康日記 一覧 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| meBRB | 統括 テンプレート（アカウントへ配る）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| n4DT7 | 承認ワークフロー（閲覧のみ）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| nAesv | EC連携 注文の状況（引き出し）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| nH9L8 | オートメーション 一覧（閲覧のみ）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| nJlxX | 成果とアフィリエイト アフィリエイター V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| nVvXy | 重ねた板｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| noVq4 | 統括 リッチメニュー 一覧 V8（店と同じ形＋配る）｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| oRbJi | マイル 履歴 V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| oqSJP | NEN配信 誕生日クーポンの決めごと（引き出し）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| ou60i | 組織・権限 ユーザーを追加・変更 V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| p03ImY | 統括 バナー生成（生成中）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| p0kA3 | 流入と計測 広告への送信履歴 V8（機能追加 F-22・API待ち）｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| pIHp3 | ★V8 統括 一括配信③ メッセージを作成（G-9 採用 2026-10-09） | 1440 | — | — | 初回停止・未測定 |
| pQ4fH | 統括 テンプレート 詳細 V8（店と同じ形＋配る） | 1440 | — | — | 初回停止・未測定 |
| qSTVR | 流入と計測 広告連携 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| qf3ky | 予約枠・在庫（競合）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| r4ARpV | 統括 メンバー V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| r6dJFy | コンバージョン 一覧 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| rI5uh | 統括 バナー生成（画像の詳細）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| rRk0C | ★V8-B 成果とアフィリエイト 状態｜状態は型の見本 LS のとおり | 1440 | — | — | 既存の測定除外 |
| ralAc | 外部連携 API 接続 V8（機能追加 F-17・API待ち）｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| rm92Y | 予約台帳 電話の予約を入れる V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| scJcP | 統括 回答フォーム 編集（答え終わったあと） V8（店の XXFT4 と同じ形＋配る） | 1440 | — | — | 初回停止・未測定 |
| svUTk | 見出し | 1440 | — | — | 初回停止・未測定 |
| t2SMXX | マイペット 一覧 1152 V8｜状態は型の見本 LS のとおり | 1152 | — | — | 初回停止・未測定 |
| t8WgD8 | 承認ワークフロー V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| tJqST | オートメーション ルールを作る（競合）V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| tSgl6 | 採用 2026-10-08 G-6 バナー生成 選んで右下で配る（B-99） | 原寸 | — | — | 初回停止・未測定 |
| tnTn9 | 成果とアフィリエイト アフィリエイターの詳細（引き出し）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| u3iab3 | 設定 プール管理 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| u5CuB8 | 分析 クロス分析 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| u5MM7 | 統括 回答フォーム 編集（中身） V8（店の m1cWEy と同じ形＋配る） | 1440 | — | — | 初回停止・未測定 |
| ujcar | 投稿 この写真を見送る V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| usDpO | 成果とアフィリエイト 期間を締める（確かめ）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| v9JWQ | 成果とアフィリエイト アフィリエイター（閲覧のみ）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| vWJEm | 流入と計測 作る（競合）V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| w1W8h | EC連携 会員のつき合わせ V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| w5pwG | NEN配信 配信を直す（口コミのお願い）V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| wTIej | マイペット 一覧 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| wWrpY | 外部連携 状態 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 既存の測定除外 |
| wZPua | 統括 回答フォーム 一覧 V8（店の I3L41O と同じ形＋配る）｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| wqC8x | EC連携 定期便 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| ws9wt | 分析 友だちの増減 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| x9HIR | Googleビジネス 返信を作る V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| n9vvGx | LINE来店フォロー（融合 B-186） | 1440 | — | — | 初回停止・未測定 |
| xRPdo | 統括 回答フォーム 編集（受付と見た目） V8（店の tpRRT と同じ形＋配る） | 1440 | — | — | 初回停止・未測定 |
| xbHxg | 流入と計測 一覧 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| xqr1Q | 統括 友だち属性 タグのひな形を作る（所属フォルダを開いた）V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| y0sapC | 統括 友だち属性 友だち情報欄 V8（店と同じ形＋配る）｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| y1ztx | 流入と計測 一覧 1152 V8｜状態は型の見本 LS のとおり | 1152 | — | — | 初回停止・未測定 |
| yLKwV | 統括 メンバー（権限者を招待）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| yRDwW | NEN配信 コラムを書く V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| yvOtn | 分析 配信の反応 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| z2tvtX | 健康日記 記録の項目 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| zOpMG | 統括 バナー生成（上限に達した）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| zQ5vY | 会員 ライフタイム V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| zaqP9 | マイル 状態 V8｜状態は型の見本 CS のとおり | 1440 | — | — | 初回停止・未測定 |
| ziSgL | オートメーション 共通アクション 版と使われている場所 V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| aRvrh | G-8k 店頭の QR の小窓 | 1440 | — | — | 初回停止・未測定 |
| B3oGt3 | LIFF ② 確認 | 原寸 | — | — | LIFF未測定 |
| byCFU | G-8a2 管理画面：紙のカードの移行タブ | 1440 | — | — | 初回停止・未測定 |
| fpPlW | G-8a 管理画面：QR の入口 | 1440 | — | — | 初回停止・未測定 |
| Ft2Ey | 提案 G-4 アカウントへ配る（左にフォルダ） | 原寸 | — | — | 初回停止・未測定 |
| G8KDe | 提案 G-1 来店スタンプ（ショップカードに合わせて足す） | 原寸 | — | — | 初回停止・未測定 |
| K3qhdY | 提案 LINE来店フォローと新しい飲食の機能のつながり（B-196）2026-10-10 | 原寸 | — | — | 初回停止・未測定 |
| KRppA | LIFF ① 人数・日時・コース | 原寸 | — | — | LIFF未測定 |
| NVN1Y | G-8a3 管理画面：押した・使った記録タブ | 1440 | — | — | 初回停止・未測定 |
| oIFk7 | 提案 G-2b リッチビデオを作る | 原寸 | — | — | 初回停止・未測定 |
| QUF2R | 案 流入と計測 作る（クーポンを渡す・B-174） | 原寸 | — | — | 初回停止・未測定 |
| T53Stv | 提案 G-3a 統括 メッセージを作る（下の帯） | 原寸 | — | — | 初回停止・未測定 |
| tfxQh | 下：一覧 | 原寸 | — | — | 初回停止・未測定 |
| Upx1c | 案 統括 テンプレート 一覧（左メニューと種類に3つ足す） | 原寸 | — | — | 初回停止・未測定 |
| wVSxu | 流入と計測 QR コードの小窓（止めた経路）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| xOQKw | 予約台帳 今日 1152（融合 B-186） | 1152 | — | — | 初回停止・未測定 |
| T5ljMA | 統括 自動応答のひな形を作る V8（本文の差し込み・友だち追加時の配信・リマインダも同じ形）（B-238 採用 2026-10-11） | 1440 | — | — | 初回停止・未測定 |
| P90Vp0 | 統括 回答フォーム 編集（受付と見た目：色を決めて配る・型のカード）V8（B-236・B-238 採用 2026-10-11） | 1440 | — | — | 初回停止・未測定 |
| g3REI | 統括 一括配信③ 本文の差し込み（友だち情報を押した形・決まった 8 つ）V8（B-238 採用 2026-10-11） | 1440 | — | — | 初回停止・未測定 |
| k0TPPS | 統括 一括配信③ メッセージを作成（1152）V8（B-238 採用 2026-10-11） | 1152 | — | — | 初回停止・未測定 |
| PftqN | コンバージョン 一覧（行を開いた・右の詳細 360）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| pUT4L | コンバージョン 一覧（止める・確かめの窓 480）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| ZFskf | 投稿 報酬の決まり 新しい版を作る（引き出し 480）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| jZ4Bh | EC連携 会員のつき合わせ（候補を見る・引き出し 480）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| E1CeT | EC連携 会員のつき合わせ（決める・確かめの窓 480）V8｜状態は型の見本 LS のとおり | 1440 | — | — | 初回停止・未測定 |
| zBVOA | 採用 2026-10-09 流入経路にクーポン QR（B-174）2026-10-09（B-178 採用・地図と部品に入れた） | 原寸 | — | — | 初回停止・未測定 |
| wrzSi | 採用 2026-10-09 統括にも 自動応答・友だち追加時の配信・リマインダのひな形（B-173）2026-10-09（B-178 採用・地図と部品に入れた） | 原寸 | — | — | 初回停止・未測定 |
| XafWh | LIFF 回答フォーム 書類を送る（選ぶ前・B-176）｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定 |
| B5SbF | LIFF 回答フォーム 書類を送る（送ったあと・B-176）｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定 |
| ADutg | LIFF 状態：空きがない｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| AcTHQ | LIFF 状態：読み込み中｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| B8rCt | LIFF 回答フォーム ①（ページ1）｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| BjcuB | LIFF イベント 空きが出た（席を取る）｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| CbGpr | LIFF 予約 ⑤ 確認（お支払いあり・将来）｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| EscPA | LIFF イベント 申し込みの確認｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| IruGD | LIFF 予約 ① メニューを選ぶ｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| M2p63S | LIFF 予約 ③ 日時を選ぶ（週）｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| RmjcT | LIFF 予約 ⑥ お支払い（決済サービスの画面へ）｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| RpW2h | LIFF ウェビナー 配信中｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| S3uBl | LIFF マイル・紹介｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| VU6Xi | LIFF 予約 ⑥ 受け付けました｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| YvTJ3 | LIFF 予約の履歴（機能追加 F-6・API待ち）｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| aNZKe | LIFF 回答フォーム 送った｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| biNP5 | LIFF 予約 ② 担当を選ぶ｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| g9osGN | LIFF 回答フォーム ②（予約を入れる・新）｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| gLReL | LIFF 予約 ⑤ 内容の確認｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| gVjiC | LIFF イベント 詳細｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| k3aJKU | LIFF 予約 ④ 日時を選ぶ（カレンダー）｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| qJNti | LIFF 予約 ⑦ 予約が確定しました（支払い済み）｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| qVdiX | LIFF イベント 申し込み完了・キャンセル待ち｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| uZqMA | LIFF 予約 ⑤ 内容の確認（414）｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| v9WJd | LIFF 予約 お支払いが終わらなかった｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| wPfqW | LIFF 回答フォーム ①（414）｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| xvtSz | LIFF 予約 ③ 日時を選ぶ（414）｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| y1bs9A | LIFF 自分のイベント｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |
| zz9R3 | LIFF 状態：読み込めなかった｜状態は型の見本 CS のとおり | 原寸 | — | — | LIFF未測定・URLなし |

## 消えた・変わった撮影指定の一覧

以下は現行地図と測定ツール保存済みの地図の差。保存済み指定を自動で正本へ戻していない。旧の手順が現行コードでも動くかは再測定で確認する。

| 板ID | 現行URL | 保存済みURL | 現行state | 保存済みstate |
|---|---|---|---|---|
| AnwtH | /hq/banners?tab=library | /hq/banners?tab=library | null | {"click":["画像を取り込む"]} |
| B24oNg | /hq/banners/project?id=banner-project-qa-1 | /hq/banners/project?id=banner-project-qa-1 | null | {"click":["画像 1 を開く","一覧から外す"],"manual":"測る相手を承認済みの ★BG-B（qIp42）・★BG-C に替える（オーナー 2026-10-06）。絵は musubo-design/バナー生成.pen でマサトさんの手元にあり、書き出し待ち"} |
| BHEl9 | /hq/members | /hq/members | null | {"api":[{"match":"GET /api/staff/last-logins","body":{"success":true,"data":{"hq-1":"2026-09-30T10:12:00+09:00","hq-2":"2026-09-30T09:40:00+09:00","hq-3":"2026-09-28T18:02:00+09:00","hq-5":"2026-08-31T12:00:00+09:00"}}},{"match":"GET /api/staff$","body":{"success":true,"data":[{"id":"hq-1","name":"高田 誠","email":"takada@example.jp","role":"owner","lineLinked":true,"twoFactorEnabled":true,"isActive":true,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"active","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":null,"canAccessDescendantAccounts":true,"accountScope":"all","scopedLineAccountIds":[]},{"id":"hq-2","name":"中川 由美","email":"nakagawa@example.jp","role":"admin","lineLinked":true,"twoFactorEnabled":true,"isActive":true,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"active","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":null,"canAccessDescendantAccounts":true,"accountScope":"all","scopedLineAccountIds":[]},{"id":"hq-3","name":"佐野 直人","email":"sano@example.jp","role":"viewer","lineLinked":true,"twoFactorEnabled":true,"isActive":true,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"active","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":"visual-qa-account-store","canAccessDescendantAccounts":true,"accountScope":"accounts","scopedLineAccountIds":["visual-qa-account-store"]},{"id":"hq-4","name":"外部デザイン","email":"design@partner.jp","role":"viewer","lineLinked":true,"twoFactorEnabled":true,"isActive":false,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"pending_line","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":"visual-qa-account-prod","canAccessDescendantAccounts":true,"accountScope":"accounts","scopedLineAccountIds":["visual-qa-account-prod"]},{"id":"hq-5","name":"森 涼太","email":"mori@example.jp","role":"viewer","lineLinked":true,"twoFactorEnabled":true,"isActive":false,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"disabled","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":"visual-qa-account-event-2025","canAccessDescendantAccounts":true,"accountScope":"accounts","scopedLineAccountIds":["visual-qa-account-event-2025"]}]}}],"click":["高田 誠さんの権限を変更"]} |
| BVuYh | /nen/health | /nen/health | null | {"click":["「こむぎ」の操作","30日のまとめ"]} |
| BnrQp | /mileage/earning-rules/new | /mileage/earning-rules/new | null | {"api":{"match":"PATCH /api/mileage/earning-rules","status":409,"body":{"success":false,"error":{"code":"VERSION_CONFLICT"}}},"click":["fill:名前=リンクをクリック","fill:マイル=10","保存して動かす"]} |
| CJlf4 | /mileage | /mileage?tab=balances | null | null |
| CVz5d | /affiliates | /affiliates?tab=payment | null | {"click":["期間を締める…","締める","銀行用 CSV…"]} |
| D6fh3 | /hq/support | /hq/support | null | {"click":["運営からの大事なお知らせを LINE で受け取る"]} |
| DA0Ag | /webhooks | /webhooks?tab=interactions | null | {"click":"「予約台帳」の中身を見る"} |
| DkRDE | /analytics | /analytics?tab=funnel | null | null |
| DxAAA | /webhooks | /webhooks?tab=sheets | null | null |
| E14GFm | /inflow-links/new | /inflow-links/new?name=夏のInstagram投稿&ref=summer-ig | null | {"api":{"match":"POST /api/entry-routes","status":409,"body":{"success":false,"error":{"code":"VERSION_CONFLICT"}}},"click":["発行して URL を受け取る","違いを比べる"]} |
| E2Any | /mileage | /mileage | null | {"role":"viewer","api":{"match":"GET /api/staff/me","status":200,"body":{"success":true,"data":{"id":"visual-qa-owner","name":"Kenta Kawano","role":"staff","email":null}}}} |
| E2l8cw | /conversions | /conversions | null | {"api":{"match":"/api/conversions/points","status":500,"body":{"success":false,"error":{"code":"LOAD_FAILED"}}}} |
| EMUl9 | /inflow-links | /inflow-links | null | {"role":"viewer","api":{"match":"GET /api/staff/me","status":200,"body":{"success":true,"data":{"id":"visual-qa-owner","name":"Kenta Kawano","role":"staff","email":null}}}} |
| Eo56k | /affiliates | /affiliates?tab=report | null | null |
| FDBsG | /inflow-links | /inflow-links?tab=connections | null | null |
| G83vi | /analytics/reports/new | /analytics/reports/new?id=report-weekly-friends | null | {"api":{"match":"PUT /api/analytics/report-schedules","status":409,"body":{"success":false,"error":"ほかの人が先に保存しました","code":"VERSION_CONFLICT"}},"click":"変更を保存する"} |
| Gqve5 | /affiliates/new | /affiliates/new | null | {"api":{"match":"POST /api/affiliates","status":409,"body":{"success":false,"error":"この紹介コードは既に使われています"}},"click":["fill:名前（表示名）=ペットライフ編集部","fill:紹介コード（リンクの最後に付く）=petlife2026","fill:連絡先メール=contact@example.com","登録して紹介リンクを発行する"]} |
| GtI4Y | /inflow-links | /inflow-links | null | {"click":["「夏のInstagram投稿」の操作","QRコードを見る"]} |
| H031gC | /webhooks?tab=incoming | /webhooks?tab=incoming | null | {"click":"受け取り口を作る"} |
| HMpVx | /hq | /hq | null | {"click":["然-NEN- 渋谷店 の設定"]} |
| I0w2e | /hq/banners/project?id=banner-project-qa-1 | /hq/banners/project?id=banner-project-qa-1 | null | {"click":["アーカイブする"],"manual":"測る相手を承認済みの ★BG-B（qIp42）・★BG-C に替える（オーナー 2026-10-06）。絵は musubo-design/バナー生成.pen でマサトさんの手元にあり、書き出し待ち"} |
| IRPw8 | /mileage | /mileage?tab=score | null | null |
| J1VA8 | /automations | /automations/drafts?id=automation-v8-template-draft | null | null |
| Jn95h | /nen-members | /nen-members | null | {"role":"viewer","api":{"match":"GET /api/staff/me","status":200,"body":{"success":true,"data":{"id":"visual-qa-owner","name":"Kenta Kawano","role":"staff","email":null}}}} |
| Jxmqh | /nen-campaigns | /nen-campaigns?tab=columns | null | null |
| L2Bzp | /mileage | /mileage/rewards/edit | null | null |
| L4Uov | /analytics | /analytics | null | {"role":"viewer","api":{"match":"GET /api/staff/me","status":200,"body":{"success":true,"data":{"id":"visual-qa-owner","name":"Kenta Kawano","role":"staff","email":null}}}} |
| M4jS9 | /hq/members | /hq/members | null | {"api":[{"match":"GET /api/staff/last-logins","body":{"success":true,"data":{"hq-1":"2026-09-30T10:12:00+09:00","hq-2":"2026-09-30T09:40:00+09:00","hq-3":"2026-09-28T18:02:00+09:00","hq-5":"2026-08-31T12:00:00+09:00"}}},{"match":"GET /api/staff$","body":{"success":true,"data":[{"id":"hq-1","name":"高田 誠","email":"takada@example.jp","role":"owner","lineLinked":true,"twoFactorEnabled":true,"isActive":true,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"active","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":null,"canAccessDescendantAccounts":true,"accountScope":"all","scopedLineAccountIds":[]},{"id":"hq-2","name":"中川 由美","email":"nakagawa@example.jp","role":"admin","lineLinked":true,"twoFactorEnabled":true,"isActive":true,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"active","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":null,"canAccessDescendantAccounts":true,"accountScope":"all","scopedLineAccountIds":[]},{"id":"hq-3","name":"佐野 直人","email":"sano@example.jp","role":"viewer","lineLinked":true,"twoFactorEnabled":true,"isActive":true,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"active","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":"visual-qa-account-store","canAccessDescendantAccounts":true,"accountScope":"accounts","scopedLineAccountIds":["visual-qa-account-store"]},{"id":"hq-4","name":"外部デザイン","email":"design@partner.jp","role":"viewer","lineLinked":true,"twoFactorEnabled":true,"isActive":false,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"pending_line","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":"visual-qa-account-prod","canAccessDescendantAccounts":true,"accountScope":"accounts","scopedLineAccountIds":["visual-qa-account-prod"]},{"id":"hq-5","name":"森 涼太","email":"mori@example.jp","role":"viewer","lineLinked":true,"twoFactorEnabled":true,"isActive":false,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"disabled","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":"visual-qa-account-event-2025","canAccessDescendantAccounts":true,"accountScope":"accounts","scopedLineAccountIds":["visual-qa-account-event-2025"]}]}}],"click":["中川 由美さんの権限を変更","役割","閲覧のみ（見るだけ）","変更を保存"]} |
| M4torY | /automations/new | /automations/new?draft=automation-v8-new | null | null |
| M8zhjL | /mileage/friends/detail?id=friend-1&adjust=1 | /mileage/friends/detail?id=friend-1&adjust=1 | null | {"click":["fill:マイル数=100","fill:詳しい理由=配送遅れのおわびとして付与（問い合わせ #1042）","fill:問い合わせ・注文・調整元ID=#1042"]} |
| MV5Os | /restaurant-test/menu | /restaurant-test/menu | null | {"click":["の操作","停止"]} |
| N1br7 | /nen-members | /nen-members | null | {"click":["版の履歴を見る"]} |
| N8ZrUl | /analytics | /analytics?tab=usage | null | null |
| NGh7b | /webhooks/new | /webhooks/new | null | {"api":{"match":"PUT /api/webhooks/outgoing","status":409,"body":{"success":false,"error":{"code":"VERSION_CONFLICT"}}},"click":"保存する"} |
| NkmwU | /restaurant-test/menu | /restaurant-test/menu | null | {"click":["ランチコース"]} |
| Nv7An | /mileage | /mileage?tab=score | null | {"click":["の操作","点数を直す"]} |
| OhguS | /hq/support/detail | /hq/support/detail?id=visual-ticket-1 | null | null |
| OylSV | /affiliates | /affiliates?tab=approvals | null | null |
| PFe9c | /analytics | /analytics?tab=routes | null | null |
| Q5le3 | /inflow-links | /inflow-links/detail?id=er-1 | null | null |
| Qgjmc | /hq/friend-attributes | /hq/friend-attributes?tab=marks | null | null |
| R6kIG | /mileage | /mileage/friends/detail?id=friend-1 | null | null |
| R8NNi | /mileage | /mileage?tab=score | null | {"click":["点数の変化"]} |
| S35pO | /mileage | /mileage?tab=rewards | null | null |
| S3pdQ | /automations | /automations | null | {"manual":"状態の見本帳（横並び）（2026-10-06）"} |
| SAUCs | /webhooks | /webhooks?tab=notify | null | null |
| T1j2Sw | /restaurant-test/google?tab=posts&view=new | /restaurant-test/google?tab=posts&view=new&kind=offer | null | null |
| Tj7n4 | /nen-campaigns | /nen-campaigns?tab=history | null | null |
| URzvC | /inflow-links | /inflow-links | null | {"api":{"match":"/api/entry-routes","status":500,"body":{"success":false,"error":{"code":"LOAD_FAILED"}}}} |
| UcBQ5 | /hq/banners/project?id=banner-project-qa-1 | /hq/banners/project?id=banner-project-qa-1 | null | {"click":["ライブラリから選ぶ"],"manual":"測る相手を承認済みの ★BG-B（qIp42）・★BG-C に替える（オーナー 2026-10-06）。絵は musubo-design/バナー生成.pen でマサトさんの手元にあり、書き出し待ち"} |
| Uv9AA | /webhooks | /webhooks?tab=interactions | null | null |
| VdKOK | /restaurant-test/dashboard | /restaurant-test/terms | null | null |
| VtJQ6 | /hq | /hq | null | {"role":"viewer","api":[{"match":"GET /api/auth/session","body":{"success":true,"data":{"id":"visual-qa-owner","name":"Kenta Kawano","role":"owner","readOnly":false,"permissionKeys":[],"assignedLineAccountId":null,"canAccessDescendantAccounts":true,"tenantId":null,"platformAdmin":true,"platformAdminState":null,"impersonation":{"id":"imp-1","tenantId":"t-1","tenantName":"然 -NEN- 本部","mode":"read","piiRevealed":false,"startedAt":"2026-10-01T06:20:00.000Z"},"stepUpMethod":"totp"},"csrfToken":"visual-qa-csrf"}}]} |
| W7Z57 | /hq/banners | /hq/banners | null | {"click":["プロジェクトを作る"]} |
| WSGvo | /conversions | /conversions | null | {"role":"viewer","api":{"match":"GET /api/staff/me","status":200,"body":{"success":true,"data":{"id":"visual-qa-owner","name":"Kenta Kawano","role":"staff","email":null}}}} |
| X4JcOf | /hq/templates | /hq/templates | null | {"click":["秋の新商品のお知らせの操作","編集"]} |
| XjOte | /inflow-links | /inflow-links?tab=script | null | null |
| YZ57z | /webhooks?tab=sheets | /webhooks?tab=sheets | null | {"click":"接続を解除"} |
| ZxKL5 | /inflow-links | /inflow-links?tab=ads | null | {"click":["費用を手で入れる"]} |
| aINnz | /affiliates | /affiliates?tab=payment | null | null |
| ao15G | /restaurant-test/dashboard | /restaurant-test/stores/new | null | null |
| bglah | /analytics | /analytics?tab=saved | null | null |
| c7dxp | /automations | /automations?tab=templates | null | null |
| cXqlS | /conversions/new | /conversions/new?name=商品を買った | null | null |
| cniyw | /nen-members | /nen-members | null | {"click":["採用 2"]} |
| dEv6G | /nen/members | /nen/members?tab=ranks | null | {"click":["ランク「シルバー」のその他操作","ランクを削除する"]} |
| dzx5D | /nen/members | /nen/members | null | {"manual":"状態の見本帳（幅1440超・横並び）（2026-10-06）"} |
| e5yBLx | /nen/members | /nen/members?tab=ranks | null | {"api":{"match":"DELETE /api/nen/rank-settings","status":409,"body":{"success":false,"error":{"code":"VERSION_CONFLICT"}}},"click":["ランク「シルバー」のその他操作","ランクを削除する","2 人を移して消す"]} |
| eLjeQ | /nen/pets | /nen/pets | null | {"click":["「こむぎ」の操作","ペットの情報を直す"]} |
| eY9F3 | /restaurant-test/tables | /restaurant-test/tables | null | {"click":["T3・窓側4人卓を停止"]} |
| faGn4 | /restaurant-test/dashboard | /restaurant-test/stores/new | null | {"api":{"match":"GET /api/restaurant-test/terms-agreement","status":200,"body":{"success":true,"data":{"documentKey":"musubo-terms","agreedVersion":"v0.1-draft","agreedAt":"2026-10-02 14:41:00"}}}} |
| fb9NJ | /nen/members | /nen/members?tab=ranks | null | null |
| gBrCz | /restaurant-test/tables | /restaurant-test/tables | null | {"click":"卓を追加する"} |
| gW0F2 | /webhooks | /webhooks?tab=incoming | null | null |
| h7A2F | /nen/pets | /nen/pets?tab=feeding | null | null |
| h7dmB | /affiliates | /affiliates?tab=offers | null | null |
| hadfk | /affiliates | /affiliates?tab=approvals | null | {"click":["check:佐藤 美咲の成果を選ぶ","check:鈴木 健の成果を選ぶ","操作を選ぶ"]} |
| iK4cQ | /analytics | /analytics?tab=url-clicks | null | null |
| iMnph | /hq/banners/project?id=banner-project-qa-1 | /hq/banners/project?id=banner-project-qa-1 | null | {"manual":"測る相手を承認済みの ★BG-B（qIp42）・★BG-C に替える（オーナー 2026-10-06）。絵は musubo-design/バナー生成.pen でマサトさんの手元にあり、書き出し待ち"} |
| j2hfkS | /common-actions/new | /common-actions/new | null | {"click":["待ち時間を入れる","＋ 処理を足す","条件で分ける","＋ 処理を足す","fill:名前=購入のお礼"]} |
| l5SRfT | /webhooks | /webhooks | null | {"role":"viewer","api":{"match":"GET /api/staff/me","status":200,"body":{"success":true,"data":{"id":"visual-qa-owner","name":"Kenta Kawano","role":"staff","email":null}}}} |
| meBRB | /hq/templates | /hq/templates | {"click":["秋の新商品のお知らせを配る","check:然 -NEN- 本店","check:然 -NEN- 渋谷店","check:2025年イベント","選んだ3アカウントを確かめる","一括の配布方法：選ぶ","press:ArrowDown","press:Enter","この内容で3アカウントへ配る"],"api":[{"match":"POST /api/hq/templates/visual-hq-tpl-autumn/distribute","status":200,"body":{"success":true,"data":{"runId":"visual-hq-run-1","status":"running","stores":[{"accountId":"visual-qa-account-prod","accountName":"然 -NEN- 本店","status":"succeeded","reason":null,"counts":{"created":0,"overwritten":1,"aliased":0},"createdName":null},{"accountId":"visual-qa-account-store","accountName":"然 -NEN- 渋谷店","status":"succeeded","reason":null,"counts":{"created":0,"overwritten":1,"aliased":0},"createdName":null},{"accountId":"visual-qa-account-event-2025","accountName":"2025年イベント","status":"pending","reason":null,"counts":{"created":0,"overwritten":0,"aliased":0},"createdName":null}]}}},{"match":"GET /api/hq/templates/visual-hq-tpl-autumn/distributions/","status":200,"body":{"success":true,"data":{"runId":"visual-hq-run-1","status":"running","stores":[{"accountId":"visual-qa-account-prod","accountName":"然 -NEN- 本店","status":"succeeded","reason":null,"counts":{"created":0,"overwritten":1,"aliased":0},"createdName":null},{"accountId":"visual-qa-account-store","accountName":"然 -NEN- 渋谷店","status":"succeeded","reason":null,"counts":{"created":0,"overwritten":1,"aliased":0},"createdName":null},{"accountId":"visual-qa-account-event-2025","accountName":"2025年イベント","status":"pending","reason":null,"counts":{"created":0,"overwritten":0,"aliased":0},"createdName":null}]}}}]} | {"click":["秋の新商品のお知らせをアカウントへ配る","配らない","配らない","配らない","選んだ3アカウントを確かめる"]} |
| n4DT7 | /restaurant-test/approvals | /restaurant-test/approvals | null | {"role":"viewer","api":{"match":"GET /api/staff/me","status":200,"body":{"success":true,"data":{"id":"visual-qa-owner","name":"Kenta Kawano","role":"staff","email":null}}}} |
| nAesv | /ec-commerce | /ec-commerce | null | {"click":["この行のその他操作","注文の状況を見る"]} |
| nH9L8 | /automations | /automations | null | {"role":"viewer","api":{"match":"GET /api/staff/me","status":200,"body":{"success":true,"data":{"id":"visual-qa-owner","name":"Kenta Kawano","role":"staff","email":null}}}} |
| oRbJi | /mileage | /mileage?tab=history | null | null |
| oqSJP | /nen-campaigns | /nen-campaigns | null | {"click":["「お誕生日クーポン」の操作","クーポンの決めごと"]} |
| ou60i | /restaurant-test/organization | /restaurant-test/organization | null | {"click":["ユーザーを追加する"]} |
| p03ImY | /hq/banners/project?id=banner-project-qa-1 | /hq | null | {"manual":"測る相手を承認済みの ★BG-B（qIp42）・★BG-C に替える（オーナー 2026-10-06）。絵は musubo-design/バナー生成.pen でマサトさんの手元にあり、書き出し待ち"} |
| p0kA3 | /inflow-links | /inflow-links?tab=connections&view=history | null | null |
| qSTVR | /inflow-links | /inflow-links?tab=ads | null | null |
| qf3ky | /restaurant-test/inventory | /restaurant-test/inventory | null | {"api":{"match":"PUT /api/restaurant-test/inventory","status":409,"body":{"success":false,"error":{"code":"VERSION_CONFLICT"}}},"click":["開ける時間と配分を保存"]} |
| r4ARpV | /hq/members | /hq/members | null | {"api":[{"match":"GET /api/staff/last-logins","body":{"success":true,"data":{"hq-1":"2026-09-30T10:12:00+09:00","hq-2":"2026-09-30T09:40:00+09:00","hq-3":"2026-09-28T18:02:00+09:00","hq-5":"2026-08-31T12:00:00+09:00"}}},{"match":"GET /api/staff$","body":{"success":true,"data":[{"id":"hq-1","name":"高田 誠","email":"takada@example.jp","role":"owner","lineLinked":true,"twoFactorEnabled":true,"isActive":true,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"active","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":null,"canAccessDescendantAccounts":true,"accountScope":"all","scopedLineAccountIds":[]},{"id":"hq-2","name":"中川 由美","email":"nakagawa@example.jp","role":"admin","lineLinked":true,"twoFactorEnabled":true,"isActive":true,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"active","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":null,"canAccessDescendantAccounts":true,"accountScope":"all","scopedLineAccountIds":[]},{"id":"hq-3","name":"佐野 直人","email":"sano@example.jp","role":"viewer","lineLinked":true,"twoFactorEnabled":true,"isActive":true,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"active","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":"visual-qa-account-store","canAccessDescendantAccounts":true,"accountScope":"accounts","scopedLineAccountIds":["visual-qa-account-store"]},{"id":"hq-4","name":"外部デザイン","email":"design@partner.jp","role":"viewer","lineLinked":true,"twoFactorEnabled":true,"isActive":false,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"pending_line","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":"visual-qa-account-prod","canAccessDescendantAccounts":true,"accountScope":"accounts","scopedLineAccountIds":["visual-qa-account-prod"]},{"id":"hq-5","name":"森 涼太","email":"mori@example.jp","role":"viewer","lineLinked":true,"twoFactorEnabled":true,"isActive":false,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"disabled","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":"visual-qa-account-event-2025","canAccessDescendantAccounts":true,"accountScope":"accounts","scopedLineAccountIds":["visual-qa-account-event-2025"]}]}}]} |
| rI5uh | /hq/banners/project?id=banner-project-qa-1 | /hq/banners/project?id=banner-project-qa-1 | null | {"click":["画像 1 を開く"],"manual":"測る相手を承認済みの ★BG-B（qIp42）・★BG-C に替える（オーナー 2026-10-06）。絵は musubo-design/バナー生成.pen でマサトさんの手元にあり、書き出し待ち"} |
| rRk0C | /affiliates | /affiliates | null | {"manual":"状態の見本帳（横並び）。文言は実装にある（2026-10-06）"} |
| ralAc | /webhooks | /webhooks?tab=api-tokens | null | {} |
| rm92Y | /restaurant-test/reservations | /restaurant-test/reservations | null | {"click":["電話の予約を入れる","fill:名前・電話番号で探す=山田","山田 花子","fill:人数=4","17:00"]} |
| tJqST | /automations/new | /automations/new?draft=automation-v8-new | null | {"api":{"match":"PUT /api/automation-drafts","status":409,"body":{"success":false,"error":"ほかの人が先に保存しました","code":"version_conflict"}},"click":"下書きを保存"} |
| u5CuB8 | /analytics | /analytics?tab=cross | null | {"click":["集計する"]} |
| ujcar | /nen-members | /nen-members | null | {"click":["そらくんの写真を見送る"]} |
| usDpO | /affiliates | /affiliates?tab=payment | null | {"click":["期間を締める…"]} |
| v9JWQ | /affiliates | /affiliates | null | {"role":"viewer","api":{"match":"GET /api/staff/me","status":200,"body":{"success":true,"data":{"id":"visual-qa-owner","name":"Kenta Kawano","role":"staff","email":null}}}} |
| vWJEm | /inflow-links/new | /inflow-links/new?name=夏のInstagram投稿&ref=summer-ig | null | {"api":{"match":"POST /api/entry-routes","status":409,"body":{"success":false,"error":{"code":"VERSION_CONFLICT"}}},"click":"発行して URL を受け取る"} |
| w5pwG | /nen-campaigns/edit | /nen-campaigns/edit?key=review_request | null | null |
| wWrpY | /webhooks | /webhooks | null | {"manual":"状態の見本帳（横並び）。文言は実装にある（2026-10-06）"} |
| x9HIR | /restaurant-test/google?tab=reviews&view=draft | /restaurant-test/google?tab=reviews&view=draft&id=rv-2 | null | null |
| xqr1Q | /hq/friend-attributes | /hq/friend-attributes | null | {"click":["タグを作る","所属フォルダ"]} |
| y0sapC | /hq/friend-attributes | /hq/friend-attributes?tab=fields | null | null |
| yLKwV | /hq/members | /hq/members | null | {"api":[{"match":"GET /api/staff/last-logins","body":{"success":true,"data":{"hq-1":"2026-09-30T10:12:00+09:00","hq-2":"2026-09-30T09:40:00+09:00","hq-3":"2026-09-28T18:02:00+09:00","hq-5":"2026-08-31T12:00:00+09:00"}}},{"match":"GET /api/staff$","body":{"success":true,"data":[{"id":"hq-1","name":"高田 誠","email":"takada@example.jp","role":"owner","lineLinked":true,"twoFactorEnabled":true,"isActive":true,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"active","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":null,"canAccessDescendantAccounts":true,"accountScope":"all","scopedLineAccountIds":[]},{"id":"hq-2","name":"中川 由美","email":"nakagawa@example.jp","role":"admin","lineLinked":true,"twoFactorEnabled":true,"isActive":true,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"active","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":null,"canAccessDescendantAccounts":true,"accountScope":"all","scopedLineAccountIds":[]},{"id":"hq-3","name":"佐野 直人","email":"sano@example.jp","role":"viewer","lineLinked":true,"twoFactorEnabled":true,"isActive":true,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"active","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":"visual-qa-account-store","canAccessDescendantAccounts":true,"accountScope":"accounts","scopedLineAccountIds":["visual-qa-account-store"]},{"id":"hq-4","name":"外部デザイン","email":"design@partner.jp","role":"viewer","lineLinked":true,"twoFactorEnabled":true,"isActive":false,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"pending_line","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":"visual-qa-account-prod","canAccessDescendantAccounts":true,"accountScope":"accounts","scopedLineAccountIds":["visual-qa-account-prod"]},{"id":"hq-5","name":"森 涼太","email":"mori@example.jp","role":"viewer","lineLinked":true,"twoFactorEnabled":true,"isActive":false,"permissionKeys":[],"notificationPreferences":{},"inviteStatus":"disabled","createdAt":"2026-01-10T00:00:00.000Z","updatedAt":"2026-08-25T00:02:00.000Z","assignedLineAccountId":"visual-qa-account-event-2025","canAccessDescendantAccounts":true,"accountScope":"accounts","scopedLineAccountIds":["visual-qa-account-event-2025"]}]}}],"click":["権限者を招待"]} |
| yvOtn | /analytics | /analytics?tab=reactions | null | null |
| z2tvtX | /nen/health | /nen/health?tab=items | null | null |
| zOpMG | /hq/banners/project?id=banner-project-qa-1 | /hq/banners/project?id=banner-project-qa-1 | null | {"api":{"match":"GET /api/hq/banners/presets","body":{"success":true,"data":{"presets":[{"key":"line_rich_message","group":"line","label":"リッチメッセージ","note":"1040×1040。トークに大きく出る正方形の画像","apiSize":"1024x1024","targetWidth":1040,"targetHeight":1040,"aspectRatio":"1:1"},{"key":"line_image_message","group":"line","label":"画像メッセージ・クーポン","note":"1040×1040。画像だけを送るメッセージやクーポンの絵","apiSize":"1024x1024","targetWidth":1040,"targetHeight":1040,"aspectRatio":"1:1"},{"key":"line_card","group":"line","label":"カードタイプ・カルーセル","note":"1200×795（1.51:1）。横にめくれるカードの画像","apiSize":"1536x1024","targetWidth":1200,"targetHeight":795,"aspectRatio":"1.51:1"},{"key":"line_rich_menu_large","group":"line","label":"リッチメニュー（大）","note":"2500×1686。トーク画面の下に常時表示されるメニュー","apiSize":"1536x1024","targetWidth":2500,"targetHeight":1686,"aspectRatio":"3:2"},{"key":"line_rich_menu_small","group":"line","label":"リッチメニュー（小）","note":"2500×843。高さが半分のメニュー","apiSize":"1536x1024","targetWidth":2500,"targetHeight":843,"aspectRatio":"3:1"},{"key":"line_voom_square","group":"line","label":"LINE VOOM（正方形）","note":"1080×1080。VOOM の投稿画像","apiSize":"1024x1024","targetWidth":1080,"targetHeight":1080,"aspectRatio":"1:1"},{"key":"line_voom_vertical","group":"line","label":"LINE VOOM（縦長）","note":"1080×1920。縦いっぱいの投稿","apiSize":"1024x1536","targetWidth":1080,"targetHeight":1920,"aspectRatio":"9:16"},{"key":"sns_instagram_feed","group":"sns","label":"Instagram フィード（正方形）","note":"1080×1080","apiSize":"1024x1024","targetWidth":1080,"targetHeight":1080,"aspectRatio":"1:1"},{"key":"sns_instagram_portrait","group":"sns","label":"Instagram フィード（縦長）","note":"1080×1350（4:5）","apiSize":"1024x1536","targetWidth":1080,"targetHeight":1350,"aspectRatio":"4:5"},{"key":"sns_story","group":"sns","label":"ストーリー・リール・TikTok","note":"1080×1920（9:16）","apiSize":"1024x1536","targetWidth":1080,"targetHeight":1920,"aspectRatio":"9:16"},{"key":"sns_x_post","group":"sns","label":"X（旧Twitter）投稿","note":"1200×675（16:9）","apiSize":"1536x1024","targetWidth":1200,"targetHeight":675,"aspectRatio":"16:9"},{"key":"sns_ogp","group":"sns","label":"OGP・Facebook リンク画像","note":"1200×630（1.91:1）。リンクを共有したときに出る画像","apiSize":"1536x1024","targetWidth":1200,"targetHeight":630,"aspectRatio":"1.91:1"},{"key":"sns_youtube_thumbnail","group":"sns","label":"YouTube サムネイル","note":"1280×720（16:9）","apiSize":"1536x1024","targetWidth":1280,"targetHeight":720,"aspectRatio":"16:9"}],"maxCount":4,"engineReady":true,"usage":{"month":{"used":150,"limit":150,"remaining":0},"today":{"used":6,"limit":30,"remaining":24},"paused":false,"blocked":false,"blockedReason":null,"planState":"active","pausedReason":null}}}},"manual":"測る相手を承認済みの ★BG-B（qIp42）・★BG-C に替える（オーナー 2026-10-06）。絵は musubo-design/バナー生成.pen でマサトさんの手元にあり、書き出し待ち"} |
| zQ5vY | /nen/members | /nen/members?tab=lifetime | null | null |
| zaqP9 | /mileage | /mileage | null | {"manual":"状態の見本帳（幅1440超・横並び）。文言は実装にある（2026-10-06）"} |
| ziSgL | /common-actions/versions | /common-actions/versions?id=ca-2 | null | null |

## 次のタスクはこれ

1. 司令塔の回答を受け、欠落した撮影指定とLIFF27枚のURLを測定専用の写しまたは正本の地図で整える。
2. 管理画面243枚・LIFF38枚を正しい状態で測り直し、初回値を確定する。状態やデータが再現できない板は数えない。
3. 機能ごとにコードを修正・測定・検証・コミット。90%以上の候補だけを目視未として渡す。
