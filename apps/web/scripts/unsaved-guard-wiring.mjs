import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readUiSource } from './test-ui-source.mjs'

/*
 * 未保存の離脱確認の「配線」の点検（DETAIL-04系）。見た目の固定ではなく、番兵（共通フック＋離脱確認ダイアログ）が
 * その画面から届く場所にあるかだけを見る。結果は「足りない画面の一覧」で返し、空であることを試験が求める。
 */

/** 画面の守りを共有フック（同じフォルダの use-*.ts）や共通の離脱部品へ寄せた画面は、それも合わせて1つの画面として読む。 */
export function screenSources(srcRoot, file) {
  const dir = dirname(join(srcRoot, file))
  const hooks = readdirSync(dir)
    .filter((name) => /^use-[^/]+\.ts$/.test(name) && !name.includes('.test.'))
    .map((name) => readFileSync(join(dir, name), 'utf8'))
  const own = readUiSource(join(srcRoot, file), 'utf8')
  const commonGuard = own.includes('FormLeaveGuard') ? readFileSync(join(srcRoot, 'components/shared/form-leave-guard.tsx'), 'utf8') : ''
  return [own, commonGuard, ...hooks].join('\n')
}

/** 番兵の分類に入れた画面のうち、共通フックか離脱確認ダイアログが届かない物。 */
export function screensWithoutLeaveGuard(srcRoot, files) {
  return files.flatMap((file) => {
    const source = screenSources(srcRoot, file)
    return [
      ...(source.includes('useUnsavedGuard(') ? [] : [`${file}: 共通フック useUnsavedGuard が見つかりません`]),
      ...(source.includes('leaveTarget !== null') ? [] : [`${file}: 離脱確認ダイアログが見つかりません`]),
    ]
  })
}
