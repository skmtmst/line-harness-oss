# V6設計一致作業 引き継ぎ（2026-09-03）

この文書は、V6 262画面を「設計どおりに見える」状態へそろえる作業を、別のCodex/Claudeセッションから再開するための正本です。

## 1. 現在地

- 再開するブランチ：`codex/development`（開始時に必ず最新を取得する）
- 画面・検証環境の確認済みSHA：`b15da96a5f49915e0f49f0dbef0ed8396b3ad347`
- この文書を本流へ入れた直後のSHA：`6fe27904816a1a330b05a9907a82a97bc6c2745a`
- 台帳：`scripts/visual-qa/screens.mjs`
- 総数：262 Node

| 判定 | 枚数 | 合否 |
|---|---:|---|
| `match` | 58 | 合格 |
| `structure_match_data_pending` | 20 | 合格 |
| `needs_fix` | 169 | 要対応 |
| `unimplemented` | 15 | 要対応 |

合格は **78枚**。手を入れる対象は **184枚**です。

`structure_match_data_pending` は、設計の節・並び・言葉がそろい、取れない値を `—` と理由で示せている状態です。すでに合格へ算入します。`match` へ移しても合格枚数は増えません。

## 2. 完了済み

### PR #682：マイル画面の部分的な返事への防御

- `mileage_history` などの返事に入れ子が欠けても、画面全体を落とさないようにした
- `MvZm5` の「Codex担当待ち」は解消済み
- マージ済み・検証環境へ反映済み

### PR #680：分析画面の撮影口

- `/api/analytics/friends`・`reactions`・`routes`・`usage` を撮影用モックへ追加
- 分析7 Node、1440/1920の14枚を記録
- 監査時に混入していた友だち・流入・運用状態の画像43枚を除外し、分析だけに絞ってマージ

### PR #681：外部連携の入力見本

- `/webhooks` の「どこから来るか」を5つの見本から選べるようにした
- 見本外は「その他（自分で書く）」で入力可能
- 監査時に次も修正した
  - 自由入力が見本と同じ値になったとき、見本の説明を混ぜない
  - 保存成功後に「その他」の状態を残さない
  - 新しい生色を設計トークンへ置換
  - 反映履歴の見出しを規約どおり `## 変更` に修正
- Webテスト1845件、型検査、ビルド、必須CI通過後にマージ

## 3. 検証環境

- 最新反映SHA：`b15da96a`
- 対象：管理画面のみ
- Workflow：<https://github.com/skmtmst/line-harness-oss/actions/runs/33647075270>
- `/`：HTTP 200
- `/webhooks`：HTTP 200
- Worker・DB・migration：変更・配備なし
- staging配備ロック：解放済み

## 4. 作業分担

### Claude：前面

- V6設計へ見た目をそろえる
- 文言、節、並び、状態表示、共通部品への載せ替えを進める
- 口が無い値は作らず、`—` と理由を出す
- 最新 `codex/development` 直結のDraft PRにする
- stacked PRを新しく作らない
- 同じファイルの変更は1本に束ねる
- Ready化・マージ・検証反映は行わない

### Codex：裏側と統合

- ClaudeのPRを独立に監査する
- API・Worker・DB・migrationが必要な差を担当する
- 固定データと実契約の形を照合する
- CIだけでなく、到達する分岐か、副作用が無いか、前アカウントの応答が残らないかを見る
- 最新base取り込み、再検証、Ready化、マージ、検証反映まで担当する

## 5. 次に処理するもの

### 最優先：PR #683

- PR：<https://github.com/skmtmst/line-harness-oss/pull/683>
- 内容：LINE通知の見出しから内部イベントキーを消す
- 状態：Draft、`codex/development` 直結、現在は最新baseより遅れている
- 次のCodexは、最新baseを通常マージし、画面・契約テスト・撮影記録を監査してから降ろす

### Claudeの次の候補

1. 機能30 ログインユーザー（文言・見出し中心）
2. 機能10 ウェビナー（文言・見出し中心）
3. 機能2 受信箱（文言・見出し中心）

`needs_fix` 169枚の機械仕分けは、口が要りそう43枚、文言・見出し41枚、寸法・色6枚、その他79枚。分類は着手前の仮説なので、コードと到達分岐を読んでから確定します。

## 6. 必須手順

```bash
DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh
git status --short --branch
git fetch origin codex/development
```

1. doctor最終行が「合格」でなければ開始しない
2. 作業ツリーがcleanでなければ、所有者が分かるまで触らない
3. 最新 `codex/development` から専用ブランチを作る
4. 対象ファイルを触るopen PRを調べる
5. テスト直前とマージ直前にdevelopmentのSHAを再確認する
6. SHAが進んでいたら通常マージし、影響テストをやり直す
7. `CLEAN` / `MERGEABLE`、必須CI成功を確認してからマージする
8. 画面変更は管理画面だけ検証環境へ反映し、対象ルートをスモーク確認する

ローカルの全Webテスト・型検査・ビルドには次を明示します。

```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:8787 pnpm --filter web test
NEXT_PUBLIC_API_URL=http://127.0.0.1:8787 pnpm --filter web typecheck
NEXT_PUBLIC_API_URL=http://127.0.0.1:8787 pnpm --filter web build
```

## 7. 判定と撮影の注意

- 固定データの口が無いだけで、実装を「データ未接続」と判定しない
- モックは `apps/web/src/lib/api.ts` とWorkerの返却形を読んで作る
- 一覧用の既定 `{items,total,page,limit}` を別形の口へ返さない
- 同じ状態・同じ幅（1440/1920）の設計画像と実装画像を並べる
- 実際に見ていないNodeの判定を変更しない
- 未取得と実値0を混ぜない
- 撮影できない場合は「無い」ではなく「未確認」とする
- `data-qa-open` が無ければ文言推測で黙って撮らず、理由を残す
- release logの見出しは `## 追加` / `## 変更` / `## 修正` だけ

## 8. 既知の詰まり

- 古いDraft PRが多数あり、別PRの枝をbaseにしたものも残っている
- 既存stacked PRは一括で降ろさず、親の成果・現在のdevelopmentとの差・重複実装を1本ずつ監査する
- `screens.mjs`、撮影モック、設計ゲートは多くのPRが共有するため、先に入った変更を消さない
- GitHub ActionsのNode.js 20廃止警告は現在は警告のみ。必須CI失敗ではない
- 古いrelease logファイルの見出し外警告はdevelopment既存分。新しいPRで増やさない

## 9. 外付けドライブ

`/Volumes/My Passport` は読み書きが失敗する状態です。**読み取り、修復、Disk Utility、worktree整理を行わないでください。**

安全な作業コピー：

```text
/private/tmp/lh-mvzm5-fmyUUJ/repo
```

この作業コピーは最新 `codex/development` と一致し、作業ツリーcleanです。外付けの救出は、保存先と手順を別途決めてから行います。

## 10. 再開時の完了条件

- Claudeが画面側PRを出す
- Codexが独立監査し、必要なら同じPRで修正する
- 全テスト・型検査・ビルド・必須CIを通す
- 最新base、CLEAN / MERGEABLEを確認してマージする
- 管理画面変更なら検証環境へ反映する
- 台帳は実際に撮って見たNodeだけ更新する
