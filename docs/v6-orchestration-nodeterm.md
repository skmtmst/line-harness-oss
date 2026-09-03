# NodeTerm で AI を 3 役に分けて回す設計(2026-09-03)

司令塔を Fable 5.1、デザインを Claude(Opus 5)、実装を Codex にし、互いの作業が重ならないようにする。道具は NodeTerm(https://github.com/eneskirca/nodeterm)。正本は変えない: **GitHub の Issue と PR が正本、NodeTerm はそれを見て動かす場所、Slack は見える化**(AGENTS.md「Slack と Codex の共同開発運用」のとおり)。

## 0. NodeTerm のどの機能を何に使うか

| NodeTerm の機能 | この計画での使い方 |
|---|---|
| グループ(git worktree に紐づくフレーム) | **1 役 = 1 グループ = 1 worktree = 1 ブランチ**。フレームの中で開いたノードは全部その worktree で動くので、`cd` 間違いと同じ木の取り合いが起きない |
| エージェントノード | 各グループに 1 つ。司令塔は Claude Code(Fable 5.1)、S0〜S3 は Claude Code(Opus 5)、実装は Codex |
| 付箋(sticky)→ エージェントへのリンク | 各グループの指示書(所有パス、今週の順番、守ること)を付箋にして、そのグループのエージェントにリンクする。指示は付箋から 1 回だけ流し込まれる |
| コンテキストリンク(ノード間のエッジ) | 司令塔 ↔ 各担当 を双方向で結ぶ。司令塔は必要時だけ相手の記録(トランスクリプト・要約・直近出力)を読む。担当同士は結ばない(重なりの元) |
| Kanban + GitHub Issues 同期 | **台帳そのもの**。列 = GitHub のラベル。Issue を動かすとラベルが変わり、完了列に置くと Issue が閉じる。GitHub が正本なので、NodeTerm を使わない人(Slack から見る人)も同じものを見る |
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

- 付箋の中身は `docs/v6-parallel-plan.md` §4 と `docs/v6-directives.md` §3 からコピーする(正本はリポジトリ側。付箋は写し)。
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

担当を表すラベルも付ける: `lane:hq` `lane:s0` `lane:s1` `lane:s2` `lane:s3` `lane:codex`。列ラベルは 1 つだけ(2 つ付くとボードで「競合」になる)。

### Issue の本文(テンプレート `.github/ISSUE_TEMPLATE/task.yml`)

| 項目 | 内容 |
|---|---|
| 担当 | lane ラベルと同じ |
| 対象 | 機能番号と画面 Node ID、または API 名 |
| 所有パス | 触るパス。`docs/v6-parallel-plan.md` §2 の表の範囲外なら「司令塔の承認」欄に司令塔が書く |
| 完了条件 | 要件書の完了条件から写す(検証できる文だけ) |
| 依存 | 先に終わっていないといけない Issue 番号 |
| PR | 番号(採番後) |

### 動かし方

- **司令塔だけが Issue を作る**(担当が必要になったものは「依頼」として司令塔に Slack で投げ、司令塔が Issue にする)。
- 担当は着手時にカードを「作業中」へ、PR が CLEAN になったら「マージ待ち」へ動かす。ブランチ名と PR 題名に Issue 番号を入れる(`#T` ではなく GitHub の `#123`)。
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

1. NodeTerm でこのリポジトリをプロジェクトとして開き、Kanban を作る。
2. Settings → GitHub Issues: リポジトリ `skmtmst/line-harness-oss`、認証は `gh auth login` 済みの GitHub CLI、列とラベルを §2 の表のとおり対応、完了列 = 完了。
3. GitHub にラベルを作る: `todo` `doing` `review` `blocked` `lane:hq` `lane:s0` `lane:s1` `lane:s2` `lane:s3` `lane:codex`(NodeTerm の「Create missing labels」でもよい)。
4. グループを 6 つ作り、それぞれ worktree を紐づける(§1)。各グループに付箋を置き、指示をコピーしてエージェントにリンクする。
5. 司令塔ノードと各担当ノードをコンテキストリンクで結ぶ(5 本)。
6. トリガーを 2 つ作り、arm する(§4)。
7. 承認待ち(NEEDS YOU)の通知を自分の端末に出す。承認は人が答える。

## 7. 司令塔(Fable 5.1)がこの設計で実際にできること・できないこと

- できる: `gh` で Issue と PR を読み書き、ラベルで台帳を動かす、ゲート確認とマージ、docs/v6-*.md の更新、担当の記録をコンテキストリンク経由で読む、キャンバス制御スキルで担当ノードの状態を読む。
- できない: Pencil の操作(Pencil の AI に人が貼る)、ステージング配備(Codex)、Cloudflare の確認、承認待ちへの回答(人)。
- 注意: この設計はまだ NodeTerm 上で動かしていない。§6 を終えたら、最初の 1 日は司令塔の朝夕の文面を人が手で流し、動きを見てからトリガーに任せる。

## 8. 関連文書

- 担当分けと各セッションの指示: `docs/v6-parallel-plan.md`
- Pencil の修正指示: `docs/v6-pencil-fix-prompt.md`
- 役割と今週の順番: `docs/v6-directives.md`
- Slack との役割分担: `AGENTS.md`「Slack と Codex の共同開発運用」、`docs/codex-slack-sync.md`
