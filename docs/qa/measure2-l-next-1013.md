# L7 列車31の取り込みと次の仲間

開始HEAD `92d38f8d580c042128c0ca7f9818f420de93cf9b`、未コミット0。doctor合格、空き33GB。最新本線 `b56967dbb20156c56ee2c2c6b7f5e7f341f1d196`（列車31／#1724）。司令塔18:00の指示に従い両方の変更を保持してmerge commitへ。

## 競合の選択理由（7件）

- `shared/table.tsx`：選択の口selectionと余り幅のgrowは独立した役目なので、名前へselection・セルへgrowを両方渡す。
- `hq-banners/list.tsx`：一覧型と道具の骨格をL7の口で保ち、本線のSaveErrorFieldとListToolbarSortをtrailingへ渡す。ViewChipsのListToolbarRowは利用先を確認して残す。
- `hq-banners/list.module.css`：検索の独自幅と手書き道具は利用先0、共通ListToolbarを使うので戻さない。画像・内容の既存の配置は保持。
- `banner-search-row-contract.test.ts`：本線のU017実React描画を保持。プロジェクト検索と画像タブも描画で別に確かめる。説明Providerへ同じ利用者IDを渡す。
- `list-toolbar-readable.test.mjs`：L7の件数・画像枠の対照2件と本線のpickerの対照1件を全て残す。
- `Memory.md`：列車31の4記録とL7記録を全て保持し、進行中を同じ土台の証拠へ更新。
- `corrections.md`：両方の追記を保持し、競合を聞かず解く承認と続行方針を記録。

## 記録と検証

外部 `match2/L7/merge-*` に命令・結果を保存。変更前の全Web12971・102場面・25板左右50枚は旧92dの証拠として保持。新本線取り込み後の成功とは区別する。試験cwd引数の準備失敗と、描画見本/import不足の失敗ログも残す。上限・許可・見本データは増やさない。

次の仲間はL担当の「表＋右の欄」cdZBf・wxIQ7（同形4枚のうちhKr8f・UTbi1は担当外）。Gの47枚とFの領域へ画面の個別変更をしない。Pen・migration・push・PR・DB更新・配備は行わない。
