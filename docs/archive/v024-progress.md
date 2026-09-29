> **完了済みの引き継ぎ・経緯メモ(2026-09-03 に archive へ移動)。判断に使わない。** 現在の正本は `docs/v6-requirements/v6-requirements-master-index.md` と `docs/v6-common-rules.md`。

# v0.24.0 の進み具合（2026-08-16 更新）

夜のあいだに進めたぶんのまとめ。**どこまで動いて、何が残っているか**を
そのまま書く。

---

## 出したPR

積み上げになっている。下から順にマージすると、上のPRの差分が小さくなる。

| PR | 中身 | ベース |
|---|---|---|
| [#44](https://github.com/skmtmst/line-harness-oss/pull/44) | フェーズ1 土台（マイグレーション099〜103・ヘルパ9本・バージョン統一） | `codex/development` |
| [#45](https://github.com/skmtmst/line-harness-oss/pull/45) | フェーズ2 友だち情報欄の一本線 | #44 |
| [#46](https://github.com/skmtmst/line-harness-oss/pull/46) | 旧8ルートのタブ統合と行き止まりの検査 | #45 |
| [#47](https://github.com/skmtmst/line-harness-oss/pull/47) | 対応マーク・保存した検索・汎用フォルダ | #46 |
| [#48](https://github.com/skmtmst/line-harness-oss/pull/48) | 自動応答の評価順とメッセージ種別 | #47 |
| [#49](https://github.com/skmtmst/line-harness-oss/pull/49) | 機能設定の画面とサイドバーの修正 | #48 |
| [#50](https://github.com/skmtmst/line-harness-oss/pull/50) | タグの分類を folders から読む | #49 |
| [#52](https://github.com/skmtmst/line-harness-oss/pull/52) | メディアライブラリと共通情報 | #50 |
| [#53](https://github.com/skmtmst/line-harness-oss/pull/53) | アクセス解析（4タブ） | #52 |
| [#54](https://github.com/skmtmst/line-harness-oss/pull/54) | 一斉配信の配信前チェック | #53 |
| [#55](https://github.com/skmtmst/line-harness-oss/pull/55) | サイトスクリプトと使用箇所スキャン | #54 |
| [#56](https://github.com/skmtmst/line-harness-oss/pull/56) | ログイン履歴とカルーセルの検証 | #55 |

0.23.0 のぶん（#32 #34 #35 #36 #37 #39 #40 #41 #43）と #38 も、
この積み上げの土台に入っている。

---

## 動くようになったこと

**フォームに回答 → 情報欄に入る → 友だち詳細に出る → テンプレートで差し込める。**
要件定義書が「ここが核」としていた一本線が通っている。

| V2 | ルート | 状態 |
|---|---|---|
| 3-2 友だち情報欄 | `/tags?tab=fields` | 動く |
| 3-2-1 項目を追加する | `/tags/fields/new` | 動く |
| 3-3 対応マーク管理 | `/tags?tab=marks` | 動く |
| 3-4 保存した検索 | `/tags?tab=searches` | 一覧と削除だけ（条件を組むのは友だち一覧側） |
| 2-2-1 友だち詳細 | `/friends/detail?id=` | 動く |
| 10-3 機能設定 | `/settings` | 動く |
| 5-1 メディアライブラリ | `/contents` | 動く |
| 5-2 共通情報 | `/contents?tab=vars` | 動く。差し込みも切り替え予約も効く |
| 5-2-1 共通情報を追加 | `/contents/vars/new` | 動く |
| 6-5 アクセス解析 | `/analytics` | 動く |
| 6-7 クロス分析 | `/analytics?tab=cross` | 動く |
| 6-9 ファネル分析 | `/analytics?tab=funnel` | 結果の表示は動く。作成画面は未 |
| 6-10 URLクリック測定 | `/analytics?tab=clicks` | 動く |
| 4-2-1 配信前チェック | `/broadcasts`（作成フォーム内） | 動く |
| 6-6 サイトスクリプト | `/inflow-links?tab=script` | 動く |
| 10-2 ログイン履歴 | `/staff?tab=audit` | 動く |
| 4-3-3 カルーセルの検証 | テンプレートの保存時 | 動く（編集画面は未） |

旧8ルートは 308 で新しい場所へ飛び、飛んだ先には**中身が入っている**。

---

## 残っていること

### フェーズ3の残り — 作成画面

要件定義書 §2-2 B の28画面のうち、**まだ無いもの**。

```
/tags/new  /broadcasts/new  /conversions/new  /affiliates/new
/affiliate-offers/new  /reminders/new  /automations/new  /webhooks/new
/inflow-links/new  /staff/new  /accounts/new  /pools/new
/booking/menus/new  /booking/staff/new  /scoring/new
/templates/edit  /templates/carousel  /nen-campaigns/edit
/auto-replies/edit  /form-submissions/edit  /rich-menus/edit?areas
```

ただし**多くは一覧画面に作る仕組みが既にある**（タグ・成果地点・Webhook・
アフィリエイター・リマインダ・アカウント・プール・予約メニュー）。
行き止まりにはなっていない。独立した作成画面が要るかは、実際に使ってから
決めた方がよい。

**本当に無いのは `/broadcasts/new`**（一斉配信の作成）。これは大きいので、
まとまった時間が要る。

### フェーズ4 — **完了**

| 対象 | 状態 |
|---|---|
| メディアライブラリ | **完了**（#52 + #55 で使用箇所スキャンも） |
| 共通情報 | **完了**（#52。日付切り替えのCronも） |
| アクセス解析・クロス・ファネル・URLクリック | **完了**（#53 + #55 でファネルの作成画面も） |
| サイトスクリプト | **完了**（#55） |

### フェーズ5 — 仕上げ

| 項目 | 状態 |
|---|---|
| 自動応答の評価順・種別 | **完了**（#48） |
| 機能設定 | **完了**（#49。サイドバーの並び替えは未） |
| 配信前チェック | **完了**（#54） |
| カルーセルの検証 | **完了**（#56）。専用の編集画面はまだ無く、JSONで入れる |
| ログイン履歴 | **完了**（#56） |
| 二要素認証 | **未**。列だけ。認証の仕組みそのものが要るので、単独で見積もる方がよい |
| サイドバーの並び替え | **未**。機能設定の画面はあるが、並び順は触れない |

---

## 使わずに残した列（理由付き）

`docs/v024-decisions.md` の §5 §6 に詳しく書いた。**どちらも入れると壊す方が
大きい**という判断。

- `scenarios.allow_concurrent` — 既に部分UNIQUE索引があり、重複登録はいまも
  起きない。索引を落とすのは追加のみポリシーで禁止。別の読み方（シナリオを
  またぐ排他）なら実装できるが、既定が 0 なので入れた瞬間に全シナリオの
  挙動が変わる
- `broadcasts.stealth_spread_minutes` — 二重送信の危険に直に触れるので、
  冪等性テストの拡張とセットでないと出せない

---

## 受け入れ条件（§8）の状態

| # | 条件 | 状態 |
|---|---|---|
| 1 | V2の85画面すべてにルートがある | **未達**。上の残りぶん |
| 2 | 行き止まりがゼロ | **達成**（`route-integrity.test.ts` が毎回見る） |
| 3 | 旧ルートが308で飛ぶ | **達成**。飛んだ先に中身も入っている |
| 4 | 更新系すべてに `requireRole` | **達成**（`route-guard-coverage.test.ts` 通過） |
| 5 | 外部API停止時に500を返さない | 既存ぶんは維持。新規APIは外部を叩かない |
| 6 | 一斉配信が二重送信しない | 既存のまま（触っていない） |
| 7 | マイグレーションが既存データに当たる | **未確認**。どのDBにも適用していない |
| 8 | build / typecheck / test が通る | **達成** |
| 9 | 1440px・1920px で横スクロールが出ない | 未確認 |
| 10 | 版が全パッケージで 0.24.0 | **達成** |

---

## 数字

- マイグレーション: 099〜104 の6件（+ 0.23.0 の 088〜098）＝ 合計17件
- 新しいテーブル: 12
- DBヘルパ: 9本
- 新しいWorkerルート: 6本（`friend-fields` `friend-attributes` `feature-settings` `contents` `analytics` `site-tracking`）
- 新しい画面: 6 ＋ タブ統合10画面
- テスト: worker **1273** / db **202** / web **43** / scripts **106**

---

## 次にやるとよい順

1. **PRを下から順にマージ**。積み上げなので、#44 から順に見てもらうのが速い
2. **マイグレーションの適用**。対象・影響・バックアップ・切り戻し方法を
   直前に共有する（0.23.0 のぶんと合わせて 088〜104 の17件）
3. **二要素認証**。列はあるが、認証の仕組みそのものが要る。単独で見積もる方がよい
4. 作成画面の穴埋め（多くは一覧に作る仕組みがあるので、実際に使ってから判断）

---

## 保留を解いたもの（2026-08-16）

| 項目 | どうしたか |
|---|---|
| サイドバーの並び替え | 機能設定の画面に上下ボタンを付けた。`sidebar.order` を保存し、サイドバーが読み込み時に使う。知らないセクション名は後ろに残すので、機能が増えても消えない |
| `scenarios.allow_concurrent` | 「他のシナリオが動いている人は登録しない」として実装。既定を壊さないよう、104 で既存行を全部 1 に倒した。詳しくは `v024-decisions.md §5` |
| `broadcasts.stealth_spread_minutes` | 分数で割った人数だけ送り、残りは次の cron に回す。既にある `batch_offset` の再開経路に乗せているので、二重送信の危険は増えていない。詳しくは `v024-decisions.md §6` |

## 引き渡し前の点検（2026-08-16）

| 見たところ | 結果 |
|---|---|
| 型検査（db / shared / worker / web） | 通る |
| テスト | worker 1273 / db 202 / web 43 / scripts 106 —— 全部通る |
| `check-migrations.ts` | 通る（65件） |
| `bootstrap.sql` の再生成 | 差分は `bootstrap-meta.json` だけ。104 はデータのみでDDLが無いので正しい |
| 行き止まり・動的セグメント・旧URLのリダイレクト | `route-integrity.test.ts` 13件 通る |
| 画面の権限 | `route-guard-coverage.test.ts` 3件 通る |
| `next build` | 79ページ。最大 `/accounts` 138kB、中央値 115kB、共通 102kB |
| 画面が呼ぶAPIの実在 | 新しい画面から呼ぶ22メソッド、全部 `api.ts` にある |
| Worker の束ね直し（`wrangler --dry-run`） | 通る。1.6MB（上限10MB） |
| 経路の重複登録 | 無し |
| `console.log` の消し忘れ | 無し |

**引き渡し前に直したもの**:

| 直したところ | 中身 |
|---|---|
| `useSearchParams` の Suspense | 包んでいなかった5画面（`broadcasts` `scenarios/detail` `inflow-links/detail` `booking/staff/shifts` `booking/menus/staff`）を、他の20画面と同じ形にそろえた。**書き出されるHTMLは変わらない** —— 画面全体がログイン確認の内側にあり、もともとクライアント側で描いているため。将来 Next が静的書き出しの扱いを厳しくしたときに、この5つだけ落ちるのを避ける |
| LINEの緑の直書き | 26ファイル・61か所の `#06C755` を `--color-accent` に寄せた。値は同じなので見た目は変わらない。インライン `style` はクラスに変えず `var(--color-accent)` にしている —— クラスにすると指定の強さが変わり、他のクラスとの勝ち負けが入れ替わる場所があるため |
| 名前の無いボタン | チャットの「戻る」が矢印だけで、読み上げで何のボタンか分からなかった。`aria-label` を付けた |
| `/staff/new` の権限 | APIが `requireRole('owner')` なのに、画面にその案内が無かった |

**直していないもの**:

- 旧いTailwindのクラス（`bg-white` `text-gray-*` `border-gray-*`）が
  多くの画面に残っている。ダークモードが無いのでトークンと同じ見た目になり、
  置き換えても得るものが無い割に差分が大きい。触らない方がよいと判断した。
- 二要素認証。列はあるが、認証の仕組みそのものが要る。単独で見積もる方がよい。
