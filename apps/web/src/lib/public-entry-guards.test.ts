import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error The source reader is a Node module.
import { readUiSource } from '../../scripts/test-ui-source.mjs'
// @ts-expect-error The inspector is a Node module.
import { inspectB244Tree } from '../../scripts/verify.mjs'

describe('feature entry verification', () => {
  it('follows an explicit public index to its declared implementation', () => {
    const root = mkdtempSync(join(tmpdir(), 'public-entry-'))
    try {
      mkdirSync(join(root, 'src/v8/feature'), { recursive: true })
      writeFileSync(join(root, 'src/v8/entry.tsx'), "import { Screen } from './feature/index'; <Screen />")
      writeFileSync(join(root, 'src/v8/feature/index.ts'), "export { Screen } from './screen'")
      writeFileSync(join(root, 'src/v8/feature/screen.tsx'), "import { body } from './body'; export function Screen(){return body}")
      writeFileSync(join(root, 'src/v8/feature/body.ts'), "export const body = 'implementation-visible'")
      expect(readUiSource(join(root, 'src/v8/entry.tsx'))).toContain('implementation-visible')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('only accepts definitions from the actual object passed by every caller to that helper', () => {
    const root = mkdtempSync(join(tmpdir(), 'passed-fields-'))
    try {
      mkdirSync(join(root, 'src/v8/feature'), { recursive: true })
      mkdirSync(join(root, 'src/app'), { recursive: true })
      const caller = join(root, 'src/v8/feature/create.tsx')
      const helper = join(root, 'src/v8/feature/fields.tsx')
      writeFileSync(helper, "export function renderFields({fields}){return <Field requirement={fields.requirement('name')}/>}")
      const source = (body: string) => `import {renderFields} from './fields'; export function Create(){${body}}`
      writeFileSync(caller, source("const fields=useFormErrors(); fields.define('name','名前',check,{required:true}); return renderFields({fields})"))
      expect(inspectB244Tree(root).errors).toEqual([])
      for (const body of [
        "const fields=useFormErrors(); fields.define('name','名前',check); return renderFields({fields})",
        "const fields=useFormErrors(); other.define('name','名前',check,{required:true}); return renderFields({fields})",
        "const fields=useFormErrors(); fields.define('other','別欄',check,{required:true}); return renderFields({fields})",
        "const fields=useFormErrors(); function unused(){fields.define('name','名前',check,{required:true})} return renderFields({fields})",
        "const fields=useFormErrors(); fields.define('name','名前',check,{required:true}); renderFields({fields}); return renderFields({fields:other})",
      ]) {
        writeFileSync(caller, source(body))
        expect(inspectB244Tree(root).errors.map((row: { kind: string }) => row.kind)).toEqual(['requirement-without-definition'])
      }
      writeFileSync(caller, source("const fields=useFormErrors(); fields.define('name','名前',check,{required:true}); return renderFields({fields})"))
      writeFileSync(helper, "export function renderFields({fields}){return <Field requirement={fields.requirement('name')}/>} export function unrelated({fields}){return <Field requirement={fields.requirement('name')}/>} ")
      expect(inspectB244Tree(root).errors.map((row: { kind: string }) => row.kind)).toEqual(['requirement-without-definition'])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
