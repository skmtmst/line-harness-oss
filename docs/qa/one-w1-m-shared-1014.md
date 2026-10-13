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

## 画面の接続（候補前）

RwVo5/VsSyu/yOyCgは提供指定の480幅。tnTn9/oqSJPはheightMode=viewport。V6JFndはcontentLayout=form。共通部品の既定・CSS・APIは変更なし。
関連54ファイル267件、機能19ファイル120件、tsc/lint成功。lintの既存警告は保持。
今回の追加コードは指定6行のみ。既存の長い一覧の分割は共通取込みと別の区切りで扱い、新設ファイルは400行以内。
本番形式ビルドと3幅の再取得・鍵の検査は次工程であり、未実施を合格に数えない。
