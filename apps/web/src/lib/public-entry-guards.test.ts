import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error The source reader is a Node module.
import { readUiSource } from '../../scripts/test-ui-source.mjs'
// @ts-expect-error The inspector is a Node module.
import { inspectB244Tree } from '../../scripts/verify.mjs'
// @ts-expect-error The save inspector is a Node module.
import { auditSavedScreens } from '../../scripts/form-save-errors-audit.mjs'
// @ts-expect-error The card source selector is a Node module.
import { v8Sources } from '../../scripts/card-shape-contract.mjs'

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

  it('keeps field checks active when a screen is renamed without a generation suffix', () => {
    const root = mkdtempSync(join(tmpdir(), 'renamed-screen-'))
    try {
      mkdirSync(join(root, 'src/v8'), { recursive: true })
      mkdirSync(join(root, 'src/app/reservations'), { recursive: true })
      const previous = join(root, 'src/app/reservations/editor-v8.tsx')
      const current = join(root, 'src/app/reservations/editor.tsx')
      writeFileSync(previous, '<Field required optional />')
      expect(inspectB244Tree(root).errors.map((row: { kind: string }) => row.kind)).toEqual(['requirement-conflict'])
      renameSync(previous, current)
      expect(inspectB244Tree(root).errors.map((row: { kind: string }) => row.kind)).toEqual(['requirement-conflict'])
      writeFileSync(current, "<Field requirement={fields.requirement('name')}/>")
      expect(inspectB244Tree(root).errors.map((row: { kind: string }) => row.kind)).toEqual(['requirement-without-definition'])
      writeFileSync(current, "fields.define('name','名前',check,{required:true}); <Field requirement={fields.requirement('name')}/>")
      expect(inspectB244Tree(root).errors).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('keeps save error checks on an exported hook after it moves out of the screen', () => {
    const root = mkdtempSync(join(tmpdir(), 'exported-save-hook-'))
    try {
      mkdirSync(join(root, 'src/v8/settings'), { recursive: true })
      mkdirSync(join(root, 'src/app'), { recursive: true })
      writeFileSync(join(root, 'src/v8/settings/screen.tsx'), "export {useSettings} from './use-settings'")
      const hook = join(root, 'src/v8/settings/use-settings.ts')
      writeFileSync(hook, "export function useSettings(){const saveErrors=useSaveFormErrors(); async function save(){try{await api.settings.update({})}catch(error){setError('failed')}} return {saveErrors}}")
      expect(auditSavedScreens(root)).toHaveLength(1)
      writeFileSync(hook, "export function useSettings(){const saveErrors=useSaveFormErrors(); async function save(){try{await api.settings.update({})}catch(error){saveErrors.capture(error)}} return {saveErrors}}")
      expect(auditSavedScreens(root)).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('keeps save error checks when a public V8 screen receives a purpose name', () => {
    const root = mkdtempSync(join(tmpdir(), 'renamed-save-screen-'))
    try {
      mkdirSync(join(root, 'src/v8'), { recursive: true })
      mkdirSync(join(root, 'src/app/reservations'), { recursive: true })
      const previous = join(root, 'src/app/reservations/editor-v8.tsx')
      const current = join(root, 'src/app/reservations/editor.tsx')
      const source = "export default function ReservationEditorV8(){const saveErrors=useSaveFormErrors(); async function save(){try{await api.reservations.update({})}catch(error){setError('failed')}} return <SaveErrorScope fields={saveErrors}/> }"
      writeFileSync(previous, source)
      expect(auditSavedScreens(root)).toHaveLength(1)
      renameSync(previous, current)
      expect(auditSavedScreens(root)).toHaveLength(1)
      writeFileSync(current, source.replace("setError('failed')", 'saveErrors.capture(error)'))
      expect(auditSavedScreens(root)).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('keeps a public V8 component in the card guard after its file is renamed', () => {
    const root = mkdtempSync(join(tmpdir(), 'renamed-card-screen-'))
    try {
      mkdirSync(join(root, 'v8'), { recursive: true })
      mkdirSync(join(root, 'app'), { recursive: true })
      const previous = join(root, 'app/editor-v8.tsx')
      const current = join(root, 'app/editor.tsx')
      writeFileSync(previous, 'export default function EditorV8(){return <div/>}')
      expect(v8Sources(root)).toContain(previous)
      renameSync(previous, current)
      expect(v8Sources(root)).toContain(current)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

})
