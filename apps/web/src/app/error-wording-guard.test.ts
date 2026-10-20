import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 禁止文言の全画面ガード（要件 管理画面-34 §10・§16）。
 *
 * 画面に出す字で「取得できません」を使わない。読めなかった失敗は
 * 対応表の文面と追跡番号で言う（§9）。
 *
 * 既存の持ち越しは KNOWN_FILES に残し、新規の混入だけをここで止める。
 * 直した画面は KNOWN_FILES から外す——残っている限り、この試験が
 * 「まだ直っていない画面」の一覧になる。
 */

const SRC = path.join(__dirname, '..')

/** 注釈を落とす。「なぜ直したか」を書いた文が、直したはずの字面に当たるのを避ける。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function collect(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      collect(full, found)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
      const source = fs.readFileSync(full, 'utf8')
      if (code(source).includes('取得できません')) found.push(path.relative(SRC, full))
    }
  }
  return found
}

/*
 * 「取得できません」が残っている画面。直したらここから外す。
 * ここに載っている = 未修正ということがこの試験で分かるようにする。
 */
const KNOWN_FILES: string[] = [
  'app/affiliates/affiliate-display.ts',
  'app/form-submissions/responses/response-summary.ts',
  'app/getting-started/getting-started-view.ts',
  'app/health/page.tsx',

  // page.tsx から分けた取り込み画面へ、管理画面 の持ち越し文が移った分。
  // 2026-10-04 完全切り替え：管理画面 page を捨て、V8 の list-v8 にしたので外す。
  // ★V8 版も同じ持ち越し文言を使う（直すときは page.tsx と一緒に直す）
  'components/scenarios/scenario-dialogs.tsx',
  'components/shared/list-kpis.tsx',
  'components/staff/login-audit.tsx',
  'lib/operation-status.ts',
]

describe('禁止文言「取得できません」', () => {
  it('KNOWN_FILES 以外に持ち込まない', () => {
    const known = new Set(KNOWN_FILES)
    const offenders = collect(SRC)
    const newlyIntroduced = offenders.filter((file) => !known.has(file))
    expect(
      newlyIntroduced,
      `新たに「取得できません」が入った: ${newlyIntroduced.join(', ')}。`
      + '対応表の文面と追跡番号で言ってください（要件 v6-34 §9-10）。',
    ).toEqual([])
  })

  it('直した画面は KNOWN_FILES から外す（一覧が残りの修正対象になる）', () => {
    const offenders = new Set(collect(SRC))
    const stale = KNOWN_FILES.filter((file) => !offenders.has(file))
    expect(
      stale,
      `もう直っているのに KNOWN_FILES に残っている: ${stale.join(', ')}。一覧から外してください。`,
    ).toEqual([])
  })
})
