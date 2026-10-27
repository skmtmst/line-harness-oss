import {readdirSync, statSync} from 'node:fs'
import { readUiSource as readFileSync } from '../../scripts/test-ui-source.mjs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 失敗の文は、立て直し方まで書く（★管理画面 修正方針 §5、2026-09-24 の点検・better-writing）。
 *
 * 「保存に失敗しました」だけでは、次に何をすればよいかが分からない。
 * 「保存に失敗しました。通信を確かめて、もう一度お試しください。」のように続ける。
 *
 * 状態を表す札・履歴の行（配信の結果、監査の記録など）は、利用者への指示ではないので除く。
 */

const SRC = join(__dirname, '..')

/**
 * 札・履歴として「失敗しました」で終わってよい文。ファイルごと外さず、その文だけを許す
 * （同じファイルに足した利用者向けの文は見逃さない）。札として出ることは描画の試験が見る：
 * - 予約確認の送信結果の札：app/booking/bookings/new/page-instant.test.tsx
 * - ログイン記録の1行：app/error-copy-status-labels-react.test.tsx
 */
const STATUS_LABELS: Record<string, string[]> = {
  'app/booking/bookings/new/page.tsx': ["'送信に失敗しました'"],
  'components/staff/login-audit.tsx': ["'ログインに失敗しました'"],
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
      const allowed = STATUS_LABELS[file] ?? []
      return (readFileSync(path, 'utf8').match(/['"][^'"`\n]{0,40}失敗しました['"]/g) ?? [])
        .filter((m) => !allowed.includes(m))
        .map((m) => `${file}: ${m}`)
    })
    expect(hits, '「。通信を確かめて、もう一度お試しください。」などを続けてください').toEqual([])
  })

})
