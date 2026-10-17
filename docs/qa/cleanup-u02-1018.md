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

G01→U05/U02の初期被覆2件（自動応答の祝日欄）を引き継いだ。G01の1440初期画像と矩形では、共通CreatePageのfloating footerが本文へ32px重なり、祝日ボタンの中心がキャンセル/保存帯に当たっていた。共通の負の上余白を0にし、帯の位置を保って本文のスクロール領域をその上端までに収める。自動応答画面本体と権限は変更しない。実画面の前後と3幅の結果は下の実ブラウザ確認に記録した。

## 検査の記録

- 依存導入とupdate-engine/shared/line-sdkの型生成を完了。初回tscはupdate-engineのdist未生成3件のみ、ビルド後のtscは終了0。ログは保持。
- 初回関連349ファイル：2150成功・5失敗。上記の古い字面4件と色の読取1件。製品の操作試験は成功。再検査の結果は下に追記。
- 初回変更lint：エラー0、Flexのimgに既存の警告2件。LINEの画像寸法とCDNを保持し、無視注釈は追加しない。
- 既存トークン解決値：6327→6334、既存値の差0。外部証拠 `U02-EVIDENCE/token-resolved-values.json`。
- 修正後の軽い関連17ファイル138試験（最大1 worker）は全件成功。関連349ファイルの再実行はheavy待ちのまま未開始で取り消し、コミット済みの全体CIへまとめた。全工程・ビルド・実画面の最終結果は下記。未確認を合格には数えない。
- B-273の最終増分は0。試験の見出し変更による新規判定は既存の見出しへ戻して解消。アバターの色読取の一般化案は新しいソース消費として判定されるため採用せず、警告色2名の定義を保持。元の4.5:1検査をそのまま実行して成功。型監査は新規候補0・一時許可0。

外部証拠は `~/lh-work/design/v8/review/CLEANUP-1017/U02-EVIDENCE/`。参照調査は10作業ツリー・15対象×10＝150組。`unused-resolved-imports.tsv`、`css-disposition.tsv`（430行）、`css-candidates.json`、`retained-suppressions.json`、`before.json`と最終後の集計、全23項目の完了記録は1つ上の `~/lh-work/design/v8/review/CLEANUP-1017/DONE-U02.tsv`。

150組の調査は、削除した14対象と保持したUpdateBannerを含む。残る2CSS（header/slide-panel）は削除した未使用部品だけが読む専用CSSであり、初めからimport0と数えてはいない。別途10作業ツリー×2の参照先を解決し、現役からの読込なしを確認した（`companion-css-imports.json`）。

## 最終検証の対象と集計

製品コードの検証対象は `48b714cc639de92042fa209502b6cd6f4de4860a`。以下の数は、試験・設計資料・文書を除く今回変更した36パスだけの前後比較で、製品全体の件数ではない。

| 項目 | 土台 | 整理後 |
|---|---:|---:|
| 存在するファイル | 36 | 20 |
| 行数 | 7,857 | 6,702 |
| 明示的なany | 1 | 0 |
| as式 | 20 | 11 |
| 無視注釈 | 3 | 0 |

OTP・条件入力など、変更していないパスの注釈はこの集計に含めない。行数や個数の新しい上限は設けていない。試験ファイルの削除・改名0、変更21本の対応は `U02-EVIDENCE/tests-map.json`。

- 指定ci-localの実行ログ：`~/lh-work/tools/hq/ci-local/logs/20261018-032138-48b714cc63-38088/`。Workerは1,096ファイル・12,983試験成功、型・ビルド成功。管理画面はlint・型・picker接続・V8固定の検査成功。後半の最終結果は下記。
- 先行する画面確認用の本番形式ビルドは成功。ログ：`U02-EVIDENCE/u02-browser-build.log`。これは全体CIや実画面検査の合格の代わりに数えない。
- PRは未作成のため、ci-localの反映履歴ゲートはPR情報不足として省略。既存ゲートの本文を変更せず、司令塔指定の仮番号 `0000` を明示して別途実行し成功。正式PRの採番確認は司令塔へ残す。ログ：`U02-EVIDENCE/u02-release-entry-placeholder-check.log`。

全体Web試験の初回は2,297ファイル成功・7ファイル失敗、13,671試験成功・8失敗・skip/todo各1。失敗は下記の共通CSSを読む古い表記固定だけで、画面の実装・数値・動作は変更しない。2件の純見た目試験と、それを含む13件の古いassertを外した。失敗ログは保存し、該当7ファイル39試験は再検査成功。B-273の新規ソースassertは引き続き0。

| 全体試験で見つけた対象 | 外す古い固定 | 残す守り |
|---|---|---|
| theme-switch-contract | 角丸2値が同じ:rootブロックへ直書きされる試験1件 | htmlのV8固定、旧テーマの環境変数・保存値・切替入口なしの全走査。角丸の供給と実値は3幅のブラウザ結果に記録。 |
| v8-control-border-contract | 枠色・影・選択色の3宣言が同じブロックに並ぶassert3件 | 旧テーマのセレクタなし、部品のトークン参照、選択中・赤・無効・OTPの確認は保持。 |
| automations/new-board-numbers | 共通角丸10pxの直書きassert1件 | 現役入口・共通RadioCard・操作の共通値への接続は保持。 |
| broadcasts/broadcast-numfix | 共通文字2値の直書きassert2件 | 見出し・名前の共通文字トークンへの接続など、他のassertは変更なし。 |
| ec-commerce/connector-panel-numfix | 共通入力の高さ/余白が直書きされる純見た目試験1件 | 共通Cardへの接続、見出し、選択欄の折り返しは保持。 |
| webhooks/webhooks-board-numbers / webinars/new-board-numbers | 共通入力36pxの直書きassert各1件 | 現役TextField/Cardの接続と他のassertは保持。実入力は3幅で高さ36・行間21・左右12・角丸10・入力保持を確認。 |

これらは今回の共通値集約に直接結び付く読取試験だけの整理で、利用側の画面本体やAPIは変更していない。`fce4d5c961` で管理画面を再検査し、2,304ファイル・13,677試験成功、既存のskip/todo各1。lint・型・picker・V8固定も再度成功。実行ログは `~/lh-work/tools/hq/ci-local/logs/20261018-035911-fce4d5c961-1864/`、外部控えは `U02-EVIDENCE/web-rerun-summary.md`。この部分CIの失敗0、実行不能1はPRメタデータのみ（終了2）。初回全体CIのWeb失敗を隠さず、この再検査で解消した記録として扱う。

## 実ブラウザの確認

同じ製品コードの本番形式ビルドを模擬APIだけにつなぎ、自動応答の条件入力と外部連携の共通入力を1152・1440・1920×900で操作・撮影した。DOMのinnerWidthと画像のピクセル幅もそれぞれ照合。初回の画像7枚は撮影範囲が1102pxに切れていたため不採用として `capture-attempt-1/` に保持し、撮影直前に幅を再適用して撮り直した。画像はブラウザが出力するJPEGをそのまま保存している。

- 初期の保存帯上端は3幅とも814pxのまま。本文のスクロール下端は846→814pxとなり、保存帯に重ならない。
- 祝日の選択欄はクリックで開き、Escで閉じて焦点が戻る。中央の当たり先は欄自身、追加した言葉のタグも保持。3幅とも横はみ出し0。
- 共通TextFieldは3幅とも高さ36・行間21・左右余白12・角丸10、別の入力へ移っても名前を保持。runtimeの角丸control/panelは10/16、caption/labelは12のまま。ソースの直書きから参照へ変えたための失敗であり、製品の値は変わっていない。
- 初期と操作後の画像を目視し、対象画面の入力・選択欄・保存帯の重なりと横への切れがないことを確認。全462枚の設計照合を新たに合格とする記録ではない。

証拠は `U02-EVIDENCE/footer-retake.json`、`common-field-retake.json`、`footer-after-{1152,1440,1920}.jpg`、`footer-after-scrolled-{1152,1440,1920}.jpg`、`common-field-{1152,1440,1920}.jpg`。確認用のタブは閉じ、寸法設定を戻し、自分で起動したサーバーも停止した。

## CI接続の持ち主への引き渡し

全体CIのV8 step11は、土台に含まれるG01の整理で削除済みの `dialog-description-band-fixture.mjs` をworkflowが呼び、実検査の開始前に失敗した。G01が既知として渡した3工程の1つである。`G02-HANDOFF.md` にあるG02の修正 `f09545a28a655ddfe2198f4c8e90d63f8b931da9` は接続を直しており、司令塔の取り込み対象。U02ではG02所有のworkflowを変更せず、削除されたCLIをダミーで戻さない。

G02の同コミットが定義する現役23ファイルの実ブラウザ検査を、同じU02の製品コードで別途実行し、79試験成功（失敗・skip・todo 0、終了0）。既存の故障対照を保ち、active-modal-auditなど現在の見張りも含む。未実行・失敗したCI工程を合格に読み替えない。実行命令とログ：`U02-EVIDENCE/u02-current-fixtures.sh` / `u02-current-fixtures.log`。CIの生ログ：`U02-EVIDENCE/ci-known-G02-deleted-fixture-call.log`。

## 最終結果と残る工程

- 全体ci-localは最後まで実行し、成功77・失敗5・省略32（PRメタデータ不足1を含む）、終了1。全体CIの合格ではない。失敗5の内訳は、初回Web試験1工程（上記の再検査で解消）、G02所有の廃止済み呼出し3工程（V8 step11・17・25）、それらに連動する最終集約ゲート1工程。G02の接続修正と正式PR採番後の通常ゲートは、司令塔の統合工程へ残す。内訳と担当は `U02-EVIDENCE/final-validation.json`。
- 通常設定と画面確認用の本番形式ビルド、共通パッケージ・Worker・Web・LIFF・MCP・スクリプトの型/試験、Webのlint、必須入力の検査、権限・別アカウント・通知・タグ編集・MFA・安全ヘッダー・フォームの実操作は成功。
- V8は3幅の基本崩れ36場面、狭いプレビューと入力保持、予約日付、変更前から増えた不具合なし、一覧の行/操作と故障対照、速度目標（2000人・PERF-01を含む）、仮想表の選択/キーボード/幅が成功。守りのしきい値・許可・実行条件は変えていない。
- 製品コードは `48b714cc639de92042fa209502b6cd6f4de4860a` から変更なし。`fce4d5c961` は上記7試験とQAだけの修正で、Web全件再検査済み。この最終記録ではMemoryとこの検査記録だけを更新。差分は `U02-EVIDENCE/product-revision-equivalence.json`、件数は `scoped-before-after.json`、受理した画像の幅・高さ・ハッシュは `accepted-screenshots.json`。
- 4種類の完了記録は `DONE-U02.tsv`。未使用9部品/7CSS・4表示export・14静的クラスを整理し、CLIの更新通知、動的8クラス、他枝で使う音声欄、入力の契約がある注釈、G01の読取契約に関わる色2定義は保持。新migrationは不要で、番号案なし。push・PR・DB更新・配備・実送信・実決済なし。自分で起動した確認用サーバーとCIのサーバーの終了も確認した。
