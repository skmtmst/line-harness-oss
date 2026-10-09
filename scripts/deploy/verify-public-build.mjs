import { pathToFileURL } from 'node:url'

export function assertPublicBuild(body, expectedSha, label) {
  if (!/^[0-9a-f]{40}$/.test(expectedSha)) throw new Error(`${label}: 照合するSHAは40桁で指定してください`)
  if (body?.git_commit !== expectedSha) throw new Error(`${label}: 公開中のSHAが一致しません（不明・短縮SHAも不可）`)
}

/** 秘密値・Cookieを送らず、返ってきた本文もログへ流さない。 */
export async function verifyPublicBuild(workerUrl, workerSha, adminUrl, adminSha, fetcher = fetch) {
  const checks = []
  if (workerUrl !== '-') {
    checks.push([workerUrl, '/admin/version', workerSha, false], [workerUrl, '/api/health', workerSha, true])
  }
  if (adminUrl !== '-') checks.push([adminUrl, '/version.json', adminSha, false])
  if (!checks.length) throw new Error('照合する公開URLを指定してください')
  for (const [base, path, sha, wrapped] of checks) {
    const url = new URL(path, base)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('公開URLが不正です')
    url.searchParams.set('verify_sha', sha)
    url.searchParams.set('verify_at', String(Date.now()))
    const response = await fetcher(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
    const body = await response.json()
    if (wrapped && (body?.success !== true || body?.data?.status !== 'ok')) throw new Error(`${path}: health が正常ではありません`)
    assertPublicBuild(wrapped ? body?.data : body, sha, path)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  if (args.length !== 4) throw new Error('使い方: verify-public-build.mjs <Worker URL|-> <Worker SHA> <Admin URL|-> <Admin SHA>')
  // CDNの反映待ちだけを読み取りで再試行する。配備し直さない。
  for (let attempt = 1; ; attempt++) {
    try {
      await verifyPublicBuild(...args)
      console.log(`公開SHA一致: Worker=${args[0] === '-' ? '対象外' : args[1]} Admin=${args[2] === '-' ? '対象外' : args[3]}`)
      break
    } catch (error) {
      if (attempt >= 15) throw error
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
}
