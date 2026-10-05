# V8 の画面の型

対象は `[data-theme="v8"]`。外側の白い板・左メニュー・上の帯は AppShell が持つ。型は板の頭、段、列、余白を持ち、画面はデータ・権限・保存処理を持つ。共通部品は `components/shared` のものを使う。

| 型 | 用途・代表 | 内容を渡す props（ReactNode） |
|---|---|---|
| DashboardPage | ダッシュボード d8X09（載せ替え済み） | notice・stats・children・overlays。段は DashboardRow／DashboardColumns |
| ListPage | 表・カードの一覧。タグ I1E7Bt（載せ替え済み）、統括アカウント JKjsE | tabs・stats・folders・collapsedFolders・toolbar・children・pagination・overlays |
| CreatePage | 作成・編集・手順。一斉配信 iychL | steps・children・preview・previewToggle・footerActions・destructive・status |
| DetailPage | 詳細。友だち tBB0a | tabs・stats・summary・children |
| InboxPage | 受信箱 M0393 | heading（任意）・list・conversationHeader・children（会話）・composer・summary・summaryToggle |
| SettingsPage | 設定 R2ojn | navigation・children・saveActions・saveStatus |
| AnalyticsPage | 分析 bx1eN | period・stats・children・aside・asideToggle |

共通の頭は `title`（必須）・`description`・`help`（？の説明）・`identity`（顔など）・`actions`・`steps`。`boardId` は正本の板ID。`standalone` は確認ページのように外側の本文余白がない場所でだけ使う。既存の設定専用の外側（本文余白が0）を使う画面も `standalone` にする。

```tsx
import { ListPage } from '@/components/templates'

<ListPage title="テンプレート" description="配信に使う内容を管理します。"
  actions={<Button variant="primary" href="/templates/edit">作る</Button>}
  folders={<FolderPanel {...folderProps} />}
  collapsedFolders={<Select {...folderSelectProps} />}
  toolbar={<SearchField {...searchProps} />}
  pagination={<Pagination {...paginationProps} />}>
  <TemplateTable items={items} />
</ListPage>
```

- **型の外で白い箱、段の余白、列の幅を手書きしない。** `className` による外形の上書き口は設けていない。中身の表・グラフ・フォームの配置は内容側で持つ。
- 取得処理を持つ一覧の子は `ListPageBody` を使う。ページ送りの表示条件をその子が持つ場合は `ListPagePagination`。頭や白い板を重ねない。
- フォルダの列・右の欄は**白い板の幅1100px未満**で畳む。`collapsedFolders` と右欄を開く操作を必ず渡す。権限なし・閲覧のみは、広い／狭い両方の操作へ同じ条件を渡す。
- 作成の保存操作は下の `StickyBar` に一本化。設定の `saveActions` は変更がある間だけ渡す。状態管理・離脱確認・競合の再取得は画面が持つ。
- 作成の入力と見え方はそれぞれ縦に送る。型全体を横送りにしたり、子の画面で保存帯の高さを予約し直したりしない。
- 作成の見え方は幅380pxの欄の中で、区切り線と左右32pxの余白を除いた315pxへ入れる。送り幅が出ても中身の幅と中央位置を保つため、画面側で右欄の余白や送り幅を追加しない。
- 未取得の数を0にしない。空・読込・失敗・権限なしのときの本文とページ送りは画面が決める。
- V7 の画面は既存の描画を使う。V8 の型をV7へ適用しない。ログイン・LIFF・小窓・部品の説明板は7型の外側を直接適用する対象ではない。

正本：`design/v8/html/components-NbomF.html`・`components-x6BDY.html`・代表 d8X09／I1E7Bt。確認ページ（`/v8-templates?type=dashboard` など8例。`source=reference` で正本、`capture=1` で確認メニューを隠す）と測定記録（`design/v8/overlay/template-*`・`templates-*`・`design/v8/TEMPLATE-MAP.md`）は照合後に製品から外した。中身は正本から抽出した固定値で、実データを保存・送信しない。再現の道具は `scripts/v8-templates/` に残す。

画像比較を再現するには、`python3 scripts/v8-templates/generate-fixtures.py /abs/design/v8/html` → 本番ビルド（ローカルの画面確認用API）→ Browserスキルの `viewport.set({width:1440,height:1000})` → 通常の店舗選択 → `capture.mjs` の `captureTemplates` → `footer.mjs` の `checkFooters(tab, viewport, fs, base, "/tmp/v8-capture/footer-check.json")` → `python3 scripts/v8-templates/compare.py /tmp/v8-capture design/v8/overlay`。文字は灰色の塗りへ変え、段の矩形と同じ識別子を持つ容器の四辺も測る。Pencilの画面見本と同じ1440×1000で撮影し、寸法が違う画像は比較前に止める。司令塔2026-10-05 04時の決定に従い、確認ページで正本と差し込む中身の双方をborder-box（Pencilの幅は枠・余白込み）で描く。元のHTMLは変更しない。型別の画像は `template-<型>.png`、差は `template-<型>-diff.png`、数値は同名のJSON。数値の合格だけで、共通部品の見た目や操作まで合格にしない。測定の記録は製品から外し、結果のまとめは小分け2の `batch2.md`（司令塔の overlay）に残す。

幅の点検は同じBrowserで `responsive.mjs` の `probeTemplates(tab, viewport, fs, base, output)` を実行する。1152・1280・1440・1920pxで板と型の幅、1100px未満の列の折り畳み、保存帯、設定欄720pxを測る。`template-responsive.json` は高さ1000pxの32例、`template-responsive-900.json` は高さ900pxの32例で、いずれも合格。`probeTemplates` の最後の引数で高さを指定する（省略時1000px）。正本HTMLの中身のレスポンシブ対応と、各実画面の操作は各レーンで確認する。

15回目は7型・8例すべて合格（型レーンの記録。製品からは外した）。作成と設定は古い帯の絵を共通StickyBarの4幅×2高さの検査へ置き換える。重ね合わせから外す領域は各JSONの `excludedArea`、元の四辺と理由は `excludedMeasurements` に残す。保存帯の別検査が揃わないと比較も合格にしない。
