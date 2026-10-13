# oneW1：08:40の続き・M共通束の取り込み

開始73c153daa1、doctor合格、依存はfrozen-lockfileで導入済み。

## 取り込み

指定のcodex/kenta-match-m-1013を取り込む。最新本線e0b86e4588をfetchで確認。
競合4ファイルは以下の理由で解決した。

- identity-decision-dialog：WのEC操作帯/中央配置と必須理由への接続を保持。Mと同じ理由IDの自動統合による重複宣言だけを除去。API、入力、再処理、友だちの確認条件は両方保持。
- hq-banners/dialogs：Wの共通操作帯/本文formと、Field.requirementに一致した実行条件を保持。Mの未接続版へ戻さない。
- Memory/corrections：両方の追記を保持。

取り込み後の対象試験28ファイル128件、tscは成功。全Webは列車が担当。
shared/Dialogへのrelatedは対象が広がりすぎたため中断130、成功には数えず、窓と対象機能に絞り直した。

## 今回の区切り

1. 窓480/引き出し全高の接続。
2. M修正後の窓3幅の再計測・新写しとの左右画像。
3. 欠測/残る原因と合格板の保護を整理。

予想は外部oneW1/m-shared-0840/PREDICTIONS.md。Pen・合格台帳・DB・push・PRは変更しない。
