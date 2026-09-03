# NodeTerm で AI を 3 役に分けて回す設計(2026-09-03)

司令塔を Fable 5.1、デザインを Claude(Opus 5)、実装を Codex にし、互いの作業が重ならないようにする。道具は NodeTerm(https://github.com/eneskirca/nodeterm)。正本は変えない: **GitHub の Issue と PR が正本、NodeTerm はそれを見て動かす場所、Slack は見える化**(AGENTS.md「Slack と Codex の共同開発運用」のとおり)。

## 0. NodeTerm のどの機能を何に使うか

| NodeTerm の機能 | この計画での使い方 |
|---|---|
| グループ(git worktree に紐づくフレーム) | **1 役 = 1 グループ = 1 worktree = 1 ブランチ**。フレームの中で開いたノードは全部その worktree で動くので、`cd` 間違いと同じ木の取り合いが起きない |
| エージェントノード | 司令塔(Fable 5.1)、S0〜S3(Opus 5)、Pencil デザイン修正(Opus 5 + Pencil MCP)、実装 Codex、エラー修正 Codex、品質チェック 4 つ(Codex、読み取り専用。エラー / コード / 速度 / セキュリティ)。2026-09-03 に 3 段目の列として追加 |
| 付箋(sticky)→ エージェントへのリンク | 各グループに「まず docs/brain/Home.md を読む。あなたは <担当名>」の 1 行だけの付箋を置き、エージェントにリンクする。指示の正本はリポジトリ側(§8) |
| コンテキストリンク(ノード間のエッジ) | 司令塔 ↔ 各担当 を双方向で結ぶ。司令塔は必要時だけ相手の記録(トランスクリプト・要約・直近出力)を読む。担当同士は結ばない(重なりの元) |
| Kanban + GitHub Issues 同期 | **台帳そのもの**。列 = GitHub のラベル。Issue を動かすとラベルが変わり、完了列に置くと Issue が閉じる。台帳のリポジトリは `kentavndng/line-harness-board`(非公開。fork 側は Issues が無効で、この口座に有効化権限が無いため)。コードと PR は `skmtmst/line-harness-oss` のまま。Masato は協力者として招待済み |
| NEEDS YOU(承認待ち)の通知 | 担当エージェントの承認待ちは司令塔ではなく人が答える(承認は人の権限)。司令塔は「止まっている担当」を一覧で見るだけ |
| トリガーノード | 朝の割り当てと夕方のまとめを司令塔に定時で流す(cron)。定義は `.nodeterm/project.json` で共有され、発火の同意は各マシンで人が arm する |
| キャンバス制御スキル(`manage-nodeterm-canvas`) | 司令塔がキャンバスを操作する: 担当ノードを開く、worktree を開く、ボードを読む。`spawn-team` は使わない(担当は固定 5 本) |
| `--dry-run` | 司令塔が新しいノードや worktree を開く前に必ず付ける。何が起きるかを確認してから実行 |

## 1. キャンバスの配置(1 プロジェクト = このリポジトリ)

```
┌ 司令塔 (Fable 5.1) ─────────────┐   worktree: lh-hq   branch: (codex/development を読む専用。PR は codex/kenta-hq-<内容>)
│ 付箋: 司令塔の指示書              │
│ エージェント: claude (fable)      │
└──────────────────────────────────┘
      │ コンテキストリンク(双方向)を 5 本
┌ S0 共通部品 (Opus 5) ────┐ ┌ S1 機能1〜5 ─────┐ ┌ S2 機能6〜13 ────┐ ┌ S3 機能14〜32 ───┐ ┌ 実装 Codex ─────┐
│ worktree: lh-s0          │ │ worktree: lh-s1  │ │ worktree: lh-s2  │ │ worktree: lh-s3  │ │ worktree: lh-cx │
│ 付箋: S0 の指示          │ │ 付箋: S1 の指示   │ │ 付箋: S2 の指示   │ │ 付箋: S3 の指示   │ │ 付箋: Codex 指示 │
│ ターミナル: qa:web, mock │ │ 同左             │ │ 同左             │ │ 同左             │ │ ターミナル: test │
└──────────────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘ └─────────────────┘
トリガー: 09:00 「朝の割り当て」→ 司令塔 / 18:00 「夕方のまとめ」→ 司令塔
```

- 付箋には指示をコピーしない。「まず docs/brain/Home.md を読む。あなたは S1(機能 1〜5)」のように 1 行だけ書く。指示の正本は `docs/v6-parallel-plan.md` §4 で、エージェントが起動時に読む(§8)。
- 担当同士のコンテキストリンクは引かない。S1 が S0 の部品の状況を知りたいときは、司令塔に聞くか、GitHub の PR を見る。
- グループの worktree は NodeTerm の「New worktree…」で作る(ブランチ名は `codex/kenta-r2-<担当>-<機能>`。base は codex/development)。既存の worktree を採用してもよい。

## 2. 台帳(Kanban = GitHub Issues)

### 列とラベル(Settings → GitHub Issues で 1 列 1 ラベルに対応させる)

| 列 | ラベル | 意味 |
|---|---|---|
| 未着手 | `todo` | 司令塔が作った。担当と完了条件が書いてある |
| 作業中 | `doing` | 担当がブランチを切って着手した |
| マージ待ち | `review` | PR が CLEAN。司令塔がマージする |
| 停止 | `blocked` | 人の判断か相手の領域の作業が要る。理由が本文にある |
| 完了(完了列) | (閉じる) | 司令塔がマージし、Issue を閉じる |

担当を表すラベルも付ける: `lane:hq` `lane:s0` `lane:s1` `lane:s2` `lane:s3` `lane:pen` `lane:codex` `lane:fix` `lane:qa`。列ラベルは 1 つだけ(2 つ付くとボードで「競合」になる)。

### Issue の本文(テンプレート `.github/ISSUE_TEMPLATE/task.yml`)

| 項目 | 内容 |
|---|---|
| 担当 | lane ラベルと同じ |
| 対象 | 機能番号と画面 Node ID、または API 名 |
| 所有パス | 触るパス。`docs/v6-parallel-plan.md` §2 の表の範囲外なら「司令塔の承認」欄に司令塔が書く |
| 完了条件 | 要件書の完了条件から写す(検証できる文だけ) |
| 依存 | 先に終わっていないといけない Issue 番号 |
| PR | 番号(採番後) |

### 進み具合の見せ方(チェックボックス 2 列)

Issue の本文に、同じ行数のチェックボックスを 2 組持つ。

```
### 完了条件(担当が更新。終えたら `- [x] ~~文~~` にする)
- [x] ~~grep 準備中 が apps/web/src で 0 件~~
- [ ] 契約テストが page.tsx の「準備中」を禁止

### 人の確認(人がチェックしたら司令塔が閉じる)
- [x] 確認: grep 準備中 が apps/web/src で 0 件
- [ ] 確認: 契約テストが page.tsx の「準備中」を禁止
```

- 左の組は担当が更新する。終えた行は `[x]` にして文を `~~` で打ち消す(GitHub は打ち消し線で描く)。何が終わり何が残っているかが 1 目で分かる。
- 右の組(人の確認)は人だけが触る。司令塔は「人の確認が全部 `[x]` で、PR がマージ済み」のときだけ Issue を閉じる。完了条件が全部 `[x]` でも人の確認が残っていれば `review` 列に置いたままにする。
- 「いま何をやっているか」は NodeTerm のカード(RUNNING / NEEDS YOU)と `doing` 列で見る。「何が終わったか」は Issue の左の組で見る。「人が確認したか」は右の組で見る。
- 品質チェック(lane:qa)が起票する Issue も同じ形にする。直すのは lane:fix。

### 動かし方

- **司令塔だけが Issue を作る**(品質チェック lane:qa は例外として、検査結果の Issue を自分で作ってよい)(担当が必要になったものは「依頼」として司令塔に Slack で投げ、司令塔が Issue にする)。
- 担当は着手時にカードを「作業中」へ、PR が CLEAN になったら「マージ待ち」へ動かす。PR は本体リポジトリに出し、PR 本文に台帳の番号を `kentavndng/line-harness-board#123` の形で書く。ブランチ名には `b123` のように番号を入れる。
- **PR を作ったら、その場で Issue の題名の末尾に ` (PR #番号)` を足す**(例: `[s1] 友だち一覧の未取得表示 (PR #712)`)。看板のカードは題名しか見えないので、番号が題名に無いと人が PR を探せない。PR を作り直したら番号も差し替える。
- **チケットが終わっても止まらない。** PR を出したらマージを待たず、`gh issue list` で自分の lane の `blocked` → `doing` → `todo` の順に次の 1 件を取り、`doing` にして着手する。取れるものが無いときだけ、司令塔の Issue に「空きあり」とコメントで知らせる。他の担当の完了を待つ必要があるチケットは、その 1 件だけ `blocked` にして本文に依存先(Issue 番号)を書き、別のチケットに進む。
- **push の前に必ず `git pull --no-rebase origin <自分のブランチ>`。** 保護ルールで「ブランチが最新」でないとマージできないため、司令塔が PR ブランチに codex/development を取り込む merge commit を push することがある。rebase と force push はしない(履歴を書き換えると司令塔の取り込みと衝突する)。
- 司令塔はマージ後にカードを完了列へ(= Issue が閉じる)。
- 「停止」に置くときは本文に理由と、誰の判断が要るかを書く。人は「停止」列だけ見ればよい。

## 3. 重なりを防ぐ 5 つの決めごと

1. **所有パスは `docs/v6-parallel-plan.md` §2 が正本。** 範囲外を触る PR は司令塔がマージしない。Codex に CI 検査(PR の変更パスと lane ラベルの照合。範囲外なら警告コメント)を依頼する。
2. **1 Issue = 1 ブランチ = 1 PR = 1 日。** 翌日に下書きを残さない。別の PR の上に PR を作らない。
3. **横断ファイルは 1 人だけ。** components/shared・globals.css・screens.mjs の共通部分は S0、AGENTS.md・.github は Codex、docs/v6-requirements と docs/v6-*.md は司令塔。
4. **マージは司令塔だけ。** base が動いていないこと、必須ゲート、範囲外の変更が無いことを確認してマージし、台帳を完了にする。
5. **担当同士は直接話さない。** 依頼は司令塔経由(Issue)。コンテキストリンクは司令塔とだけ。

## 4. 1 日の流れ(トリガーで司令塔に流す文面)

09:00「朝の割り当て」(cron `0 9 * * 1-5`、対象: 司令塔ノード)

```
朝の割り当てをする。gh で lane ラベル別に open Issue を読み、各担当の今日の分(1〜2 件)を todo → doing の順に並べ、依存が未完のものは blocked にする。オープン PR 数と、昨日マージした数を Slack の指令塔チャンネルに 1 行で書く。相手の領域への依頼が Slack に来ていたら Issue にする。
```

18:00「夕方のまとめ」(cron `0 18 * * 1-5`)

```
review 列の PR を順に確認する: base が最新か、必須ゲート成功か、変更パスが lane の範囲内か。満たすものをマージして Issue を閉じる。満たさないものは理由を Issue にコメントして doing に戻す。オープン PR 数、一致画面数(docs/design-qa/v6-progress-ledger.md)、blocked の件数を Slack に 1 行で書く。
```

トリガーの定義はリポジトリで共有されるが、**発火の同意(arm)は司令塔を動かすマシンで人が行う。** clone しただけでは動かない。

## 5. 司令塔がキャンバス制御スキルで行ってよいこと

| 操作 | 可否 |
|---|---|
| `list` / `board`(状態を読む) | 常に可 |
| `open-worktree` / `open-claude` / `open-agent`(担当ノードを開き直す) | `--dry-run` で確認してから可。担当は固定 5 本を超えて増やさない |
| `rename` / `assign` | 可 |
| `spawn-team` | 使わない(担当を増やすと所有パスが崩れる) |
| `write` / `close` / `open-project` | 人の確認ダイアログが出る。司令塔からは使わず人が行う |

## 6. 人がやること(NodeTerm 側の初期設定、1 回)

`.nodeterm/project.json` と `.nodeterm/settings.json` はこのリポジトリに **生成済み**(2026-09-03)。グループ 6 つ(worktree は `/Volumes/My Passport/Github/lh-work/lh-<担当>` に作成済み)、エージェントノード 6 つ、付箋 6 枚、コンテキストリンク 11 本、トリガー 7 つ(朝・夕・各担当の 30 分ごとの取得)、Kanban の 5 列と GitHub ラベル対応が入っている。GitHub のラベル 10 個も作成済み。残りは NodeTerm の画面でしかできない 4 手順。

1. NodeTerm(v0.3.4、macOS arm64 の dmg)を入れて起動し、「Open folder…」でこのリポジトリのフォルダを開く。`.nodeterm/project.json` が読み込まれ、キャンバスと Kanban が出る。
2. Settings → GitHub Issues: 「Include GitHub issues」を on、リポジトリの上書きが `kentavndng/line-harness-board` になっていることを確認(project.json に入っている)、認証は GitHub CLI(`gh auth login` 済み)、このプロジェクトのアクセスを承認する。列とラベルの対応も入っているので確認だけ。
3. トリガー 7 つを arm する(カードの ARMED を押す)。定義は共有されるが、発火の同意はこのマシンで人が行う。最初の 1〜2 日は arm せず、朝夕の文面を司令塔に手で貼って動きを見るのがよい。
4. 各グループのエージェントノードを起動する(Claude Code は `claude`、Codex は `codex`)。Opus 5 のモデル指定はノードのモデル選択で行う。承認待ち(NEEDS YOU)の通知を自分の端末に出す。

worktree のパスは絶対パスで project.json に入っているので、別のマシンで開く場合はグループの worktree を「Unbind」してから自分のパスで作り直す。

### 追記(2026-09-03): 起動前の 2 つの確認

- 各 worktree で `pnpm install --frozen-lockfile` を済ませておく。無いと Slack フック・テスト・型検査が全部落ちる。
- Codex は自動承認で動かす。`~/.codex/config.toml` に `approval_policy = "never"`、`sandbox_mode = "workspace-write"`、`[sandbox_workspace_write] network_access = true` と `writable_roots = ["<本体の .git>", "<lh-work>"]`。本番 DB の更新と本番(main)への配備の禁止は AGENTS.md の指示で守る(砂場ではなく約束で止める)。
- Codex ノードを再起動するときは `codex resume <セッション id>` で会話を引き継ぐ。同じ作業ツリーを共有する qa 4 本は `--last` が別ノードのセッションを拾って失敗するので、id を指定するか新規に起動する。


## 7. 司令塔(Fable 5.1)がこの設計で実際にできること・できないこと

- できる: `gh` で Issue と PR を読み書き、ラベルで台帳を動かす、ゲート確認とマージ、docs/v6-*.md の更新、担当の記録をコンテキストリンク経由で読む、キャンバス制御スキルで担当ノードの状態を読む。
- できない: Pencil の操作(Pencil の AI に人が貼る)、ステージング配備(Codex)、Cloudflare の確認、承認待ちへの回答(人)。
- 注意: この設計はまだ NodeTerm 上で動かしていない。§6 を終えたら、最初の 1 日は司令塔の朝夕の文面を人が手で流し、動きを見てからトリガーに任せる。

## 8. 記憶の置き場(AI Second Brain Kit の考え方を取り込む)

3 役が「前回の前提を忘れる」「一度言われた修正を繰り返す」のを防ぐため、AI Second Brain Kit(fuuuuuuma/ai-second-brain-kit)の中核 4 枚だけを **このリポジトリの `docs/brain/` に置く**。別の Obsidian Vault は作らない(正本が割れる)。raw / wiki / reports は、このリポジトリでは docs と GitHub Issues が既にその役目。

| ファイル | 役目 | 誰が書くか |
|---|---|---|
| `docs/brain/Memory.md` | この仕事の事実・体制・進行中・判断基準(引き継ぎ書) | 司令塔。夕方のまとめで「進行中」を更新 |
| `docs/brain/Home.md` | 玄関(目次)。必読順と正本へのリンク | 司令塔 |
| `docs/brain/rules/corrections.md` | オーナーから受けた修正指示(恒久ルール) | 訂正を受けたセッションがその場で追記。司令塔が月 1 で整理 |
| `docs/brain/rules/mistakes.md` | 起きた失敗と再発防止 | 同上 |
| `docs/brain/rules/lint.md` | 週次の点検観点 | 司令塔が毎週金曜に実行 |

- **起動時の必読順**(AGENTS.md に追記済み): `AGENTS.md` → `docs/brain/Memory.md` → `docs/brain/rules/corrections.md` → `docs/brain/rules/mistakes.md` → 担当の指示書。
- NodeTerm の各グループの付箋には、指示書のコピーではなく **「まず docs/brain/Home.md を読む」の 1 行と、そのグループの担当名**だけを書く。指示の正本はリポジトリ側に置き、付箋を更新し忘れて古い指示で動くことを防ぐ。
- Obsidian で開きたい場合は `docs/brain/` を Vault として開けば、`[[wikilink]]` と frontmatter はそのまま使える。キットの `second-brain` スキルを各エージェントに入れると、訂正時の追記が自動になる(任意)。

## 8.5 モデルの交代(利用制限で止まったとき)

役割はレーン(グループ + worktree + lane ラベル + docs/brain)に固定し、**モデルは差し替え可能**にする。Fable 5.1 が制限で止まれば Codex が司令塔を代行し、Opus 5 が止まれば Codex が S1 を代行し、復帰したら戻す。

| 段 | 誰が | やること |
|---|---|---|
| 止まる | 止まったノード(可能なら) | いま `doing` の Issue に「引き継ぎ」コメントを書く: 状態、次の一手、触ったファイル、未 push の有無。ブランチを push する。Issue は `doing` のまま |
| 代行を立てる | 人(または司令塔が `open-agent --dry-run` → 実行) | **同じグループの中**に代行ノードを開く(例: `agent-s1-sub`、agentId `codex`)。同じ worktree で動くので、続きの木がそのままある。元ノードとコンテキストリンクで結び、記録を読めるようにする |
| 代行が続ける | 代行ノード | Home.md → Issue の引き継ぎコメント → `git log -5` の順に読み、同じ Issue を続ける。**新しい Issue を取らない**(元が戻ったときに 2 本並走しないため) |
| 復帰 | 元ノード | 代行に「止まって」と伝え(司令塔経由)、代行は最後の状態を Issue にコメントして停止。元ノードが引き継ぐ。代行ノードは閉じずに残してよい(次の制限時に再利用) |

決めごと:

- **同じグループに 2 つの動くノードを置かない。** 同じ worktree を 2 つのエージェントが同時に触ると、どちらの変更か分からなくなる。代行が動く間、元は必ず停止している。
- **マージ権限は常に 1 ノードだけ。** 司令塔を Codex が代行する間、Fable 5.1 のノードはマージしない。
- **司令塔の交代前後で `docs/brain/Memory.md` の「進行中」を更新する。** 交代先が読むのはここ。
- 交代は台帳に残す: 引き継ぎコメントと復帰コメントが Issue に並ぶので、誰がどこまでやったかが後から追える。

## 9. 関連文書

- 担当分けと各セッションの指示: `docs/v6-parallel-plan.md`
- Pencil の修正指示: `docs/v6-pencil-fix-prompt.md`
- 役割と今週の順番: `docs/v6-directives.md`
- 記憶の置き場: `docs/brain/Home.md`
- Slack との役割分担: `AGENTS.md`「Slack と Codex の共同開発運用」、`docs/codex-slack-sync.md`
