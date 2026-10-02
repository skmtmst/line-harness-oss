import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 失敗の文は、立て直し方まで書く（★V7 修正方針 §5、2026-09-24 の点検・better-writing）。
 *
 * 「保存に失敗しました」だけでは、次に何をすればよいかが分からない。
 * 「保存に失敗しました。通信を確かめて、もう一度お試しください。」のように続ける。
 *
 * 状態を表す札・履歴の行（配信の結果、監査の記録など）は、利用者への指示ではないので除く。
 */

const SRC = join(__dirname, '..')

/** 札・履歴として「失敗しました」で終わってよい所。理由を書く。 */
const STATUS_LABELS: Record<string, string> = {
  'app/booking/bookings/new/page.tsx': '予約確認の送信結果の札',
  'app/tags/fields/migrate/page.tsx': '移行の状態の札',
  'app/automations/runs/page.tsx': '実行履歴の状態の札',
  'app/analytics/page.tsx': '数字の枠の状態（狭い枠に出す）',
  'components/staff/login-audit.tsx': 'ログイン記録の1行',
}

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.tsx?$/.test(name) && !name.includes('.test.')) out.push(path)
  }
  return out
}

describe('失敗の文に立て直し方がある', () => {
  it('「〜失敗しました」で終わる文を画面に出さない（札・履歴を除く）', () => {
    const hits = sources(SRC).flatMap((path) => {
      const file = relative(SRC, path).split('\\').join('/')
      if (STATUS_LABELS[file]) return []
      return (readFileSync(path, 'utf8').match(/['"][^'"`\n]{0,40}失敗しました['"]/g) ?? []).map((m) => `${file}: ${m}`)
    })
    expect(hits, '「。通信を確かめて、もう一度お試しください。」などを続けてください').toEqual([])
  })

  it('例外の札は、いまもその文を持っている（直したら表から消す）', () => {
    for (const file of Object.keys(STATUS_LABELS)) {
      expect(readFileSync(join(SRC, file), 'utf8'), file).toMatch(/['"][^'"`\n]{0,40}失敗しました['"]/)
    }
  })
})
