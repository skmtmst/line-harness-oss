import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const fullSha = /^[0-9a-f]{40}$/

function requireSha(value, label) {
  if (!fullSha.test(value ?? '')) throw new Error(`${label}: 完全な公開SHAを確認できません。配備を停止します。`)
  return value
}

/** 両方の公開版を含む候補だけを許可する。時刻やSHAの大小で新旧を推測しない。 */
export function assertStagingForward(input, isAncestor) {
  const candidate = requireSha(input.candidate, '候補')
  if (candidate !== requireSha(input.development, '最新開発版')) {
    throw new Error('待機中に開発版が更新されました。最新統合版を検査し、dry-runから再申請してください。')
  }
  if (!['all', 'worker', 'admin'].includes(input.target)) throw new Error('配備対象が不正です。')
  for (const component of ['worker', 'admin']) {
    const live = requireSha(input.live[component], `公開中の${component}`)
    if (!isAncestor(live, candidate)) {
      throw new Error(`${component}: 公開版を含まない古い版・分岐版への配備を拒否しました。差分を統合して再検査してください。`)
    }
    if (input.target !== 'all' && input.target !== component) continue
    const source = requireSha(input.sources[component], `${component}の配備元`)
    if (input.replay[component]) {
      if (source !== live) throw new Error(`${component}: 設定再配備は現在の公開版と同じソースだけを使用できます。`)
    } else if (source !== candidate) {
      throw new Error(`${component}: 最新統合版以外のソースへ差し替えることはできません。`)
    }
  }
}

/** 認証情報を付けず、レスポンス本文を記録しない。取得失敗は許可へ倒さない。 */
export async function readStagingRevisions(fetcher = fetch) {
  const live = {}
  for (const [component, endpoint] of [
    ['worker', 'https://stg-api.musubo.jp/admin/version'],
    ['admin', 'https://stg-admin.musubo.jp/version.json'],
  ]) {
    const url = new URL(endpoint)
    url.searchParams.set('guard_at', String(Date.now()))
    const response = await fetcher(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`${component}: 公開版を取得できません（HTTP ${response.status}）。`)
    live[component] = requireSha((await response.json())?.git_commit, component)
  }
  return live
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function gitIsAncestor(ancestor, descendant) {
  try {
    git(['merge-base', '--is-ancestor', requireSha(ancestor, '公開版'), requireSha(descendant, '候補')])
    return true
  } catch (error) {
    if (error.status === 1) return false
    throw new Error('公開版のGit履歴を照合できません。履歴を取得してから再検査してください。')
  }
}

export async function verifyStagingForward(runtime = process.env) {
  if (runtime.GITHUB_ACTIONS !== 'true' || runtime.GITHUB_REF !== 'refs/heads/codex/development') {
    throw new Error('共有検証環境への配備は最新codex/developmentの共通Actionsからのみ実行できます。')
  }
  const candidate = requireSha(runtime.GITHUB_SHA, 'Actions候補')
  if (git(['rev-parse', 'HEAD']) !== candidate) throw new Error('候補と作業ツリーのHEADが一致しません。')
  const shallow = git(['rev-parse', '--is-shallow-repository']) === 'true'
  git(['fetch', '--no-tags', ...(shallow ? ['--unshallow'] : []), 'origin', 'codex/development'])
  const development = git(['ls-remote', '--exit-code', 'origin', 'refs/heads/codex/development']).split(/\s+/)[0]
  const live = await readStagingRevisions()
  assertStagingForward({
    candidate, development, live, target: runtime.DELIVERY_TARGET,
    replay: { worker: runtime.WORKER_CONFIG_REPLAY === 'true', admin: runtime.PAGES_CONFIG_REPLAY === 'true' },
    sources: {
      worker: runtime.WORKER_CONFIG_REPLAY === 'true' ? runtime.WORKER_SOURCE_SHA : candidate,
      admin: runtime.PAGES_CONFIG_REPLAY === 'true' ? runtime.PAGES_SOURCE_SHA : candidate,
    },
  }, gitIsAncestor)
  console.log(`巻き戻し防止確認済み: candidate=${candidate} Worker=${live.worker} Admin=${live.admin}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyStagingForward()
}
