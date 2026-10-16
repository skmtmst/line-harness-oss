import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
// @ts-expect-error 監査の本体はJS。
import { run, loadCatalog, scanCodeFile } from './v8-pattern-audit.mjs'
const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pattern-semantic-')); roots.push(root)
  const put = (file: string, source: string) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source) }
  return { root, put }
}
it('読むだけの動作説明と表見出しを編集欄と区別し、本物の編集欄は検出する', () => {
  const { root, put } = fixture()
  put('apps/web/src/components/shared/grid-table.tsx', 'export function GridCell() { return null }')
  put('apps/web/src/components/shared/help-tip.tsx', 'export default function HelpTip() { return null }')
  const pattern = loadCatalog().patterns.find((p: { id: string }) => p.id === 'tap-action')
  const scan = (jsx: string) => scanCodeFile(pattern, 'apps/web/src/v8/demo.tsx', `import HelpTip from '@/components/shared/help-tip'; import { GridCell } from '@/components/shared/grid-table'; export const Page=()=>(${jsx})`, {}, root)
  expect(scan('<p>押したら何が開くかを出します</p>')).toHaveLength(0)
  expect(scan('<HelpTip label="説明">押したら何が開くか</HelpTip>')).toHaveLength(0)
  expect(scan('<GridCell role="columnheader">押したら</GridCell>')).toHaveLength(0)
  expect(scan('<label>押したら<select><option>URL</option></select></label>')).not.toHaveLength(0)
  expect(scan('<p>押したら<select><option>URL</option></select></p>')).not.toHaveLength(0)
  expect(scan('<label><span>押したら</span><select /></label>')).not.toHaveLength(0)
  expect(scan('<OwnField label="押したら" />')).not.toHaveLength(0)
})
it('座標で重ねる非操作の領域線を取込欄と区別し、本物の点線の取込は検出する', () => {
  const { root, put } = fixture()
  const path = 'apps/web/src/v8/demo.tsx'
  put('apps/web/src/v8/demo.module.css', '.area { position: absolute; border: 1px dashed var(--color-ink); }')
  const scan = (jsx: string) => {
    put(path, `import styles from './demo.module.css'; export const Page=()=>(${jsx})`)
    return run({ code: root }).code.a['media-slot']
  }
  expect(scan('<div aria-hidden="true"><span className={styles.area} style={{left: "0%", top: "0%", width: "50%", height: "50%"}}>A</span></div>')).toHaveLength(0)
  expect(scan('<button className={styles.area}>画像を追加</button>')).not.toHaveLength(0)
  expect(scan('<div aria-hidden="true"><span className={styles.area} onDrop={upload} style={{left: "0%", top: "0%", width: "50%", height: "50%"}}>追加</span></div>')).not.toHaveLength(0)
  expect(scan('<span className={styles.area} style={{left: "0%", top: "0%", width: "50%", height: "50%"}}>追加</span>')).not.toHaveLength(0)
})
it('LIFFの本物の共通部品を照合し、生の見出し・誤り・スイッチは引き続き検出する', () => {
  const { root, put } = fixture()
  for (const name of ['PageHeading', 'FieldError', 'Button']) put(`apps/liff/src/components/ui/${name}.tsx`, `export default function ${name}(){return null}`)
  const scan = (jsx: string) => {
    put('apps/liff/src/pages/Page.tsx', `import PageHeading from '../components/ui/PageHeading.js'; import FieldError from '../components/ui/FieldError.js'; import Button from '../components/ui/Button.js'; export const Page=()=>(${jsx})`)
    const a = run({ code: root }).code.a
    return ['page-head', 'field-error', 'toggle'].flatMap(id => a[id])
  }
  expect(scan('<><PageHeading>名前</PageHeading><FieldError>失敗</FieldError><Button variant="switch" role="switch" /></>')).toHaveLength(0)
  expect(scan('<><h1>名前</h1><p role="alert">失敗</p><button role="switch" /></>')).toHaveLength(3)
  put('apps/liff/src/components/ui/Button.tsx', 'export default function Fake(){return null}')
  expect(scan('<Button variant="switch" role="switch" />')).not.toHaveLength(0)
})

it('LIFFの共通部品の見た目の上書きも検出し続ける', () => {
  const { root, put } = fixture()
  put('apps/liff/src/components/ui/Button.tsx', 'export default function Button(){return null}')
  put('apps/liff/src/pages/Page.tsx', `import Button from '../components/ui/Button.js'; export const P=()=> <Button variant="switch" style={{ background: 'red' }} />`)
  expect(run({ code: root }).code.b.toggle).toHaveLength(1)
})
