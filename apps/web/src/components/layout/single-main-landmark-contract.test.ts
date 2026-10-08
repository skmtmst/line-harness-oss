import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * ★V7（2026-09-24）：本文の目印（`<main>`）は共通の枠（app-shell の `#main-content`）に1つだけ置く。
 * 画面側でも `<main>` を書いていた30か所では、読み上げの「本文へ移動」が2つ出て、
 * どちらが本文か分からなかった。枠の外で描く画面（ログイン系・全体エラー・運営画面）だけ例外。
 */
const SRC = join(__dirname, '../..')
const ALLOWED = [
  'components/app-shell.tsx',
  'components/auth/auth-card.tsx',
  'components/ops/ops-shell.tsx',
  'app/global-error.tsx',
  /* V8 で枠の外に描く画面：運営の外枠・運営のログイン・招待・2要素認証の設定（app-shell が外枠を付けない道）。 */
  'v8/ops/shell.tsx',
  'v8/ops/login.tsx',
  'v8/ops/invite.tsx',
  'v8/ops/two-factor.tsx',
]
const ALLOWED_DIRS = ['app/login/', 'app/staff/invite/', 'app/staff/email-change/', 'app/visual-qa/', 'v8/login/']
/*
 * 監査 ROOT-23：V8 の画面は src/v8 に書く。app・components だけを見ると、
 * V8 の画面が <main> を書いても見張りに掛からない。v8 も同じく見る。
 */
const SCAN_DIRS = 'app components v8'

describe('本文の目印は1つだけ', () => {
  it('共通の枠の中で描く画面は <main> を書かない', () => {
    const files = execSync(`grep -rlE "<main[ >]" ${SCAN_DIRS} --include=*.tsx || true`, { cwd: SRC, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((f) => !/\.test\.|\.spec\./.test(f))
    const offenders = files.filter((f) => !ALLOWED.includes(f) && !ALLOWED_DIRS.some((d) => f.startsWith(d)))
    expect(offenders).toEqual([])
    expect(readFileSync(join(SRC, 'components/app-shell.tsx'), 'utf8')).toContain('id="main-content"')
  })
})
