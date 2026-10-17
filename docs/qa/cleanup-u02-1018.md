# 整理段2 U02（2026-10-18）

指定枝 `codex/kenta-train-cleanup-u02-1018`、土台 `e5f527128c`。開始時クリーン・doctor合格。検査前fetchで `origin/codex/development=e9b423eb7c798f7d5a530a05a6e86a0c26dd56f9` を記録。この本線は土台に包含済みで、追加mergeなし。API・DB・U01所有のButton/DataTable/common-a、親EC、許可追加、上限変更、push/PR/配備/実送信/実決済はなし。Slackへの書込みなし。束の明示指示を作業範囲とし、所有宣言の最終照合は司令塔へ返す。

## 計画の全23項目

| 計画ID | 結果・残す理由 |
|---|---|
| U01 | 未使用のEmbeddedPageProvider/useEmbeddedPageを削除。10作業ツリーの静的/動的import参照0。 |
| U02 | 未使用options-sectionsを削除。現役options-dialogとV8編集の受付・期限・送信後設定を保持。 |
| U03 | 未使用SelectionDialogを削除。現役EntityPickerDialog/SourcePickerDialogの選択・取消・焦点は保持。 |
| U04 | 未使用AccountSwitcherを削除。現役TopBar→AccountSwitchMenu→account-contextは変更なし。旧部品だけを読む1試験を外し、現役の切替・所属・失敗の試験を保持。 |
| U05 | 未使用layout/Headerと専用CSSを削除。PageHeading/TopBarはそのまま。旧部品の設計見本レコードを削除。 |
| U07 | 未使用TagBadgeを削除。TagPillのフォルダ色・削除確認・友だち一覧/詳細/受信箱は保持。 |
| U08 | 未使用entity-picker-windowの再exportファイルだけ削除。entity-pickerのEntityPickerWindow公開exportは保持。カタログの持ち主を現役へ。 |
| U09 | 未使用SlidePanelと専用CSSを削除。これは手順内のアニメーションであり、Drawer/DetailPanelの保存・閉じ方の実装ではない。カタログの誤った持ち主参照も外す。 |
| U10 | 未使用OpsPageHeaderを削除。旧部品だけを読む1試験を削除し、運営の外枠・権限・メニュー・スクロール・焦点の試験は保持。 |
| U11 | UpdateBannerは保持。use-update-status、UpdateButton、CLI更新の契約試験が存続し、更新通知の仕様廃止は承認されていない。 |
| U17 | 他の識別子参照0のfileSizeLabel/progressBadgeText/formatJstShortDateTime/SUPPORT_STATUS_LABELSを削除。問い合わせ業務の状態型は保持。 |
| U19 | 読込0のCSS5本を削除。layout/header・slide-panelの専用CSS2本も部品と一緒に削除。カード例外1行を削除（追加0）、型カタログ・設計見本の参照を整理。 |
| U20 | 430候補を担当ごとに分類。共通23名のうち動的8名は保持、音声入力audioManualは別枝の使用を確認して保持、静的未参照14名だけ削除。他407名は各UI持ち主へ返す。 |
| Q01 | FlexNodeのany辞書をunknownへ。hero/header/body/footer/justifyContentを明示し、9か所の繰り返しcastを削除。LINE固有の色・寸法・未知属性と安全なURLの検査は保持。 |
| Q06 | 並べ替えのuseMemoにidOfを正しく含め、無視注釈1件を削除。Flexのany無視1件と未使用部品の画像無視1件も削除。OTP3件・条件入力2件は初回/状態変化/内容変化の限定実行が入力と焦点を守るため保持。他機能は各UI持ち主へ。 |
| Q07 / V02 | 重複計上せず、共通TextField/StatusBadgeの値を用途別トークンへ。他領域の寸法、LINE見本の色・breakpointまで一括置換しない。 |
| D01 / R03 | 状態語と旧語の表をlib/status-labelsに集約。status-wordsは互換exportだけ。StatusBadge/StatusPillは1回だけ読む。「使用中」「使っている」を用途として保持し、active/稼働中は有効。別状態・未知値・distinctFrom・文字以外の中身を保持。 |
| D02 | formatJstDateTimeの端末ローカル解釈を除去し、formatへ直接委譲。UTC保存値とJST壁時計（hq-banners）・入力・CSV・店舗timeZoneを区別して保持。 |
| D06 | 日時の公開名は互換の役目があるため保持。booking-menus/channels-tablesのformatReadAtはU07所有なので変更しない。型付きAPIや業務境界の委譲も行数だけでは削除しない。 |
| V01 | @themeのクラス生成と:rootの実行時供給を保持し、同じ意味の色/文字/角丸を既存polish値へ。同じ:rootに重ねた6宣言を除去。既存6327トークンの解決値差0、新規7は共通入力の元の寸法。別の動的な正本なし。 |
| V03 | 1行欄・1行分の複数行欄で高さ/行間/余白を共有。札の文字/点/余白も既存意味別値へ。新variant・APIなし。IME/ref/必須/読み上げ/エラー/焦点は現役試験で保持。 |

LONG-FILES-1018.tsvにU02の割当は0本。TS/TSXの所有範囲に1500行以上はなし。globals.cssは一覧対象外で、runtime定義と読み込みを維持する。分割だけのためにG01所有の全読取検査やクラス生成の接続を変えない。

U13（返信案内）はU07所有のため削除せず読取調査のみ。4関数の実呼出し0、現役V8内のコメント参照1。U01/U03/U13/2CSSの再確認のうちU13だけはこの所有者へ返す。

## 外した試験・ファイルの対応

| 対象 | 外した物 | 残した守り／移行先 |
|---|---|---|
| accounts-setup-visual-parity | 旧account-switcherだけを読む1試験 | shell/app-top-bar-hq.react：現役切替・統括に戻る・店だけの権限。account-contextの所属外拒否等は保持。 |
| ops-shell-overflow-contract | 旧OpsPageHeaderだけを読む1試験 | 同ファイルの外枠・メニュー・Esc・スクロール・焦点は保持。 |
| action-menu-v7-contract | 色・px・旧形を固定した見た目1試験、旧nodeのassert1件 | 選択/実行/矢印/Enter/Esc/イベント伝播/portal/画面端の表示範囲の試験は保持。 |
| v5-shell-contract | ソース文字列と旧nodeの固定 | 現役Breadcrumbを描画してリンク・現在地・省略・無効な省略リンクなしを確認。 |
| v5-b2/v5-b4 | 旧nodeを固定するassert5件 | HTML属性・見出し階層・読み上げ・busy・失敗・通知・外部リンクと生色/焦点の検査は保持。 |
| control-dimensions/text-field-unified/kpi-band | 入力36pxのassert1件、複数行120pxと題12/500/18の純見た目2試験 | 入力・読み上げ・必須・誤り・縦resize・層/焦点・帯の操作/意味を保持。実寸とはみ出しは実ブラウザで確認。 |
| design-token-contract | 生値の重複がなくなった3組の既存例外 | 例外の追加0。未許可の重複を落とす検査は保持。 |
| avatar.test（変更なし） | なし | 警告色2名はこの色の安全性検査の読取契約に合わせ、元の定義を保持。読取器の一般化はB-273が未知のソース検査と判定するためG01へ返す。全6組の4.5:1以上の検査と閾値はそのまま。 |
| card-shape-contract | 削除済みCSSの例外1行 | 現役のカード・はみ出し・権限の見張りはそのまま、許可追加0。 |

試験ファイルの削除・改名は0。上記以外のUI束の試験やButton/DataTableの契約は変更しない。

G01→U05/U02の初期被覆2件（自動応答の祝日欄）を引き継いだ。G01の1440初期画像と矩形では、共通CreatePageのfloating footerが本文へ32px重なり、祝日ボタンの中心がキャンセル/保存帯に当たっていた。共通の負の上余白を0にし、帯の位置を保って本文のスクロール領域をその上端までに収める。自動応答画面本体と権限は変更しない。実画面の前後と3幅の結果は最終検査で確かめる。

## 検査の記録

- 依存導入とupdate-engine/shared/line-sdkの型生成を完了。初回tscはupdate-engineのdist未生成3件のみ、ビルド後のtscは終了0。ログは保持。
- 初回関連349ファイル：2150成功・5失敗。上記の古い字面4件と色の読取1件。製品の操作試験は成功。再検査の結果は下に追記。
- 初回変更lint：エラー0、Flexのimgに既存の警告2件。LINEの画像寸法とCDNを保持し、無視注釈は追加しない。
- 既存トークン解決値：6327→6334、既存値の差0。外部証拠 `U02-EVIDENCE/token-resolved-values.json`。
- 修正後の軽い関連17ファイル138試験（最大1 worker）は全件成功。関連349ファイルの再実行はheavy待ちのまま未開始で取り消し、コミット済みの全体CIへまとめる。全工程・ビルド・実画面の最終結果は完了時に追記する。未確認を合格には数えない。
- B-273の最終増分は0。試験の見出し変更による新規判定は既存の見出しへ戻して解消。アバターの色読取の一般化案は新しいソース消費として判定されるため採用せず、警告色2名の定義を保持。元の4.5:1検査をそのまま実行して成功。型監査は新規候補0・一時許可0。

外部証拠は `~/lh-work/design/v8/review/CLEANUP-1017/U02-EVIDENCE/`。参照調査は10作業ツリー・15対象×10＝150組。`unused-resolved-imports.tsv`、`css-disposition.tsv`（430行）、`css-candidates.json`、`retained-suppressions.json`、`before.json`と最終後の集計、全23項目の完了記録は同じ場所の`DONE-U02.tsv`。
