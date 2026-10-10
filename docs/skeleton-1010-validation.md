# B-178 一覧の骨組みと7部品（skeleton）

実装とCIはコミット済み。見た目の合格は保留です。push・PR作成・D1更新・配備は実行していません。

作業場所：`~/lh-work/lh-pages-skeleton`。ブランチ：`codex/kenta-skeleton-1010`。
開始前の `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh` は「合格」。
先に `codex/kenta-listrow-1010`（`b15608c8da`）を取り込み、共同更新 `origin/codex/development`（`9da94f6fe717f84464b7ca055a0d9eedceb34ae9`）も取り込んでから検証しました。
最終のコードの版は `478d4396487d856e46471df40630bf5c2028988c`。この記録の追加でアプリのコードは変えていません。

31板は29URLです。27URLは表、2URL（画像生成のプロジェクト・登録メディア）は元のカード一覧を保っています。
一覧の共通の枠を使い、表の見出し40px・行60px、数の帯116px、検索幅240px、セルの左右16pxを部品が持ちます。
名前は丸と1行、フォルダは白い板が1100px未満なら畳み、ページ送りは右に寄せます。

| 7部品 | 持ち主 |
|---|---|
| 数の帯 | KpiBand |
| 表の行 | DataTable / GridTable |
| 道具の段 | ListToolbar とその段・検索・右端の口 |
| フォルダの列 | ListPageBody / FolderPanel |
| 画像の枠 | ImageFrame（画像の取り込みはMediaSlot） |
| 下の帯 | StickyBar |
| 〇〇したときにすること | shared/action-rows（旧名は互換の入口） |

検索の待ち時間、条件のURL保存、並び順、確認の窓、権限、送信後の処理、画像の容量制限は共同更新の動きを保ちました。
文字リンクは緑、フォーカスと案内の印は別の青のトークンに分けています。
会員一覧の独自の表は検査から漏れていたため、共通の格子の表へ移しました。CIは表の見出し・行が検査できていない場合も失敗にします。

| 検証 | 結果 |
|---|---|
| 共通部品・型・NEN一覧 | 233ファイル・1,425件 合格 |
| 一覧・編集・フォーム・自動応答ほか | 396ファイル・2,061件 合格 |
| 会員の共通表への移行後 | 関連5ファイル・44件 合格 |
| 型検査 | 合格 |
| ビルド | 合格（lint警告は残る） |
| 部品の設計値 | 450項目一致・不一致0 |
| 一覧の行のソース検査 | 合格 |
| 強化した実ブラウザ検査 | 93ケース・崩れ0（1152/1440/1920） |
| わざと入れた崩れ | 10種類すべて検出 |
| 会員の検査範囲 | 各幅で見出し1・行10を実測 |
| 差分検査 | 合格 |

試験数は範囲が重なります。足して固有の試験数とはしません。
実ブラウザの93ケースは29一覧URL×3幅＋画像・下の帯・処理の2画面×3幅です。
検査の入口は `apps/web/scripts/v8-guard/list-skeleton-audit.mjs`、一覧の登録は `apps/web/design/list-skeleton.json`。
Required PR Gateで実行します。カード一覧にも数の帯・道具・フォルダ・はみ出しの検査はかかります。

検証ログは `/tmp/skeleton-tests-merged2.log`、`/tmp/skeleton-related-final.log`、`/tmp/skeleton-grid-tests.log`、`/tmp/skeleton-grid-type.log`、`/tmp/skeleton-grid-build.log`、`/tmp/skeleton-grid-design.log`。
実ブラウザの結果は `/tmp/skeleton-runtime-coverage.json`。1152の31枚の記録は `~/lh-work/design/v8/overlay/pages-skeleton/narrow-captures.json`。

画像の場所は `~/lh-work/design/v8/overlay/pages-skeleton/`。
1440の重ね画像は `<板ID>-overlay.png`。対応する1152のPenがあるものは下の1152板IDの同名画像。
31板すべての1152実装画像は `<1440板ID>-1152-impl.png`。

| 1440板 | URL | 1152の参照板 |
|---|---|---|
| nF4ts | `/friends` | 対応表に未登録 |
| l5V9a | `/broadcasts` | jjFNi |
| U4Eep0 | `/hq/broadcasts` | 対応表に未登録 |
| Z3FoM | `/restaurant-test/reservations?view=list` | 対応表に未登録 |
| LRc93 | `/hq/templates` | 対応表に未登録 |
| wTIej | `/nen/pets` | t2SMXX |
| I1E7Bt | `/tags` | aPeD8 |
| noVq4 | `/hq/rich-menus` | 対応表に未登録 |
| UyUMw | `/webinars` | uBMuB |
| B9ZAr | `/hq/banners` | 対応表に未登録 |
| Jxmqh | `/nen-campaigns?tab=columns` | 対応表に未登録 |
| MuhWR | `/nen-campaigns` | 対応表に未登録 |
| AOWoJ | `/nen/members` | 対応表に未登録 |
| MRhef | `/friend-add-settings` | P20kYU |
| rZEGN | `/rich-menus` | Y9ASp |
| LWQXd | `/automations` | En14p |
| O7hUt7 | `/contents` | 対応表に未登録 |
| xbHxg | `/inflow-links` | y1ztx |
| mIwA4 | `/nen/health` | 対応表に未登録 |
| wZPua | `/hq/form-submissions` | 対応表に未登録 |
| ZSbFY | `/webhooks` | AsfFB |
| uE9gf | `/auto-replies` | WPrd5 |
| FM94M | `/contents/vars` | XIzkJ |
| I3L41O | `/form-submissions` | GrnO4 |
| i0Ao0R | `/hq/templates` | 対応表に未登録 |
| JXq9G | `/conversions` | UUQ7T |
| r6dJFy | `/conversions` | UUQ7T |
| e2ekFu | `/events` | 対応表に未登録 |
| apLqS | `/reminders` | Iffil |
| axFrW | `/scenarios` | wjfLe |
| v19Ivv | `/templates` | L7zA7C |

追加で画像・下の帯・処理を使う9板も測定対象にしました：J60utH、S6FEuB、tpRRT、m1cWEy、ITBAB、b8xBtZ、OhguS、T1j2Sw、rfhIf。

`measure.sh skeleton <板ID>` で57板の比較を実行しました（コード `69ac5aad5c`、未取得0）。代表のテンプレートの文字位置一致は1440が5%、1152が2%で、90%に達していません。重ね画像もずれているため合格とはしません。

会員の共通表への移行後の最終版 `478d439648` は、共有撮影枠3つが他の生きたプロセスで使用中のため再測定を開始できませんでした。待っても空かなかったため、自分の待機だけを停止しました。他者の枠・プロセスは変更していません。
現在のPen重ね画像は修正前 `69ac5aad5c` の参考記録です。最終版の見た目の証拠として数えません。
最終版の1152実装画像31枚は撮影でき、表27URLとカード2URLを含め、はみ出し・行高などの検査は0件でした。

代表画像：`v19Ivv-overlay.png`（1440・参考）、`L7zA7C-overlay.png`（1152・参考）、`AOWoJ-1152-impl.png`（最終版の会員一覧・1152）。
1152の測定ツールの「幅違い（原寸）」は比較用キャンバス1440と参照板1152の差です。実装の撮影幅はJSONの `shotWidth: 1152` で確認しています。

確認用サーバーと見本APIを停止しました。自分のPlaywrightも終了しています。作業ツリーはこの記録をコミットしてクリーンにします。

今の進捗を全体像から整理するとこれ：31一覧・7部品の実装とCIは整いました。崩れの検査は0ですが、Penの文字位置90%と司令塔の目視による見た目の合格はまだです。
次のタスクはこれ：対応表にない1152参照14板をそろえ、CODEX-NEXT-1010の「見た目合わせ」の段階で位置のずれを直し、90%＋崩れ0を再測定して司令塔が確認すること。

更新履歴は `docs/release-log/drafts/kenta-skeleton-1010.md` に用意済みです。司令塔がPRを採番したら、実番号を付けて `unreleased/<PR番号>-kenta-skeleton.md` へ移します。
