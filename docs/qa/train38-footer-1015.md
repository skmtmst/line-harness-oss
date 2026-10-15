# 列車38：左端の削除入口と V8 screen guard（2026-10-15）

開始版352c8eaa2a1a95a026c33944f2b82fd4bec85b5e、開始クリーン、ローカルdoctor合格。PR #1734のbaseはd12a5a3565d7b79e22ea2a1180d1c1d251768719で手元origin/codex/developmentと一致（GitHub APIで照合、fetchなし）。指定9枝・列車37後続の取り込みと以前の検証は既存記録を保持する。

## 原因と修正

6e0e9991d0がStickyBarActionの危険操作をButton.dangerへ接続し、白地から赤い地へ変えた。form-footer-actionは枠・白地・SVGの3条件を求める。icon:1は印が存在する意味であり、印の欠落が原因ではない。

共通StickyBarActionのdestructiveだけを既存Button.danger-outlineへ変更。白地・枠と赤い文字・印を両立する。シナリオ・タグ・保存した検索・共通情報の4入口へ同じ修正が効く。保管の副操作・無効時の理由・確認窓・削除API・権限は保ち、確認窓の確定操作はButton.dangerのまま。画面別CSS・検出器・許可・基準値・鍵・Penは変更しない。

## 検証

- 関連10ファイル60試験成功。削除入口の押下・取消・理由入力・閲覧権限、共通の帯・保存印、タグ・シナリオの既存動作を確認。[試験ログ](train38-footer-1015/related-tests.txt)（原本 /tmp/train38-footer-related-1015.log）。
- 変更したTSXのlint成功、git diff --check成功。
- 実Button/StickyBarActionの1152・1440・1920ブラウザ2試験成功。白地・枠・赤字・SVGの赤を確認し、赤い塗りつぶしと印の欠落の故障対照をすべて検出。既存の短→長→短と保存中/完了の試験も成功。[ブラウザ試験ログ](train38-footer-1015/button-browser.txt)（原本 /tmp/train38-footer-browser-1015.log）。
- 製品検証版fcc71bb43d7e74657dfe5c8aadd32650e7757cf0で `ci-local --job v8-screen-guard --pr-number 1734 --pr-title <実PR題> --pr-body <実PR本文> --var V8_SPEED_ENFORCEMENT=report --keep` が終了0。ジョブ本体23工程成功・4省略、依存のchangesは6成功・checkout省略1、計29成功・5省略・失敗0・入力不明0。[全工程](train38-footer-1015/summary.md)・[結果](train38-footer-1015/results.json)・[環境](train38-footer-1015/manifest.json)。省略は3つのuses準備・changesのcheckout・診断画像なしの参考artifactだけ。必須検査の省略はない。
- Node22.23.3・pnpm9.15.4・UTC、新品の仕事別checkout、Runner内部のheavy.shで各工程を直列実行。修正版とbaseのクリーンビルド・型・lintが成功。速度モードreportは既存の既定値と同じで、予算・stress・PERF-01・train17は測定完了かつ全て合格。MacのOS・字体をLinuxと同じにした証拠ではない。他ジョブを含むCI全工程の再実行ではない。
- 1152/1440/1920の[崩れ](train38-footer-1015/layout.json)0、[基点比較](train38-footer-1015/defects.json)は67場面×3幅=201条件で失敗0・既存許可1・既存差0。指定3画面×3幅の9条件は失敗・許可・既存差の全て0。故障対照181件、狭い見本/入力保持、回帰操作、一覧の行/骨格3幅、見出し185画面、速度11場面各5回、仮想表、リッチメニューの文字サイズ3幅も成功。
- ログ `/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301`、保存checkout `/tmp/ci-local-emqxn5_4`。初回は実PR本文の入力漏れでchangesの反映履歴判定が入力不明になり、自分のRunnerを停止して実本文を渡して最初から実行し直した。初回は検証成功に数えない。初回停止時の道具の後片付けPermissionErrorは初回ログ `/tmp/train38-footer-ci-local-1015.log` に保持。2回目は後片付けも含め終了0。

次は司令塔が `fcc71bb43d` とこの記録をpushし、GitHubの同ジョブを確認する。最後の記録コミットは文書と証拠だけで、製品と試験は検証版から変更しない。

反映履歴#1734は既存の司令塔コミットを保持し、追加は司令塔の指示後。コミットまで、push・PR操作・DB更新・配備なし。
