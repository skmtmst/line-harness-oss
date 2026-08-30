# Claude側でUIを直す：第1回の選定（8〜15 Node の試行）

**日付**：2026-08-30 ／ **基点**：`codex/development` `2d0ee180`
**変更してよい範囲**：`apps/web` の画面・画面専用部品、その契約テスト、
`scripts/visual-qa/fixtures.mjs`・`mock-api.mjs`、撮影手順・台帳、
`docs/release-log/unreleased/` のPR別ファイル。
**変更しない**：`apps/worker`、`packages/db`、migration、API契約・ルート、本番DB・配備。

## 重ならないファイルの決め方

**ルートの `page.tsx` だけでは足りない。** import を追って、
**その画面が実際に読むファイル**まで広げた。ただし数えるのは
**私が実際に編集するもの**だけ——`components/shared/`・`src/lib/`・
`components/layout/`・`components/dashboard/` は**触らないので除く**
（触れば全PRと重なる）。

その集合を open PR 144本の変更ファイルと突き合わせ、**1本も重ならない**ものだけ残した。

- UIだけで直せる候補：**137枚**
- うち重複ゼロ：**11枚**
- うち**実際に直す中身がある**：**7枚**（残り4枚は下の表のとおり）

## 選んだ7 Node

| # | Node | 設計 | 触るファイル | 直すこと | データ |
|---|---|---|---|---|---|
| 1 | `xOpDs` | 25-2 共通アクション | `app/common-actions/page.tsx` | 帯を設計の4つへ。**「古い版のまま 要確認」を足す** | **既存の口で足りる**——一覧が `oldVersionBindingCount` `bindingCount` を返している |
| 2 | `syWp4` | 25-2-B 版と使われている場所 | `app/common-actions/versions/page.tsx` | 帯を設計の4つへそろえる | 同上 |
| 3 | `py5CG` | 25-2-A つくる | `app/common-actions/new/page.tsx` ほか | 「複製して作る」の導線 | 既存の作成の口 |
| 4 | `cCB7r` | 5-1-A 配信方式 | `app/scenarios/mode/page.tsx` | 選択肢の下に**見本を1行**（何日後・何時・くり返しの例） | **文言だけ** |
| 5 | `TEVk8` | 18-1-C 流入リンクをつくる | `app/inflow-links/new/page.tsx` | **タグの選び口をフォルダで束ねる** | **既存の口で足りる**——タグが `groupId` を持ち、`/api/tag-groups` がフォルダ名を返す |
| 6 | `RUxNf` | 5-1-I 配信開始確認 | `app/scenarios/page.tsx` ほか | 配信前チェック。**導ける2項目だけ出し、残り2つは「—（未取得）」** | 一部のみ。**取得元の無い値は作らない** |
| 7 | `XtfO3` | 12-1-A 形とボタン | `app/rich-menus/new/page.tsx` | 段へ分ける | 画面だけ |

**束ね方**：①②③は同じ機能・同じ画面群なので**1本のPR**。④⑤⑥⑦は画面が別なので別PR。

## 重複ゼロだが選ばなかった4 Node

| Node | 理由 |
|---|---|
| `xqT1Z` 16-1-D | 残る差は**振込先**で、`affiliates` に列が無い。**DBの変更が要る**ので範囲外 |
| `GPWzq` 16-1-F | 成果地点の紐づけも支払い条件も**DBの変更が要る** |
| `TC1b1` 5-1 | **直すところが無い**（取り込み順の話で、実装の差ではない） |
| `q5G45` 5-1-M | **いまの形を維持するのが正解**と判定済み |

## 触らないもの（指示どおり）

- `app/scenarios/detail/scenario-detail-client.tsx`（#553・#534）
- `components/scenarios/action-editor.tsx`（#437・#420）
- `app/booking/bookings/new/page.tsx`（#587）と、#587が触るテスト・予定計算
- 設計画像が無い5枚：`tP0RW` `LfrQs` `VjXGX` `byqIW` `KoT6c`

## 自作分の品質ゲート

1. 見える文言と重要構造を固定する契約テスト
2. 該当する状態（通常・読込・空・失敗・権限不足）を分ける
3. **未取得と0を分ける**
4. `API error`・内部ID・内部状態名を出さない
5. 1440px・1920pxでページと内側の横スクロール0
6. `undefined` / `Invalid Date` / `NaN` を撮影前に検査
7. **実装を一度わざと壊し、足したテストが落ちることを確かめる**
8. typecheck・関連テスト・build・design-debt・diff-check を通す

**直した本人が比較したことを、台帳とPRコメントに明記する。**
Codexがあとから前後の絵と差分を独立に確かめられるようにする。
