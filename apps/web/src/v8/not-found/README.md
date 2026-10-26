> 文書：ページが見つからないときのコード案内｜区分：今の説明｜最終確認：2026-10-26（日本時間）

# ページが見つからないとき

Nextの特別な入口 [app/not-found.tsx](../../app/not-found.tsx) → [本体](not-found.tsx) → [同所の操作試験](not-found.test.tsx) の順に追います。通常のpage.tsxを持つURLではありません。

## 外に見せる名前（index.ts）

[index.ts](index.ts) は `NotFoundV8` を明示exportします。Nextの入口は本体へ直接接続します。機能外の利用は公開indexから、内部は宣言元から読みます。[構成の決まり](../../../../../docs/code-structure.md)を参照してください。

API・保存処理はありません。戻る操作は履歴がある場合に前のページへ、ない場合にダッシュボードへ進みます。開けなかった道はクエリと # を除いて小さく出し、よく使うページ（受信箱・友だち・一斉配信）を文字リンクで出します。一斉配信は左メニューと同じく、任された担当者には権限があるときだけ出します（[決め方](frequent-destinations.ts)）。ログインしていない時は外枠の認証の確かめがログインへ送ります。描画は [CSS Modules](not-found.module.css) と共通Buttonを使います。見た目の決まりは [V8](../../../../../docs/v8-design-rules.md) を読みます。

試験：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web test -- src/v8/not-found`。文書の参照が正しいことと、画面の操作・見た目が合格したことを分けて扱います。
