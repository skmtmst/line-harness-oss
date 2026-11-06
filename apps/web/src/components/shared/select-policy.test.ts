import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { expect, test } from 'vitest'

function handDrawnChoices(file: string, source: string) {
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  if(tree.statements.some(node=>ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text==='vitest')) return []
  const found: number[]=[]
  const visit=(node: ts.Node)=>{
    if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)) {
      const tag=node.tagName.getText(tree)
      const attr=(name:string)=>node.attributes.properties.find((item):item is ts.JsxAttribute=>ts.isJsxAttribute(item)&&item.name.getText(tree)===name)?.initializer
      const literal=(value:ts.JsxAttributeValue|undefined)=>value&&ts.isStringLiteral(value)?value.text:value&&ts.isJsxExpression(value)&&value.expression&&ts.isStringLiteral(value.expression)?value.expression.text:undefined
      const popup=literal(attr('aria-haspopup')),role=literal(attr('role'))
      if(tag==='select'||tag==='button'&&popup==='listbox'||tag==='input'&&role==='combobox') found.push(tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1)
    }
    ts.forEachChild(node,visit)
  }
  visit(tree);return found
}
function screens(dir:string):string[] {
  return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const file=resolve(dir,entry.name)
    return entry.isDirectory()?['shared','test-utils'].includes(entry.name)?[]:screens(file):file.endsWith('.tsx')&&!file.includes('.test.')?[file]:[]
  })
}
test('手書きの選ぶ欄を検出し、共通部品へ戻すと通る',()=>{
  expect(handDrawnChoices('fixture.tsx','<><select/><button aria-haspopup="listbox"/><input role="combobox"/></>')).toHaveLength(3)
  expect(handDrawnChoices('fixture.tsx',`<><button aria-haspopup={'listbox'}/><input role={'combobox'}/></>`)).toHaveLength(2)
  expect(handDrawnChoices('fixture.tsx','<><Select/><EntitySelect/><Combobox/><FolderSelect/></>')).toEqual([])
})
test('管理画面の選ぶ欄は共通部品を通す',()=>{
  const found=['app','v8','components'].flatMap(dir=>screens(resolve('src',dir))).flatMap(file=>handDrawnChoices(file,readFileSync(file,'utf8')).map(line=>`${file}:${line}`))
  expect(found).toEqual([])
})
