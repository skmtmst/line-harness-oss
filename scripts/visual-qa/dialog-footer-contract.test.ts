import { describe, expect, it } from 'vitest'
import { inspectDialogFooters, scanDialogFooters } from './dialog-footer-contract.mjs'

const imports = `import Window, { DialogActions as Actions } from '@/components/shared/dialog'; import Button from '@/components/shared/button';`
describe('窓の下の帯を共通部品へそろえる', () => {
  it('全画面の窓に自前の操作帯と参照だけの閉じる帯が無い', () => {
    expect(scanDialogFooters(process.cwd())).toEqual([])
  }, 20_000)
  it.each([
    `<Button>実行する</Button>`,
    `<><Button>キャンセル</Button><Button>実行する</Button></>`,
    `<div className="flex gap-2"><Button>実行する</Button></div>`,
    `ready ? <Actions><Button>実行する</Button></Actions> : <div><Button>実行する</Button></div>`,
  ])('別名の窓・かけら・条件・自前の箱でも、共通帯を外すと赤、戻すと緑', footer => {
    const normal = imports + `const Screen = () => <Window footer={<Actions><Button>実行する</Button></Actions>} />`
    expect(inspectDialogFooters(normal)).toEqual([])
    expect(inspectDialogFooters(imports + `const Screen = () => <Window footer={${footer}} />`).some(row => row.kind === 'custom-dialog-actions')).toBe(true)
    expect(inspectDialogFooters(normal)).toEqual([])
  })
  it('共通帯で包んでいても参照窓の閉じるだけの下帯は赤', () => {
    expect(inspectDialogFooters(imports + `const Screen = () => <Window footer={<Actions><Button>閉じる</Button></Actions>} />`).map(row => row.kind)).toContain('reference-dialog-close-footer')
    expect(inspectDialogFooters(imports + `const Screen = () => <Window onCancel={close} />`)).toEqual([])
  })
  it('共通帯の内側の条件で閉じるだけになる道も赤', () => {
    const source = imports + `const Screen = () => <Window footer={<Actions>{done ? <Button>{'閉じる'}</Button> : <><Button>キャンセル</Button><Button>実行する</Button></>}</Actions>} />`
    expect(inspectDialogFooters(source).map(row => row.kind)).toContain('reference-dialog-close-footer')
  })
  it.each(['actions', 'renderActions()', 'ready ? actions : undefined', '<>{actions}</>'])('中身が読めない帯 %s は赤、共通の帯で包むと緑', footer => {
    expect(inspectDialogFooters(imports + `const Screen = () => <Window footer={${footer}} />`).map(row => row.kind)).toContain('unresolved-dialog-footer')
    expect(inspectDialogFooters(imports + `const Screen = () => <Window footer={<Actions>{actions}</Actions>} />`)).toEqual([])
  })
  it('同じ関数の変数も調べ、共通の帯を入れた変数は緑、自前の変数は赤', () => {
    expect(inspectDialogFooters(imports + `function Screen(){const footer=<Button>保存</Button>;return <Window footer={footer}/>}`).map(row => row.kind)).toContain('custom-dialog-actions')
    expect(inspectDialogFooters(imports + `function Screen(){const footer=<Actions><Button>保存</Button></Actions>;return <Window footer={footer}/>}`)).toEqual([])
    expect(inspectDialogFooters(imports + `function Screen(){const footer=<Button>保存</Button>;return <Window footer={<>{footer}</>}/>}`).map(row => row.kind)).toContain('custom-dialog-actions')
  })
  it('共通帯の中にも手書きの配置箱を残さず、印ボタンやroleの操作も数える', () => {
    expect(inspectDialogFooters(imports + `const Screen=()=> <Window footer={<Actions><div className="end"><Button>保存</Button></div></Actions>}/>`).map(row => row.kind)).toContain('nested-custom-dialog-actions')
    expect(inspectDialogFooters(imports + `const Screen=()=> <Window footer={<span role="button">保存</span>}/>`).map(row => row.kind)).toContain('custom-dialog-actions')
  })
  it('共通帯だけを返す薄い部品は自前の帯と取り違えない', () => {
    expect(inspectDialogFooters(imports + `const Pair=({children})=>(<Actions>{children}</Actions>);const Screen=()=> <Window footer={<Pair><Button>実行する</Button></Pair>} />`)).toEqual([])
  })
  it('共通帯の下にある状態文は操作と取り違えず、状態文内のボタンは見逃さない', () => {
    const prefix = imports + `const Screen=()=>{const reason=ready ? '入力してください' : undefined;return <Window footer={<div><Actions><Button>保存</Button></Actions>`
    expect(inspectDialogFooters(prefix + `<div role="status">{reason}</div></div>} />}`)).toEqual([])
    expect(inspectDialogFooters(prefix + `<div role="status">{ready ? <Button>保存</Button> : reason}</div></div>} />}`).map(row => row.kind)).toContain('custom-dialog-actions')
  })
})
