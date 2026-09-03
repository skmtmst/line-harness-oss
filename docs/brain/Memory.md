---
type: memory
status: 常時更新
date: 2026-09-03
topic: LINE Harness V6 の引き継ぎ書
tags: [memory, core]
---

# Memory.md — 引き継ぎ書(全エージェント必読・最重要)

> 新しく入った優秀なアシスタントに渡すオンボーディング文書。司令塔・デザイン・実装のどのセッションも、**起動時に最初にこれを読む**。`AGENTS.md` が振る舞いのルール(憲法)なら、ここは「この仕事についての事実」。古くなったらその場で直す。

## 事業・活動の概要

- LINE 公式アカウントの CRM「LINE Harness」を、Lステップ / Liny の無料代替として作っている。Cloudflare Workers + D1 + Next.js 管理画面 + LIFF。MIT。
- 最初の顧客は 然-NEN(ペットフード EC)。飲食店向けは本番では無効のテスト機能。
- ゴール: Pencil(Pen.dev)の ★V6 260 画面と要件書どおりに仕上げ、機能・安全性・使い勝手で Lステップを超える。

## 体制・役割

- オーナー: Kenta(kengdom53、GitHub は kentavndng 名義のセッションが多い)。共同開発者 Masato(skmtmst)。
- 司令塔: Claude Fable 5.1。台帳、優先順位、割り当て、ゲート確認とマージ、衝突の裁定。コードは緊急修正の独立 PR だけ。
- デザイン: Claude Opus 5 を 4 セッション(S0 共通部品、S1 機能 1〜5、S2 機能 6〜13、S3 機能 14〜32)。Pencil の修正は人が Pencil の AI に貼る。
- 実装: Codex。API、DB、性能、CI、ステージング配備。
- 正本: GitHub の Issue と PR。NodeTerm は動かす場所。Slack は見える化。

## いま進行中のこと(2026-09-03 時点)

- 要件定義 34 本は見直し済み(#690)。横断契約は索引 §5 に 1 本化。古い要件は docs/archive へ。
- Pencil 修正の第 1 ラウンド(#692)で全 32 機能の設計画像を撮り直し、判定は全機能が未判定。第 2 ラウンドは docs/v6-parallel-plan.md の並列計画で進める。
- 棚卸し第 1 弾(#700)で、通知ルール API の mount 漏れ、リリース検査の停止、ビルド順、壊れた参照を直した。
- 判断 8 件は決定済み(docs/v6-directives.md §4)。人の判断待ちは 0 件。
- オープン PR は 64 本(2026-09-03 夕)。2 週間で 20 本以下に落とす。
- PNG を版から外す作業が撮影側で進行中。git 履歴は 632 MB で、書き換えは今はしない。

## よく使うもの

- 進捗の正本: docs/design-qa/v6-progress-ledger.md(機械生成、手で直さない)
- 要件の正本: docs/v6-requirements/v6-requirements-master-index.md と §5 の横断契約
- 画面の正本: Pencil ★V6 → docs/v6-common-rules.md → 要件書 → 共通部品 → 契約テスト
- 役割と指示: docs/v6-directives.md、docs/v6-parallel-plan.md、docs/v6-pencil-fix-prompt.md、docs/v6-orchestration-nodeterm.md
- Pencil の修正一覧: docs/v6-requirements/v6-32-feature-cross-review.md §7(50 件)

## 目標

- 短期(9 月末): 262 画面が設計と一致、「準備中」0 件、動かない操作は文言で理由が出る。ステージングまで。
- 中長期: バックエンド未接続 16 件の実装、本番(main)への配備、Lステップ超えの公開。

## 判断基準(迷ったときの軸)

- 設計を変えるときは Pencil が先。コードだけ直さない。
- 「一致」は文言一致 + 寸法一致 + 全状態撮影済みのときだけ。撮れなかった画面は空欄のまま残す。
- 取れない数字を 0 にしない。未取得は「—」+ ラベル。
- 1 PR = 1 話題 = 1 日。別の PR の上に PR を作らない。PR 番号は採番してから書く。
- 相手の領域(所有パス)は触らない。必要なら司令塔に依頼を出す。
- 削除は物理削除ではなく archive。履歴・監査・支払・審査の記録は消さない。
- 決められないことは「停止」にして人に渡す。推測で埋めない。

## コミュニケーション様式

- 日本語。オーナーは大学生だと思って言語化する(AGENTS.md)。内部語(テーブル名、関数名)を運用者向けの文に書かない。
- 回答には「今の進捗を全体像から整理するとこれ」「次のタスクはこれ」を含める。
- Slack に顧客情報・秘密値を書かない。
