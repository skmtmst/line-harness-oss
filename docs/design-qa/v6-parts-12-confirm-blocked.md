# 第2段：確認画面12枚 — **12枚すべてが「止める条件」に当たりました**

最終更新：2026-08-28

指示の止める条件のうち **「同じファイルを変更する未統合PRがある」** に
**12枚すべてが当たります。** 実装せず、ここに報告します。

`#258`（`release: 0.25.0を本番反映`）は `codex/development` → `main` の
**取り込みPR**なので、競合としては数えていません。それを除いても
12枚すべてに、いま動いている実装PRがぶら下がっています。

---

## 一覧

| # | Node | 画面 | 触るファイル | ふさいでいるPR |
|---|---|---|---|---|
| 1 | `RUxNf` | シナリオ配信開始確認 | `app/scenarios/detail/scenario-detail-client.tsx` | [#427](https://github.com/skmtmst/line-harness-oss/pull/427) `05942bca` Draft |
| 2 | `Yj6CQ` | 自動応答の最終確認 | `app/auto-replies/page.tsx` | [#491](https://github.com/skmtmst/line-harness-oss/pull/491) `5078911d`／[#430](https://github.com/skmtmst/line-harness-oss/pull/430) `e6870247`／[#450](https://github.com/skmtmst/line-harness-oss/pull/450) `2117dfca` |
| 3 | `Gy9OK` | 自動応答の削除確認 | 同上 | 同上 |
| 4 | `ec9vg` | 友だち追加時配信の最終確認 | `app/friend-add-settings/page.tsx` | [#431](https://github.com/skmtmst/line-harness-oss/pull/431) `2ab18c88`／[#420](https://github.com/skmtmst/line-harness-oss/pull/420) `87c150ad` |
| 5 | `D6yO7e` | ウェビナー公開前確認 | `app/webinars/edit/page.tsx` | [#436](https://github.com/skmtmst/line-harness-oss/pull/436) `950073ab` |
| 6 | `LKuAQ` | ウェビナー削除確認 | `app/webinars/page.tsx` | [#432](https://github.com/skmtmst/line-harness-oss/pull/432) `ed2e3633` |
| 7 | `szXsT` | リッチメニュー削除確認 | `app/rich-menus/page.tsx` | [#435](https://github.com/skmtmst/line-harness-oss/pull/435) `09dc476b` |
| 8 | `gBp2J` | 回答フォーム削除確認 | `app/form-submissions/page.tsx` | [#436](https://github.com/skmtmst/line-harness-oss/pull/436) `950073ab`／[#457](https://github.com/skmtmst/line-harness-oss/pull/457) `229ca1bc` |
| 9 | `yPkWe` | 共通情報削除確認 | `app/contents/vars/page.tsx` | [#437](https://github.com/skmtmst/line-harness-oss/pull/437) `4c65dec4` |
| 10 | `YfTfJ` | 登録メディア削除確認 | `app/contents/page.tsx` | [#438](https://github.com/skmtmst/line-harness-oss/pull/438) `166f0c43` |
| 11 | `QX70l` | 成果の削除・停止確認 | `app/affiliates/page.tsx` | [#440](https://github.com/skmtmst/line-harness-oss/pull/440) `b31d5f57` |
| 12 | `UIaM7` | 流入リンク削除確認 | `app/inflow-links/page.tsx` | [#443](https://github.com/skmtmst/line-harness-oss/pull/443) `f372ff30` |

すべて `apps/web/src/` からの道です。

---

## 確かめたこと：**どのPRも確認の窓を作っていません**

「ふさいでいるだけで、実は同じものを作っているのでは」を潰しました。
各PRの、その1ファイルぶんの差分だけを見ています。

| PR | ファイル | 変更行 | `ConfirmDialog` を足した行 |
|---|---|---|---|
| #491 / #450 | `auto-replies/page.tsx` | 28 | **0** |
| #430 | `auto-replies/page.tsx` | 2 | **0** |
| #431 | `friend-add-settings/page.tsx` | 119 | **0** |
| #436 | `webinars/edit/page.tsx` | 19 | **0** |
| #432 | `webinars/page.tsx` | 181 | **0** |
| #435 | `rich-menus/page.tsx` | 152 | **0** |
| #436 | `form-submissions/page.tsx` | 286 | **0** |
| #457 | `form-submissions/page.tsx` | 18 | **0** |
| #437 | `contents/vars/page.tsx` | 152 | **0** |
| #438 | `contents/page.tsx` | 120 | **0**（`confirm()` を1行 外してはいる） |
| #440 | `affiliates/page.tsx` | 69 | **0** |
| #443 | `inflow-links/page.tsx` | 100 | **0** |

**仕事が重なってはいません。順番がぶつかっているだけです。**
12枚は「誰も作っていないが、いま誰かが同じファイルを持っている」状態です。

---

## どうするか — 2つ

### 案1：取り込みを待つ（おすすめ）

ふさいでいる11本のうち **9本が `codex/development` を土台にした Draft** です。
取り込まれれば競合は消えます。取り込まれた順に上から実装します。

**待ちが短い順**（土台が `codex/development` のもの）：
#427・#430・#431・#432・#435・#436・#437・#438・#440・#443

`#450` と `#457` は Visual QA の枝（`codex/kenta-v6-feature7-visual` /
`codex/kenta-v6-feature12-visual`）が土台なので、別の並びです。

### 案2：#497 と同じやり方で、headの上に積む

`FpgxH` でやった形です。**ふさいでいるPRのheadを固定し、その上に
Draft を積み、取り込む順を決めておく。**

例：`szXsT` なら #435 `09dc476b` を土台にして Draft を作り、
取り込む順を **#435 → szXsT** にする。

- 利点：待たずに進む
- 欠点：**積んだ枝は取り込みのたびに競合します。** 12枚ぶん積むと
  土台が動くたびに全部を作り直すことになります

**1〜2枚だけなら案2、まとめてやるなら案1**だと思います。

---

## 作るものは決まっています

`v6-parts-19-instructions.md` に、12枚ぶんの
**再利用する部品・確認画面に出す実値・実行API・失敗時の表示・
実行を止める条件・1440/1920px の完了条件**を書いてあります。
競合が解けたら、そのまま上から実装できます。

共通の形はこれです。

```
既存の ConfirmDialog（tone="destructive" → H2S1T4）を使う
  ├ 対象名     … 一覧の行から。固定値で作らない
  ├ 影響数     … 口から取る。**取れなければ「—」を出し、確定のボタンを出さない**
  ├ 失敗の表示 … 400 だけ本文を通し、403・404・405・409 は日本語に置き換える
  └ 権限       … 消せない利用者には操作そのものを出さない
```

**「影響数が未取得なら確定操作を出さない」**は `FpgxH` で作った形と
同じです（`broadcast-form.tsx` の `canConfirm`）。
**`ConfirmDialog` に `onConfirm` を渡さないと、確認のボタンそのものが
出ません。** ここは #497 で `Dialog` に足した作りです。

---

## いま `ConfirmDialog` を触っているPR

| PR | 何 |
|---|---|
| [#497](https://github.com/skmtmst/line-harness-oss/pull/497) `84e5bab9` | `confirm-dialog.tsx` に `children` と `onConfirm?`（省略可）を足した。**Draft** |
| [#494](https://github.com/skmtmst/line-harness-oss/pull/494) `0ca45f98` | `dialog.tsx` |
| [#423](https://github.com/skmtmst/line-harness-oss/pull/423) | `dialog.tsx` |

12枚は `children` を使うので、**#497 が取り込まれた後**のほうが素直です。
