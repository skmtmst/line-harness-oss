# Codex クラウド開発環境

## 目的

Codex がクラウド上でコードの調査・実装・検査を安全に行えるよう、通信先と資格情報の境界を明確にします。

## 診断時に許可する通信先

- GitHub API
- npm registry
- Cloudflare API の認証なし確認用 URL

Cloudflare API への通信は、接続できるかを調べる診断だけに使います。診断は認証なしで行い、配備、D1操作、設定変更などのCloudflare実操作は行いません。

Cloudflare APIの結果が`HTTP 404`などのHTTP応答なら、確認用URLまで通信できたため「到達成功」です。`HTTP 000`または`curl`の失敗は「到達不可」であり、作業を開始できません。

## 資格情報の原則

Codexの実行環境に、次のCloudflare資格情報を設定してはいけません。Cloudflareの資格情報は、Workerだけでなくアカウント全体の設定やデータに影響し得るためです。

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_WORKERS_API_TOKEN`
- `CLOUDFLARE_PAGES_API_TOKEN`
- `CF_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CF_ACCOUNT_ID`

診断では、最初にこれらのローカル環境変数が設定されているかを確認します。1つでも設定されていれば、値を表示せず「要確認」とし、GitHub側の照合へ進みません。

ローカルに設定がない場合だけ、GitHubリポジトリの`staging` Environmentに登録されたsecretの**名前だけ**を取得します。次の3つの役割がすべてそろっていることを確認します。

- Worker用token：`CLOUDFLARE_WORKERS_API_TOKEN`または`CF_API_TOKEN`
- Pages用token：`CLOUDFLARE_PAGES_API_TOKEN`または`CF_API_TOKEN`
- Account ID：`CLOUDFLARE_ACCOUNT_ID`または`CF_ACCOUNT_ID`

secretの値は取得・表示・保存せず、変更もしません。GitHub CLIが未認証の場合、名前の一覧を取得できない場合、必要な役割が不足している場合は「要確認」です。

検証環境への配備、D1 操作、Cloudflare 設定の変更は GitHub Actions 内で実行します。Codex はコードと Pull Request を準備し、認可済みのワークフローに実行を引き渡します。

`.env` や `.dev.vars` は読み込まず、作成もしません。診断時は環境変数の名前と設定の有無だけを確認し、値は表示しません。

## 作業前の診断

リポジトリのルートで次を実行します。

```bash
bash scripts/codex/doctor.sh
```

## 手元のPCで走らせるとき

Cloudflareへの到達検査は、**Codexクラウド環境で検証反映に必要な通信ができるか**を見るものです。手元のPCでは、この到達検査だけを外すことを明示して実行します。

```bash
DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh
```

**既定は検査したままです。** 逆（クラウドのときだけ検査する）にすると、
クラウド側で付け忘れたときに到達検査が黙って飛びます。付け忘れても
検査が残る側に倒しています。外したときは「判定なし」と必ず表示します。

`DOCTOR_LOCAL=1`で外れるのはCloudflare APIへの到達検査だけです。6つのローカル環境変数の検査と、ローカルに設定がない場合のGitHub `staging` Environmentのsecret名照合は常に行います。GitHub APIとnpm registryへの到達検査も外れません。

最終行が `合格` のときだけ作業を開始します。`要確認：〜` の場合は、表示された理由を報告し、環境の設定が修正されるまで作業を開始しません。
