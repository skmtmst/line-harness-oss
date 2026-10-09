# 列車13 組立記録（途中停止）

- 作業場所：`~/lh-work/lh-train-13`
- 専用ブランチ：`codex/kenta-train-13-1010`
- 土台：`origin/codex/development` = `53f4b6f7e3e58d5e38f8e06fb8d71a60c4dd88e3`
- 開始前 doctor：`DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` の最終行「合格」。開始時のLINE・親EC作業ツリーはクリーン。
- 依存の固定版インストールと共有パッケージのビルドを実施。
- push・PR作成・D1更新・配備は未実施。

## 取り込み

各枝を順番に merge commit で取り込んだ。各コミット前に `git diff --cached --check` と worker・web の型検査が合格。

| 順番 | 枝（すべて `codex/` 配下） | merge commit |
| --- | --- | --- |
| 1 | kenta-v8-look-10091725 | aa1bea2b1437956d7c290b8e75e1fd1719d435be |
| 2 | kenta-v8-rules2-10092230 | 3e0ff179282bc05bab37c471dae77d7e8cd44b19 |
| 3 | kenta-v8-behavior-10092130 | 090f4fe2f7ca94e600d70a0a85033c2c89d24d30 |
| 4 | kenta-bugfix-parity-10092300 | a53ffcdbd7b5208630d9889374168ac46b74db10 |
| 5 | kenta-parity-b173-10092330 | d0daff1fa09d021f31e6eef93e4adad9285b7339 |
| 6 | kenta-form-docs-1010 | fc2742626a9dd18a45359fd5e3512f035a63cb53 |
| 7 | kenta-qa-tooling-1010 | c09506b5091ed240a23c6ac6255aabbbf8f108f5 |

## 停止した枝と判断が必要な点

8本目 `codex/kenta-liffword-10092330` は merge を中止した。9〜12本目（tapextra・hqfeat・form-fixed・coupon-qr）は未着手。

`apps/liff/src/pages/Webinar.tsx` で次の意図が衝突する。

- 5本目の `77749d24f8` は、申込み・視聴・回答を Worker の `WebinarApp` にまとめ、旧URLも同じ本体を使う。
- 8本目は、従来の視聴画面を LIFF 共通の頭・ボタン・入力欄・文字数表示で整える。`Webinar.audit.test.tsx` に共通の頭、読み込み、再試行、画面タイトル、文字数表示の実挙動確認も追加する。
- 共通本体には8本目が要求するLIFF部品による表示がなく、一方のファイルを採用するだけでは両方の意図を維持できない。共通本体へV8表示を移すか、LIFF側の表示を残して申込み・回答を接続するかの判断が必要。

8本目の途中の変更はすべて取り消し、7本目までのクリーンな状態へ戻した。

## 競合解消と検証の範囲

- V8の数の帯、フォルダ色、共通日時表示を残し、共通入力・権限エラー・読み直し・確認窓の変更を併合した。
- 読み直しの案内の競合した試験は、共通の権限メッセージと再試行操作を両方確認する形で併合した。
- 書類添付の表示でも、住所・予約などの回答を共通の整形処理で表示するようにした。アップロード中の送信防止も残した。
- 併合時のタグ操作の構文重複・イベント識別子の重複を解消し、各取り込み後の型検査を再実行して合格した。
- worker・web の全試験、最終ビルド、scripts の型検査と全試験、CI Playwright は、全枝の取り込み前に停止したため未実施。試験全体の合格や見た目の合格は判定していない。

## マイグレーションと反映履歴

- 取得した `origin/codex/development` と公開中PRすべての変更パスを確認し、620〜624番の重複はなかった。一時的に取得に失敗したPRの差分も再取得して確認した。
- この途中状態には620・621・622番を取り込んだ。623・624番は未取り込み。番号変更・DB適用はしていない。
- `docs/release-log/unreleased/0000-kenta-train13.md` に取り込み済みの変更を記録した。`#0000` は司令塔の採番後に置換する。
- 再開時は最新の開発ブランチ・公開中PRの番号を再確認し、残りの取り込み後に全検証を行う。
