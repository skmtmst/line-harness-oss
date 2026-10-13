# 崩れの見張り（B-191/192・B-187）

```sh
node apps/web/scripts/v8-guard/layout-defects.mjs http://127.0.0.1:4310 /tmp/v8-guard/defects.json
node --test apps/web/scripts/v8-guard/layout-defects.test.mjs
```

既存 V8 guard の主要画面、流入と計測・コンバージョン一覧、blankfix が調べる画面を、1152・1440・1920 で順に開く。モック API・静的なビルド・固定時計・同梱フォントを使う。測定に失敗した画面・予期しない転送・画面のエラーも停止する。ブラウザとページは一度に1つずつ。

判定の出典は `~/lh-work/design/v8/review/overlap-1010/detect.cjs`（2026-10-10）。

| 種類 | 停止する条件 |
| --- | --- |
| wrap | 24文字以下の文字が2行以上（行の top を4px単位で数える） |
| squash | 2行以上で1行あたり2.5文字以下 |
| overlap | 同じ位置の層にある別要素の文字が横2px・縦3pxより大きく重なる |
| clip | 最寄りの overflow 枠から文字が左右2pxより大きく出る |
| touch | 縦並びの見える箱が両方40px以上で、すき間が0〜7px |
| blank | 見える箱が200×200px以上で、中身の下に64px以上残る |

表の隣り合う行・見出しは touch の対象外。表の文字の重なり・折り返しは対象のまま（B-191）。フォルダ列・左メニュー・LINEの吹き出しは対象外。画面いっぱいの板の下の余りも数えない。1行省略の切れと全文の title は既存 `layout-overflow.mjs` に任せる。

空白の途中・横・数の帯は `codex/kenta-blankfix-1010` の `blank-gap-browser.mjs` を共有する。途中・横は余白24を引いた96px以上、数の帯は全マスに24px以上の余りがある時に止める。箱の下と200×200px以上の空の箱は `skipPanelBottom: true` で重複を外し、`panel-blank-browser.mjs` の64pxの判定だけで測る。

既存違反は `layout-defects-allow.json` に画面・幅・種類・要素・相手・文字・件数・実寸・理由を個別登録する。場所や文字が違うもの、件数増、折り返し行数増、重なり増、切れや空白の増加、すき間の縮小は、登録済みでも止める。CSS Modulesのハッシュは識別子に含めない。許可が不要になった項目は画面修正と一緒に削る。

手元での採取（自動追加は CI では拒否）：

```sh
node apps/web/scripts/v8-guard/layout-defects.mjs http://127.0.0.1:4310 /tmp/record.json --record-allow /tmp/proposed-allow.json --reason '今回だけ許可する具体的な理由'
```

採取した内容を確認してから許可表に入れる。画面の測定失敗があれば保存しない。対照試験は9種類の壊れたHTMLで検出とCLIの終了コード1を確認し、それぞれ修復したHTMLは0になることも確認する。CLIの `--fixtures <JSON>`（名前→HTML）で1つのブラウザを順に使い回す。除外・許可後の悪化も試験する。

CI は `required-pr-gate.yml` の既存 `v8-screen-guard` 内で同じ条件で動き、失敗は必須チェックを止める。結果は既存の `v8-screen-guard` artifact に残る。blankfix を統合する時は同枝の別の `blank-gap.mjs` 実行ステップを重ねず、この実行1つにする（重複したCI設定は対照試験が止める）。`browser-env.mjs` の待ち時間指定とエラー通知は両方残す。


PR番号はまだ採っていない。統合者は `docs/release-log/unreleased/pending-kenta-guards-1010.md` を採番後のファイル名へ変え、本文の `#未採番` も実際の番号へ変える。
