# M5：W・Kが待つ窓の共通部品を先に渡す

開始33b2bb1034、クリーン。doctor合格、pnpm install --frozen-lockfile成功。fetch後の本線e0b86e4588は取り込み済み、mergeは変更なし。

## 提供するコミット

| コミット | 中身 | 実画面の確認 |
|---|---|---|
| c07188bace | DialogFormRow、ConfirmDialog.contentLayout=form、Drawer.heightMode=viewport | M4で入力512/512、幅480/720を3幅確認 |
| ae9ccdd6c0 | 削除窓のDialogActions、明細の日時の内容幅判定 | 重なりが3→0、12→0 |
| 96ead47136 | 共通情報を止める短い窓のstacked・DialogActions・Notice | 頭と本文の間14 |
| 75b234490a | 別段の説明文の下から本文の空きを測る見張り | 正常14・故障24の3幅対照成功、上限16維持 |

Mの差し戻し6板はi8F12/u8sKN/Hhl9M/M4jS9/Nv7An/C0lfUPを実測済み。Wの7板は接続が必要で、完了扱いにはしない。

| 担当 | 板 | 接続する口 |
|---|---|---|
| W | RwVo5・VsSyu・yOyCg | Dialog.designWidth=480 |
| W | tnTn9・oqSJP | Drawer.heightMode=viewport |
| W | V6JFnd | ConfirmDialog.contentLayout=form。幅は司令塔判断 |
| W | okXoi | Field.required。Mの共通変更だけで直る物とは別 |
| K | n4j0Rm | DialogFormRow＋Dialog.onConfirm、またはDialogActions |
| K/F | NkmwU | DialogFormRow、またはDialog.contentLayout=form |

## 追加した共通修正

KのYZ57zはdescriptionBand=dangerを接続済みだが、指定帯の文字規則はcomponents層、通常descriptionは層の外で、通常の灰色13/20が勝つ。dangerの既存の文字規則だけを通常descriptionと同じ層へ移し、既存の指定色・11/17を効かせる。停止確認CFAyfは鍵の対象なのでwarningの形を保持する。指定なしの説明13/20、API、取消、実行、保存条件も保持する。製品はdcda62e6f9と81a7ae9b66の2コミットで保存した。

Dialogは帯の種類を見張りへ伝える。実CSSの3幅・読み込み順2通り・dangerの対照を実ブラウザ工程に追加。規則をcomponents層へ戻す故障、灰色の故障、通常本文13/20へ戻す故障を検出する。通常の説明とwarningは既存の形を保つ対照も置く。Vitest内ではブラウザを起動しない。

関連10ファイル58件成功。種類を伝えるassert追加後の2ファイル9件、dangerだけに限定した後の同9件も成功。tsc成功、Dialogのlintエラー・警告0、差分成功。全Webは列車の担当なので実施していない。

実ブラウザ対照はheavy.shの枠待ちで未実行。初回確認ではslot3のG12/final.shがROUND2-READY待ちを保持していた。後続の確認ではround2が保護検査へ進んでおり、現在の枠が停止したままという意味ではない。Mの命令にはまだ検査の子プロセスが無い。他組の処理・合図・道具・枠は変更しない。追加修正を実測改善・正式候補へ数えない。147板の鍵によるMの最新の保護確認も未実施。前回のwxIQ7鍵不足を今回の結果へ流用しない。

## 全体の数（M4の検証済み版）

撮影75b234490aの41枚123条件・測定122の値。今回の追加後の測定ではない。

| 仲間 | 枚数 | 機械0 | 指摘1〜3種 | 多い | 測れない |
|---|---:|---:|---:|---:|---:|
| 確認・編集など | 31 | 25 | 5 | 0 | 1 |
| 選ぶ窓 | 2 | 0 | 2 | 0 | 0 |
| QR | 2 | 0 | 2 | 0 | 0 |
| 種類・画像 | 3 | 1 | 2 | 0 | 0 |
| 行のメニュー | 3 | 3 | 0 | 0 | 0 |
| 合計 | 41 | 29 | 11 | 0 | 1 |

選ぶ窓2板の理由とQR2板のPNG幅はFへ依頼済み。種類R9XUMrは手書き4列の補足が隣へ出る。履歴N1br7は内容セルが3行、使用先Z0g3siは詳細側の手書き行が接する。次は役目と正の共通部品で束ねる。新しい型が必要なら対応表を先に足す。

今の進捗を全体像から整理するとこれ：Mの検証済み41枚は29/11/1。W/Kへの共通口は保存済み、解除の警告文を追加修正。追加後の実描画・保護・再測定は未完。
次のタスクはこれ：空いた重い枠で対照→本番形式ビルド→fresh-check→指定状態の再測定→147板の保護確認。W/Kは提供の指定を接続。その後Mの種類・履歴・使用先の束へ。

Pen・合格台帳・親EC・migration・DB・push・PR・配備は実施していない。
