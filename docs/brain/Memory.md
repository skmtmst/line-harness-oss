---
type: memory
status: 常時更新
date: 2026-10-07
topic: LINE Harness V8 の引き継ぎ書
tags: [memory, core]
---

# Memory.md — 引き継ぎ書(全エージェント必読・最重要)

> 新しく入ったアシスタントに渡す「この仕事についての事実」。`AGENTS.md` が振る舞いのルール(憲法)。細かい決まりはここに書かず、下の「正本」を指す。古くなったらその場で直す。

## 事業・活動の概要

- LINE 公式アカウントの CRM（画面の名前は musubo。画面に LINE Harness は出さない）を、Lステップ / Liny の無料代替として作っている。Cloudflare Workers + D1 + Next.js 管理画面 + LIFF。MIT。
- 最初の顧客は 然-NEN(ペットフード EC)。飲食店向けは本番では無効のテスト機能。
- **ゴール：Pencil ★V8 の板（管理画面 434＋LIFF 28＝462 枚）をすべて合格させ、本番を V8 に切り替える。**切り替えの条件と手順は `docs/v8-requirements/v8-switch.md`。

## 体制・役割(2026-10-06 オーナー決定)

- オーナー: Kenta(kengdom53)。共同開発者 Masato(skmtmst)。
- **司令塔（Claude）**：画面・型・共通部品・Pencil・撮影と照合・要件・統合（push・PR・マージ・検証への配備）。
- **作業役（司令塔が起動する Claude のサブエージェント）**：画面や文書の作業。**コミットまで**で止めて報告する。
- **Codex**：API・DB・Worker・共有の型（F-1〜F-25 などの機能追加）。**コミットまで**。D1 の適用はオーナー承認のあと司令塔。画面（見た目）は作らない。
- 所有の表は `AGENTS.md`「Claude / Codex のファイル所有」。

## 正本（迷ったらここを開く）

- 振る舞い：`AGENTS.md`
- 見た目の決まり：`docs/v8-design-rules.md`（使いやすさ → ★V8 の絵 → この文書 → 型・共通部品 → 動きの試験）
- V8 の画面の置き場と書き方：`apps/web/src/v8/README.md`、手順書 `~/lh-work/design/v8/HOW-TO-90.md`
- 動きの要件：`docs/v6-requirements/v6-requirements-master-index.md`（34 本）と `docs/v8-requirements/`（V8 で足した機能・LIFF・切り替え）
- 進み具合：`~/lh-work/design/v8/SWITCH-READINESS.md` と `PASSED.tsv`（司令塔の手元）
- 反映履歴：`docs/release-log/README.md`（PR ごとに `unreleased/<PR番号>-<担当>-<内容>.md`）

## 判断基準(迷ったときの軸)

- 合格＝絵の文字の位置が ±4px で 90% 以上合う（measure.sh）＋重ねた絵を目で確かめる。幅は 1440 と 1152。
- 設計を変えるときは Pencil が先。コードだけ直さない。絵と古い案がぶつかったら絵どおり。
- 取れない数字を 0 にしない。未取得は「—」+ ラベル。
- 1 PR = 1 話題。PR 番号は採番してから書く。
- 相手の領域(所有パス)は触らない。必要なら司令塔に依頼を出す。
- 削除は物理削除ではなく archive。履歴・監査・支払・審査の記録は消さない。
- 決められないことは「停止」にして人に渡す。推測で埋めない。

## コミュニケーション様式

- 日本語。オーナーは大学生だと思って言語化する(AGENTS.md)。内部語(テーブル名、関数名)を運用者向けの文に書かない。
- 回答には「今の進捗を全体像から整理するとこれ」「次のタスクはこれ」を含める。
- Slack に顧客情報・秘密値を書かない。
