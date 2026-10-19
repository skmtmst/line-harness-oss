import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { musuboWebhookUrl } from './logic'

/*
 * ②アカウント接続 Step2 の「musubo の Webhook URL」は、利用者が LINE 側へ貼る字。
 * 貼った先を正しいと判定するのは Worker なので、画面に出す字と Worker が正とする字が
 * ずれると「貼ったのに接続チェックが通らない」になる。
 *
 * 画面は `NEXT_PUBLIC_API_URL` から字を作り（logic.ts の musuboWebhookUrl）、
 * Worker は `WORKER_PUBLIC_URL` から作る（apps/worker の expectedWebhookUrl）。
 * この2つが同じ値から来ていることを、設定ファイルの実値で固定する。
 *
 * 経緯：検証環境の字を `nen-line-stg.skmtmst.workers.dev/webhook` と取り違えた。
 * その値は release.yml / required-pr-gate.yml の「外部へは出ない試験用」の値で、
 * 検証環境の配備が焼き込む値ではない。
 */

const STAGING_WRANGLER = readFileSync(
  new URL('../../../../worker/wrangler.staging.toml', import.meta.url),
  'utf8',
)
const STAGING_WORKFLOW = readFileSync(
  new URL('../../../../../.github/workflows/deploy-cloudflare-staging.yml', import.meta.url),
  'utf8',
)

function tomlVar(source: string, key: string): string | undefined {
  return source.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'))?.[1]
}

describe('②Step2 の Webhook URL は Worker が正とする元から作る', () => {
  it('検証環境の Worker の正の元は custom domain（workers.dev は別名）', () => {
    expect(tomlVar(STAGING_WRANGLER, 'WORKER_PUBLIC_URL')).toBe('https://stg-api.musubo.jp')
    expect(tomlVar(STAGING_WRANGLER, 'WORKER_URL')).toBe('https://stg-api.musubo.jp')
    // 別名も同じ Worker に届くので、こちらで登録されていても不一致にしない。
    expect(tomlVar(STAGING_WRANGLER, 'WORKER_ALIAS_URLS')).toContain(
      'https://nen-line-stg.skmtmst.workers.dev',
    )
  })

  it('検証環境の配備が web に焼き込む API の元が、Worker の正の元と同じ', () => {
    const stagingApiUrl = STAGING_WORKFLOW.match(/^\s*STAGING_API_URL:\s*(\S+)/m)?.[1]
    expect(stagingApiUrl).toBe(tomlVar(STAGING_WRANGLER, 'WORKER_PUBLIC_URL'))
    // web の build 工程はこの env を通して渡す（直書きしない）。
    expect(STAGING_WORKFLOW).toContain('NEXT_PUBLIC_API_URL: ${{ env.STAGING_API_URL }}')
  })

  it('画面に出す字は <APIの元>/webhook', () => {
    const base = tomlVar(STAGING_WRANGLER, 'WORKER_PUBLIC_URL') as string
    const previous = process.env.NEXT_PUBLIC_API_URL
    try {
      process.env.NEXT_PUBLIC_API_URL = base
      expect(musuboWebhookUrl()).toBe(`${base}/webhook`)
      // 末尾の / があっても二重にしない。
      process.env.NEXT_PUBLIC_API_URL = `${base}/`
      expect(musuboWebhookUrl()).toBe(`${base}/webhook`)
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_API_URL
      else process.env.NEXT_PUBLIC_API_URL = previous
    }
  })

  it('元が未設定なら字を作らない（画面側で「不明」を出す）', () => {
    const previous = process.env.NEXT_PUBLIC_API_URL
    try {
      delete process.env.NEXT_PUBLIC_API_URL
      expect(musuboWebhookUrl()).toBe('')
    } finally {
      if (previous !== undefined) process.env.NEXT_PUBLIC_API_URL = previous
    }
  })
})
