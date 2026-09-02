# Codex クラウド開発環境

## 目的

Codex がクラウド上でコードの調査・実装・検査を安全に行えるよう、通信先と資格情報の境界を明確にします。

## 許可する通信先

- GitHub
- npm registry

Cloudflare API への通信は許可しません。Codex クラウド環境から Cloudflare API へ到達できる場合は、作業を開始せず設定を確認してください。

## 資格情報の原則

Codex クラウド環境に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を設定してはいけません。Cloudflare の資格情報は、Worker だけでなくアカウント全体の設定やデータに影響し得るためです。

検証環境への配備、D1 操作、Cloudflare 設定の変更は GitHub Actions 内で実行します。Codex はコードと Pull Request を準備し、認可済みのワークフローに実行を引き渡します。

`.env` や `.dev.vars` は読み込まず、作成もしません。診断時は環境変数の名前と設定の有無だけを確認し、値は表示しません。

## 作業前の診断

リポジトリのルートで次を実行します。

```bash
bash scripts/codex/doctor.sh
```

## 手元のPCで走らせるとき

Cloudflare への到達検査は、**Codex クラウド環境の境界**を見るものです。
手元のPCからは普通につながるので、そのまま走らせると必ず「要確認」になります。
その場合だけ、外すことを明示して実行します。

```bash
DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh
```

**既定は検査したままです。** 逆（クラウドのときだけ検査する）にすると、
クラウド側で付け忘れたときに境界の検査が黙って飛びます。付け忘れても
検査が残る側に倒しています。外したときは「判定なし」と必ず表示します。

`CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` の検査は、
**`DOCTOR_LOCAL=1` でも常に走ります。** GitHub と npm registry への到達検査も
同じで、どちらかへ到達できないときは合格になりません。

最終行が `合格` のときだけ作業を開始します。`要確認：〜` の場合は、表示された理由を報告し、環境の設定が修正されるまで作業を開始しません。
