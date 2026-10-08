# コンバージョン（V8）の動き

入口：
- 一覧 `app/conversions/page.tsx`（V8 のときだけ `src/v8/conversions/list.tsx`。成果とアフィリエイトのタブ `?tab=affiliates|offers|approvals|payment|report` は今までどおり `/affiliates` へ移す）
- 作る `app/conversions/new/page.tsx`（V8 のときだけ `src/v8/conversions/create.tsx`。先に分けるので、V8 では v7 の画面の読み込みは走らない）

絵：一覧 `r6dJFy`・1152 `BygrU`・閲覧のみ `WSGvo`・状態の見本帳 `E2l8cw`、作る `j8p3yj`・競合 `cXqlS`。

## 受け付ける URL と指定
- `/conversions?highlight=<成果地点ID>`：作る画面から戻ったとき。その行の頁へ移し、行を目立たせ、「保存しました」の帯を出す（今と同じ）
- `/conversions?tab=points`：成果地点のタブ（既定）。ほかのタブ名は `/affiliates` へ
- `/conversions/new?name=<名前>`：**新しく足した**。名前を入れて開く。同じ名前の成果地点があれば、開いた時点で競合の帯（cXqlS）が出る

## 呼ぶ口（今の画面と同じ）
一覧
- 一覧：`api.conversions.definitions({ from, to, lineAccountId, q, sort, limit: 100, cursor })` を続く頁まで（50頁・5000件で止め、切れたら帯で断る）。並びは `count_desc`・`value_desc`・`name_asc`
- 集計：`api.conversions.definitionReport({ from, to, lineAccountId })`（この30日）。集計だけ失敗したら一覧は残し、帯から「集計を読み直す」
- 止める3択：`definitionDeleteImpact(id)` で影響を読んでから `stopDefinition`・`replaceDefinition`・`deleteDefinition`（版と理由つき。理由は必須）
- 中身を見る窓：`definitionEvents(id, 10)`・受け口なら `ingestionEvents(id, 5)`。取消・戻しは `appendReversal`
- 編集：`reviseDefinition(id, { expectedVersion, … })`。409 は上書きせず読み直しを促す
- 下書きの公開 `publishDefinition`、受け口の鍵 `issueIngestSecret`・止める／再開 `setIngestDisabled`
- 複製：`createDefinition`（同じ数え方で「〇〇」のコピー。使う場所は引き継がない）
- CSV：`exportDefinitions({ from, to, lineAccountId })` → `conversion-definitions-<日付>.csv`
- 役割：`useStaffRole()`（`/api/staff/me`）。変える操作は owner・admin だけ

作る
- 同じ名前の確認：`api.conversions.points()`（同じ集計対象の中だけで比べる）
- 使う場所の候補：`analytics.v6Funnels.list`・`nenCampaigns.settings`・`automations.list`（種類ごと。403 は「見る権限なし」）
- 試算：`previewDefinition`（入力を変えるたびに古い試算を中断）
- 保存：`createDefinition`（送る形は今と同じ）。409（同じ名前を先に保存された）は上書きせず競合の帯

## 今の画面と変えたところ（見せ方だけ）
- 一覧の行を押すと、表の下に「詳細の小窓」が開く（絵 r6dJFy）。くわしい中身・取消は「中身を見る」の窓（今と同じ窓を写した `dialogs.tsx`）
- 止める・差し替える・削除するは、窓ではなく表の下の「止めるときの小窓」（3択＋理由）
- 行の右端は「使う場所を足す」と「…」。「…」は 中身を見る・使う場所を見る（誰でも）／使う場所を足す・編集する・止める（または公開する）・複製する（権限のある人だけ）
- 閲覧のみの人には、作る・使う場所を足す・変える操作を置かない（押せない形でも置かない）。閲覧のみの帯を出す。場所だけ空ける
- 作る画面（`create.tsx`）は、閲覧のみと分かったら入力の欄・試算・使う場所の列を置かず、閲覧のみの帯と「一覧へ戻る」だけを出す（作る画面なので見せる中身が無い。2026-10-06 オーナー決定）
- 状態の札は 動いている・止めている・下書き・入力不良・起点停止・どこからも使われていない（口の `stateCounts`）。1152 の板は札2つで、ほかは「よく使う絞り込み」から選ぶ
- 数の帯の言葉は「この30日の成果」「この30日の金額」（集計の範囲どおり。絵の「今月」とは言わない）。前の30日との差を補足に出す
- 「使われている場所」は名前を並べ、2つ以上あるときは最後の1つを2行目に小さく出す（全部は title と詳細で読める）
- 「何が起きたら数えるか」の1行目は短い言葉（例：注文が確定したとき）。くわしい起点は title と詳細で読める
- フォルダの列は「すべて」だけ（成果地点にフォルダの口がまだ無い。口が入ったら足す）
- 作る：使う場所は種類ごとの1行（チェックで、その種類の候補を全部使う／外す）。1つずつ選ぶのは「使う場所を足す」の窓
- 作る：競合の帯は板の頭の下に板いっぱいで出し、主ボタンは「比べてから保存」（一覧の同じ名前の行へ）
- 作る：試算の説明（重複除外・取消・1日あたり）は右の列の「?」の中

## 撮影の指定（対応表への提案）
- `cXqlS`：`url: /conversions/new?name=商品を買った`、状態の指定なし（同じ名前が見本にあるので開いた時点で帯が出る）

## 2026-10-08 画面合わせ・入力の誤り
- ページ内の戻るリンクを外し、キャンセルとパンくずから一覧へ戻る。競合の帯は作成の型の notice に渡す。
- 作成・編集で入力が足りない／正しくないときは、共通の Field・TextField・Select で欄の赤枠と理由を出す。最初の誤りの欄へ移り、詳細設定の中なら先に開く。同じ理由を上の帯に重ねない。
- 上の帯は通信・保存・アカウント未選択・競合を知らせる。409 の上書き禁止と保存中の操作禁止は保つ。
- 詳細の小窓は鍵の発行・編集と停止・削除を2段に分ける。受け口の停止／再開・中身を見る・閉じるは小窓の「…」へ置く。
- 停止の3択は共通の行のラジオ。削除できない理由は併記し、操作の影響と対象の名前は開閉できる説明に残す。理由必須・影響の取得・版の確認は変えない。
- 状態の札は StatusBadge、一覧の読み込み失敗は ListState、空は EmptyList を使う。小さい選択カードは RadioCard の size="small" で描く。
- 閲覧のみの一覧では状態の札を2つにし、残りの状態と並び順は「よく使う絞り込み」から選べる。変える操作は描かず、見る操作・CSV・検索・並び順は残す。
