# L2x：下読み15の最新版本線での撮り直し

## 範囲と取り込み

司令塔14:10の指示により、下読み15の17板だけを撮り直す。追加の画面修正はしない。元85＋追加27の全数と予想13/14/15の採点は、今回は更新しない。

- 開始HEAD：0d818407b2。クリーン、doctor合格、pnpm install成功。空き66GiB。
- 取り込み元：origin/codex/development 7a910b56cf6c15d43e5dfb955d462834ab5da3b0。
- Git共有置き場が浅い履歴で本線を根として扱い、最初のmergeが拒否された。`git fetch --deepen=100 origin codex/development`で履歴を補い、共通祖先e0b86e4588を確認した。無関係な履歴の強制合流、rebase、force、stashは行わない。
- 今回の競合はMemory/correctionsの2本。両側の追記を残し、前回の停止を履歴として扱い、現在の撮り直し方針を追記。
- 流入リンクの新フォルダ窓接続・描画試験は自動併合で本線と同一。予約設定の分割と、JSTの今日から14日間を使うpreviewRangeは既存settings-partsに保持。予約設定は今回の本線でe0からの変更がない。
- 件数/ページ送り/説明の既存コミット840ea5551b・eafa6a6d4aを保持。
- 本線が文書整理で削除した文書と反映履歴は、本線取り込みの差分。こちらで追加削除はしていない。

## 撮り直す17板

Q5lOCc・X0QrW0・PftqN・OylSV・R8tlbw・Eo56k・h7dmB・DrwMm・PZBVb・BygrU・S35pO・W5Wxr・WPrd5・WSGvo・fmToi・wjfLe・y2n1z。

下読み15の集合を現在の合格台帳の最終行と照合し、未合格17を確認。元85の修正前機械0=51/初回0=42、追加27の修正前機械0=7/初回0=7は前回記録であり、現在の結果と呼ばない。

## 検証

全Webはheavy経由・4並列で2199ファイル/13108件成功（skip1/todo1）、終了0。型検査成功、変更箇所lintエラー0/既存警告25、設計値124/124一致・未許可0、差分検査成功。続いてコミットした同版の本番形式ビルド、fresh-check、17板×3幅の数、左右34枚、鍵を確かめる。追加修正せず残差を返す。

検証の入口はブラウザスキルを読み、Chrome接続を確認。板ごとの権限/API/選択状態は指定の既存撮影道具を使う（操作の事実を記録）。その道具の元コードや見張りの上限/許可は変更しない。

外部記録：`~/lh-work/design/v8/review/MATCH-ANALYSIS-1011/measure2/match2/L2x/resume-1410/`。START、AUTO-MERGE-PROOF、REFERENCE-BEFORE、requested-cases、試験ログを保持。追加実装0、Pen・合格台帳・親EC・DB・migration・配備・push・PR変更なし。
