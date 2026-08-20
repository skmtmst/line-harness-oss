# ローカルで管理画面を見る

**本番にも検証環境にも触らずに、管理画面の見た目と操作を確かめる手順。**

これまで「型検査と試験は通っているが、画面は誰も見ていない」状態が続いていた。
ログインが LINE 経由の2段階認証なので、ローカルでは通せないためだった。

**ログインの判定は `/api/auth/session` の応答だけを見ている。** そこだけ返す
小さなサーバーを置けば、画面は開く。データは空になるが、**配置・文言・
ボタンの有効無効・並べ替えなどの操作**は確かめられる。

## 手順

### 1. 空の返事を返すサーバーを置く

`stub-api.mjs` として、リポジトリの外（作業用の一時置き場）に作る。

```js
import { createServer } from 'node:http';
const PORT = Number(process.argv[2] || 8787);
const session = {
  success: true,
  csrfToken: 'dev',
  data: { name: '確認用', role: 'admin', permissionKeys: ['*'] },
};
createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3001');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/api/auth/session') { res.writeHead(200); return res.end(JSON.stringify(session)); }
  res.writeHead(200);
  res.end(JSON.stringify({ success: true, data: [] }));
}).listen(PORT);
```

```bash
node stub-api.mjs 8787
```

**8787 でなければならない。** 管理画面の既定の向き先がそこ。

### 2. 管理画面を立てる

```bash
npm run --prefix apps/web dev
```

`NEXT_PUBLIC_API_URL` が無いと 500 になる。`apps/web/.env.local` に書く
（`.gitignore` に入っているので、コミットされない）。

```
NEXT_PUBLIC_API_URL=http://localhost:8787
```

### 3. 開く

`http://localhost:3001/` はログイン画面。**判定が通れば、そのまま各画面へ行ける。**

## 何が確かめられて、何が確かめられないか

**確かめられる**

- 配置・文言・余白・色
- ボタンの有効無効（端のパネルで「←」が押せないか、など）
- 入力と、それに応じた画面の変化（並べ替え、複製、文字数の警告）
- 横スクロールが出ていないか（AGENTS.md の 1440px / 1920px の決まり）
- 読み込みに失敗したときの表示

**確かめられない**

- 一覧に中身が並んだときの見た目（返事が空なので0件になる）
- 保存が本当に通るか（サーバーが受け取らない）
- LINE への実際の送信

**空の返事は「読み込み失敗」として扱われることがある。** 実際、リマインダの
画面はこれで失敗の案内が出る。**その状態を見られるのは、むしろ好都合**で、
`#216` の「失敗しているのに『ありません』と出る」問題はこれで見つかった。

## 気をつけること

- **`preview_start` は主作業ディレクトリの `.claude/launch.json` を見る。**
  worktree で作業していると、**別の枝の中身が表示される**。起動したあと、
  ログの `> web@x.y.z dev /path/to/...` が自分の作業場所かを必ず見る
- スタブは**リポジトリの中に置かない**。置くと、本物の代わりに使われかねない
