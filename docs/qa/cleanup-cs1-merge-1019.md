# CS1：まとめ枝の再取り込み（2026-10-19）

開始HEADは `1ec0c099d669d0d2131f2c0499144c256befb617`。
進行中だったまとめ枝 `684142dea6a9489b56cb24016ab48382f29ada8b` のmergeを継続した。
両枝の共通祖先は `7b42fc5e444f8a4f6641c9d2308a9671269ad4b2`。
doctor LOCALと親ECのcleanを確認し、親ECは変更していない。

## 両方を残した意味

- 競合した `liff-oauth-config-handlers.ts` は、CS1のcookie・署名・店境界のimportと、まとめ枝の業種解決のimportをすべて保持。
- `/api/liff/config` の署名検証済み `redirectTarget` と、選択済み業種の `style`・`Cache-Control: no-store` を併用。外部転送の許可先追加はない。
- 自動統合された `line-accounts.ts` も両親と比較し、LIFF IDの安全検査と、業種の保存・途中失敗から同じアカウントで再開する動きを保持。
- 既存のF4/F25試験を、同じ実D1/HTTP応答で署名済み行先・業種・秘密の非公開・キャッシュ抑止を確かめる形へ補強。改ざん行先は業種を保ったまま拒否する。
- S03のエラー応答の形式・文言・追跡番号は変更しない。CS1固有の画面・CSS変更はない。

前回CS1の123パスのうち119は開始時と同一。差があるのは上記2つの実装、回帰試験、反映履歴の4パス。
F1〜F32の修正と32件の故障対照は既存コミットと外部DONE-CS1.tsvに残し、済んだ実装をやり直していない。
PLAN-COVERAGEのprimaryBundleとLONG-FILESのbundleがCS1の行はいずれも0。

## 検査結果

コミット前の手元検査（Node 26.0.0）：関連3ファイル54件、LINEアカウント93件が成功。
業種情報を落とす故障と転送先の検証を外す故障は、ともにAssertionErrorで検出し、元のsource hashへ復元後にnavigation全6件が成功。
Workerの型検査・本番形式ビルド・差分検査が終了0。生成されたDBのbootstrapに追加差分はない。

初回は手元のSQLite部品（Node 26用）とNode 22のABIが一致せず、pretestで停止した。
その実行を試験成功に数えず原ログを保存し、手元の依存を入れ替えずNode 26で再検査した。
ci-localでは新品のworktreeへNode 22用依存を入れるため、手元のnative部品を流用しない。

最終のci-localと同一生成物による撮影の結果は、外部のDONE-CS1.tsv・CS1-HANDOFF.mdと
`CS1-EVIDENCE/merge-1019/` のmanifest/results・撮影結果に記録する。
この文書のコミットに対してci-localを実行し、正式PR情報不足の未実行と技術検査の失敗を区別する。
#0000を正式PRの情報へ偽装しない。集約ゲートが通るまで総合合格とは扱わない。

## 安全に残す工程

push・PR・DB適用・配備・実送信・実決済・外部への書込みは実施しない。
CS1独自のmigration作成は0で番号案も不要。まとめ枝に含まれる承認済み6本は元の内容をそのまま取り込むだけで適用しない。
正式PR番号は司令塔が採番し、指定の#0000履歴を更新して正式ゲートを実行する。
過去の帰属不明データの推測修復、署名のない古い外部リンクの復活、本人確認なしの紐付けは行わない。

外部証拠：`~/lh-work/design/v8/review/CLEANUP-1017/CS1-EVIDENCE/merge-1019/`。
