import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

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
const SCAN_DIRS = ['app', 'components', 'v8']

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : /\.tsx$/.test(name) && !/\.(test|spec)\./.test(name) ? [path] : []
  })
}

export function mainLandmarkOffenders(src) {
  return SCAN_DIRS.flatMap(dir => walk(join(src, dir)))
    .filter(path => /<main(?:\s|>)/.test(readFileSync(path, 'utf8')))
    .map(path => relative(src, path))
    .filter(path => !ALLOWED.includes(path) && !ALLOWED_DIRS.some(dir => path.startsWith(dir)))
    .sort()
}
