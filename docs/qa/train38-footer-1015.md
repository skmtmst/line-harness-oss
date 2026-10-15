# 列車38：左端の削除入口と V8 screen guard（2026-10-15）

開始版352c8eaa2a1a95a026c33944f2b82fd4bec85b5e、開始クリーン、ローカルdoctor合格。PR #1734のbaseはd12a5a3565d7b79e22ea2a1180d1c1d251768719で手元origin/codex/developmentと一致（GitHub APIで照合、fetchなし）。指定9枝・列車37後続の取り込みと以前の検証は既存記録を保持する。

## 原因と修正

6e0e9991d0がStickyBarActionの危険操作をButton.dangerへ接続し、白地から赤い地へ変えた。form-footer-actionは枠・白地・SVGの3条件を求める。icon:1は印が存在する意味であり、印の欠落が原因ではない。

共通StickyBarActionのdestructiveだけを既存Button.danger-outlineへ変更。白地・枠と赤い文字・印を両立する。シナリオ・タグ・保存した検索・共通情報の4入口へ同じ修正が効く。保管の副操作・無効時の理由・確認窓・削除API・権限は保ち、確認窓の確定操作はButton.dangerのまま。画面別CSS・検出器・許可・基準値・鍵・Penは変更しない。

## 検証

- 関連10ファイル60試験成功。削除入口の押下・取消・理由入力・閲覧権限、共通の帯・保存印、タグ・シナリオの既存動作を確認。ログ /tmp/train38-footer-related-1015.log。
- 変更したTSXのlint成功、git diff --check成功。
- 実Button/StickyBarActionの1152・1440・1920ブラウザ2試験成功。白地・枠・赤字・SVGの赤を確認し、赤い塗りつぶしと印の欠落の故障対照をすべて検出。既存の短→長→短と保存中/完了の試験も成功。ログ /tmp/train38-footer-browser-1015.log。
- ci-local --job v8-screen-guardは修正コミット後に実行する（同道具は未コミットを拒否する）。未完了を成功へ数えない。

反映履歴#1734は既存の司令塔コミットを保持し、追加は司令塔の指示後。コミットまで、push・PR操作・DB更新・配備なし。
