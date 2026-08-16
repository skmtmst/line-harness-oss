# 設計ノードID対応表

実装時に「どの画面の設計を見ればよいか」を一意に決めるための対照表。

- 設計ファイル: `~/.pencil/documents/c0e607ec-152b-4e80-a8ae-5c32a234de6b/pencil-new.pen`
- 作成日: 2026-08-16
- 画面数: V2（PC）85 ／ MV2（スマホ）21 ／ TV2（タブレット）3 ／ R-（飲食店・多店舗案）8 ＝ **117**

## 使い方

Pencil MCP で1枚を見るときは、ノードIDを直接指定する。

```
mcp__pencil__get_screenshot  { filePath: "<上記パス>", nodeId: "<ID>" }
mcp__pencil__export_nodes    { filePath: "<上記パス>", nodeIds: ["<ID>"] }
```

> `.pen` は暗号化されているため、Read / Grep では開けない。必ず Pencil MCP 経由で参照すること。

## 再利用コンポーネント

| 名前 | ID | 用途 |
|---|---|---|
| **Sidebar V2** | `khQh9` | V2の全85画面が参照。仕様は `docs/sidebar-v2-spec.md` |
| Sidebar（V1） | `UGV7c` | 旧デザイン用。**参照しない** |

`Sidebar V2` の選択状態は、各画面の `ref` ノードの `descendants` で上書きしてある。83画面ぶんの「どの項目が選択状態か」がそのまま入っているので、実装時の対応表として使える。

## キャンバスの並び

| x座標 | 内容 |
|---|---|
| −4360 / −2180 | Lステップの取り込み（調査用素材。実装対象外） |
| 0 | 現行実装のスクリーンショット |
| 2180〜 | V1（旧デザイン。**V2で完全に置換済み。参照不要**） |
| **11000〜** | **V2（PC）** ← 実装の正 |
| y=247000 | MV2（スマホ） |
| y=248262 | TV2（タブレット） |
| y=250000 | R-（飲食店・多店舗案） |

各V2画面の**真上**に深緑のタイトル帯（`Title V2 ...`）があり、画面名・ルート・V1からの統合由来が書いてある。これは画面ではないので実装対象外。

---

## 1. V2（PC）85画面

**詳細画面は `?id=` で表す。** この管理画面は静的書き出し（`next.config` の
`output: 'export'`）なので、`/friends/[id]` のような動的セグメントは
書き出せない。ビルド時に全IDが分からないため。

`apps/web/src/lib/route-integrity.test.ts` が `[id]` の混入を検出して落とす。

| 書きたくなる形 | 実際のルート |
|---|---|
| `/friends/[id]` | `/friends/detail?id=` |
| `/broadcasts/[id]` | `/broadcasts/detail?id=` |
| `/templates/[id]` | `/templates/detail?id=` |
| `/booking/bookings/[id]` | `/booking/bookings/detail?id=` |


| 画面 | ノードID | ルート |
|---|---|---|
| V2 0-1 ログイン | `cmvKe` | `/login` |
| V2 1-1 ダッシュボード | `EgKGw` | `/` |
| V2 1-1-1 友だち追加のQRコード | `W6DU2` | `/?qr` |
| V2 2-1 受信箱 | `nR2FI` | `/chats` |
| V2 2-1-1 テンプレートを選ぶ | `AUzdY` | `/chats?template` |
| V2 2-2 友だち | `P2guNv` | `/friends` |
| V2 2-2-1 友だち詳細 | `B8yZio` | `/friends/detail?id=` |
| V2 3-1 タグ管理 | `IvqXE` | `/tags` |
| V2 3-1-1 タグを作る | `oTvZD` | `/tags/new` |
| V2 3-2 友だち情報欄 | `KWqHd` | `/tags?tab=fields` |
| V2 3-2-1 項目を追加する | `nKQRg` | `/tags/fields/new` |
| V2 3-3 対応マーク管理 | `rKbqo` | `/tags?tab=marks` |
| V2 3-4 保存した検索 | `HdEpm` | `/tags?tab=searches` |
| V2 4-1 シナリオ配信 | `o0oT6d` | `/scenarios` |
| V2 4-1-1 シナリオ編集 | `g6qn3` | `/scenarios/detail` |
| V2 4-2 一斉配信 | `Jv6hR` | `/broadcasts` |
| V2 4-2-1 一斉配信の作成 | `V0LpC` | `/broadcasts/new` |
| V2 4-2-2 配信の詳細 | `WCVy5` | `/broadcasts/detail?id=` |
| V2 4-3 テンプレート | `YTMBU` | `/templates` |
| V2 4-3-1 テンプレート編集 | `XNGOk` | `/templates/edit` |
| V2 4-3-2 テンプレートの詳細 | `O4ultt` | `/templates/detail?id=` |
| V2 4-3-3 カルーセルの編集 | `R15R9` | `/templates/carousel` |
| V2 4-4 リマインダ | `g4I4C` | `/reminders` |
| V2 4-4-1 リマインダを作る | `UhsUO` | `/reminders/new` |
| V2 4-5 自動応答 | `P67WJ` | `/auto-replies` |
| V2 4-5-1 自動応答編集 | `oJeaK` | `/auto-replies/edit` |
| V2 4-6 友だち追加時の配信 | `u1P0gG` | `/friend-add-settings` |
| V2 4-7 リッチメニュー | `I0BAA` | `/rich-menus` |
| V2 4-7-1 リッチメニュー編集 | `ofqa7` | `/rich-menus/edit` |
| V2 4-7-2 メニューのエリアを編集する | `qyE1c` | `/rich-menus/edit?areas` |
| V2 4-7-3 リッチメニューを作る | `SRYcQ` | `/rich-menus/new` |
| V2 4-8 ウェビナー | `hEIbM` | `/webinars` |
| V2 4-8-1 ウェビナーの編集 | `L6dey8` | `/webinars/edit` |
| V2 4-8-2 ウェビナーを作る | `K4wp0` | `/webinars/new` |
| V2 5-1 メディアライブラリ | `AfRgY` | `/contents` |
| V2 5-2 共通情報 | `S20UY` | `/contents?tab=vars` |
| V2 5-2-1 共通情報を追加する | `lMWil` | `/contents/vars/new` |
| V2 6-1 成果とアフィリエイト | `K9ZuPP` | `/conversions` |
| V2 6-1-1 成果地点を作る | `BhTq4` | `/conversions/new` |
| V2 6-1-2 案件 | `Z50laP` | `/affiliate-offers` |
| V2 6-1-3 案件を作る | `IGbns` | `/affiliate-offers/new` |
| V2 6-1-4 アフィリエイターを追加する | `hfRiu` | `/affiliates/new` |
| V2 6-2 流入経路 | `tiKvb` | `/inflow-links` |
| V2 6-2-1 流入経路の詳細 | `cpxne` | `/inflow-links/detail` |
| V2 6-2-2 リンクを発行する | `C3eta` | `/inflow-links/new` |
| V2 6-3 回答フォーム | `v2tEQe` | `/form-submissions` |
| V2 6-3-1 回答フォーム編集 | `j4y6q` | `/form-submissions/edit` |
| V2 6-4 マイル | `qivt1` | `/scoring` |
| V2 6-4-1 付与ルールを作る | `Wd0Rr` | `/scoring/new` |
| V2 6-5 アクセス解析 | `C4qpF` | `/analytics` |
| V2 6-6 サイトスクリプト | `qb9Es` | `/inflow-links?tab=script` |
| V2 6-7 クロス分析 | `X5uwj` | `/analytics?tab=cross` |
| V2 6-8 広告連携 | `Ioxcm` | `/inflow-links?tab=ads` |
| V2 6-9 ファネル分析 | `nRbh3` | `/analytics?tab=funnel` |
| V2 6-10 URLクリック測定 | `rPp6w` | `/analytics?tab=clicks` |
| V2 6-11 検索からの流入 | `T0JpX1` | `/search-console` |
| V2 7-1 オートメーション | `xg4cp` | `/automations` |
| V2 7-1-1 ルールを作る | `kwnUH` | `/automations/new` |
| V2 7-2 外部連携 | `l8hjV` | `/webhooks` |
| V2 7-2-1 Webhookを追加する | `sPV84` | `/webhooks/new` |
| V2 8-1 予約管理 | `EAYvf` | `/booking/bookings` |
| V2 8-1-1 予約の詳細 | `IHRKE` | `/booking/bookings/detail?id=` |
| V2 8-2 予約設定 | `nFCBf` | `/booking/menus` |
| V2 8-2-1 メニューを追加する | `swtmr` | `/booking/menus/new` |
| V2 8-2-2 予約スタッフを登録する | `bEL9g` | `/booking/staff/new` |
| V2 8-2-3 受付時間・カレンダー | `uJ37b` | `/booking/staff/shifts` |
| V2 8-2-4 メニュー×スタッフ | `B88kuI` | `/booking/menus/staff` |
| V2 8-3 イベント予約 | `Ih3xS` | `/events` |
| V2 8-3-1 イベントの編集 | `Ks5oq` | `/events/edit` |
| V2 8-3-2 イベントを作る ①概要 | `C2Qr4h` | `/events/new` |
| V2 8-3-3 イベントを作る ②予約枠 | `u9Dp8` | `/events/new?step=2` |
| V2 8-3-4 イベントを作る ③公開設定 | `G1lc3` | `/events/new?step=3` |
| V2 8-3-5 イベントの予約者 | `gHmNK` | `/events/bookings` |
| V2 9-1 NEN配信 | `avsJj` | `/nen-campaigns` |
| V2 9-1-1 NENコラムを編集する | `VIEh6` | `/nen-campaigns/edit` |
| V2 9-2 写真審査 | `R6DpY` | `/health` |
| V2 9-3 EC連携 | `Y7zWp` | `/ec-commerce` |
| V2 10-1 アカウント | `EQZrF` | `/accounts` |
| V2 10-1-1 LINEアカウントを追加する | `eSnZF` | `/accounts/new` |
| V2 10-1-2 プールを作る | `LnJnc` | `/pools/new` |
| V2 10-2 ログインユーザー | `MurLW` | `/staff` |
| V2 10-2-1 ユーザーを追加する | `AO32J` | `/staff/new` |
| V2 10-3 機能設定 | `L4i84d` | `/settings` |
| V2 10-4 運用状態 | `Uu1wz` | `/emergency` |
| V2 10-5 データ移行 | `W0kiE0` | `/accounts?tab=migration` |

> **`V2 1-1 ダッシュボード`（`EgKGw`）だけ高さが 2560、`V2 10-3 機能設定`（`L4i84d`）が 2600。** 他は 1900。スクロールが前提の画面なので、実装でも縦に長くなる。

---

## 2. MV2（スマホ 390×844）21画面

| 画面 | ノードID | 対応するPC画面 |
|---|---|---|
| MV2 0-1 ログイン | `f2WHSu` | `cmvKe` |
| MV2 1-1 ダッシュボード | `sl7P8` | `EgKGw` |
| MV2 メニュー（ドロワー） | `LP9Zs` | Sidebar V2 |
| MV2 2-1 受信箱 一覧 | `XvMc0` | `nR2FI`（左ペイン） |
| MV2 2-1-1 受信箱 トーク | `o7el8` | `nR2FI`（中央ペイン） |
| MV2 2-1-2 受信箱 友だち情報（シート） | `rwM8E` | `nR2FI`（右ペイン） |
| MV2 2-2 友だち一覧 | `U5e4U` | `P2guNv` |
| MV2 2-2-1 友だち詳細 | `Heaga` | `B8yZio` |
| MV2 2-2-2 友だち詳細 03 健康・体調 | `D77s2I` | `B8yZio`（タブ） |
| MV2 3-1 タグ管理（一覧の共通型） | `qnujK` | `IvqXE` ほか一覧13画面の型 |
| MV2 4-1-1 シナリオ編集 | `YHMLW` | `g6qn3` |
| MV2 4-2-1 一斉配信の作成 | `z44RCK` | `V0LpC` |
| MV2 4-4-1 リマインダを作る（フォームの共通型） | `ZwV0n` | `UhsUO` ほかフォーム20画面の型 |
| MV2 4-5 自動応答 | `hb0f1` | `P67WJ` |
| MV2 6-5 アクセス解析 | `c29AAY` | `C4qpF` |
| MV2 8-1 予約管理 | `QB0L5` | `EAYvf` |
| MV2 8-1-1 予約の詳細 | `k60AO` | `IHRKE` |
| MV2 9-2 写真審査 | `BgpSy` | `R6DpY` |
| MV2 10-3 機能設定 | `s6A7x` | `L4i84d` |
| MV2 その他（ハブ） | `vS2oO` | 下タブの「その他」 |
| MR-3 更新の承認キュー（店長） | `m3Rh2b` | `yE2Tv`（飲食店案） |

**`qnujK`（一覧の共通型）と `ZwV0n`（フォームの共通型）が要。** この2枚のルールを実装すれば、残りの一覧13画面・フォーム20画面はスマホ版を個別に描かなくても導出できる。

---

## 3. TV2（タブレット 1024×1200）3画面

| 画面 | ノードID | 型としての役割 |
|---|---|---|
| TV2 2-1 受信箱（タブレット・2ペイン） | `JWGJP` | 3ペイン → 2ペイン＋シート |
| TV2 2-2 友だち（タブレット・列を減らす） | `yrle5` | テーブルの列を削る |
| TV2 4-2-1 一斉配信の作成（タブレット） | `XUJ1J` | 右カラムを本文の下へ積む |

3枚とも実画面ではなく**変換規則の見本**。サイドバーは64pxのアイコンレールに畳んである。

---

## 4. R-（飲食店・多店舗案）8画面

v0.24.0 / v0.25.0 ではスコープ外。機能としては作るがメニューから隠す方針。

| 画面 | ノードID |
|---|---|
| R-1 本部 店舗一覧 | `O4CCC` |
| R-2 組織とアカウント階層 | `FlPjH` |
| R-3 更新の承認キュー | `yE2Tv` |
| R-4 予約台帳 | `B6ikR` |
| R-5 座席・卓の管理 | `Nv5Iz` |
| R-6 予約枠と席数 | `RlSXO` |
| R-7 メニュー管理 | `P5Uskt` |
| R-8 Googleビジネスプロフィール連携 | `NHjve` |

---

## 5. 優先順位（実装の着手順）

| Tier | 画面 | ノードID |
|---|---|---|
| **1（毎日使う・8枚）** | ダッシュボード | `EgKGw` |
| | 受信箱 | `nR2FI` |
| | テンプレートを選ぶ | `AUzdY` |
| | 友だち | `P2guNv` |
| | 友だち詳細 | `B8yZio` |
| | 一斉配信 | `Jv6hR` |
| | 一斉配信の作成 | `V0LpC` |
| | 配信の詳細 | `WCVy5` |
| **2（週次・14枚）** | 友だち属性4タブ | `IvqXE` `KWqHd` `rKbqo` `HdEpm` |
| | タグ・項目の作成 | `oTvZD` `nKQRg` |
| | テンプレート4 | `YTMBU` `XNGOk` `O4ultt` `R15R9` |
| | シナリオ2 | `o0oT6d` `g6qn3` |
| | リマインダ2 | `g4I4C` `UhsUO` |
| **3（月次・23枚）** | 予約6 | `EAYvf` `IHRKE` `nFCBf` `swtmr` `bEL9g` `uJ37b` `B88kuI` |
| | イベント6 | `Ih3xS` `Ks5oq` `C2Qr4h` `u9Dp8` `G1lc3` `gHmNK` |
| | 成果と分析11 | `K9ZuPP` `BhTq4` `Z50laP` `IGbns` `hfRiu` `tiKvb` `cpxne` `C3eta` `C4qpF` `qb9Es` `X5uwj` `Ioxcm` `nRbh3` `rPp6w` `T0JpX1` |
| **4（初期設定のみ・14枚）** | 設定7 | `EQZrF` `eSnZF` `LnJnc` `W0kiE0` `MurLW` `AO32J` `L4i84d` `Uu1wz` |
| | 専用機能4 | `avsJj` `VIEh6` `R6DpY` `Y7zWp` |
| | コンテンツ3 | `AfRgY` `S20UY` `lMWil` |
| | 残り | `cmvKe` `W6DU2` `u1P0gG` `I0BAA` `ofqa7` `qyE1c` `SRYcQ` `hEIbM` `L6dey8` `K4wp0` `P67WJ` `oJeaK` `v2tEQe` `j4y6q` `qivt1` `Wd0Rr` `xg4cp` `kwnUH` `l8hjV` `sPV84` |
| **5（PC版が固まってから）** | スマホ21 / タブレット3 | 上記 §2 §3 |

---

## 6. 関連ドキュメント

| 文書 | 内容 |
|---|---|
| `docs/sidebar-v2-spec.md` | サイドバー9区分30項目の実装仕様（v0.25.0 第1段階） |
| `docs/requirements-v0.24.md` | 裏側の要件定義。テーブル・API・画面遷移・エラーの扱い |
| `docs/v1-to-v2-inventory.md` | V1→V2の棚卸し、統合の由来、レスポンシブ変換規則 |
