import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import ts from 'typescript'
const visit=(node,fn)=>{fn(node);ts.forEachChild(node,c=>visit(c,fn))}
const unwrap=n=>{while(n&&(ts.isAsExpression(n)||ts.isParenthesizedExpression(n)||ts.isTypeAssertionExpression(n)))n=n.expression;return n}
const empty=n=>{n=unwrap(n);return n&&ts.isArrayLiteralExpression(n)&&n.elements.length===0}
function owner(node){for(let p=node;p;p=p.parent)if(ts.isFunctionDeclaration(p)||ts.isArrowFunction(p)||ts.isFunctionExpression(p))return p.name?.getText()??(ts.isVariableDeclaration(p.parent)?p.parent.name.getText():'anonymous');return 'module'}
/** 画面全体から失敗を空に変える枝を拾う。表示済みエラーも一覧に残し、許可は個別の理由を要求する。 */
export function auditLoadFailures(source,filename='screen.tsx') {
 const sf=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,filename.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS)
 const rows=[];const seen=new Set()
 const add=(node,branch,kind)=>{
  let found=false;visit(branch,c=>{if(empty(c))found=true});if(!found)return
  const pos=node.getStart(sf);if(seen.has(pos))return;seen.add(pos)
  const snippet=branch.getText(sf).replace(/\s+/g,' ')
  let disposition='unchecked'
  {
   visit(branch,c=>{
    if(ts.isCallExpression(c)&&/set.*(?:Error|Failed|Failure)/.test(c.expression.getText(sf))&&c.arguments[0]&&! /^(?:false|null|undefined|''|"")$/.test(c.arguments[0].getText(sf)))disposition='error-visible'
    if(ts.isCallExpression(c)&&/set.*(?:Status|State)/.test(c.expression.getText(sf))&&/['"](?:error|forbidden|failed|unknown)['"]/.test(c.arguments.map(a=>a.getText(sf)).join(' ')))disposition='error-visible'
    if(ts.isCallExpression(c)&&/saveErrors\.capture/.test(c.expression.getText(sf))&&source.includes('SaveErrorScope'))disposition='error-visible'
    if(ts.isCallExpression(c)&&/setMessage$/.test(c.expression.getText(sf))&&/読めません|読み込めません/.test(c.arguments.map(a=>a.getText(sf)).join(' ')))disposition='error-visible'
    if(ts.isPropertyAssignment(c)&&/^(?:error|state|status)$/.test(c.name.getText(sf))&&/['"](?:error|forbidden)|読み込め|確認できません/.test(c.initializer.getText(sf)))disposition='error-visible'
   })
   const tryNode=ts.isCatchClause(node)?node.parent:null
   if(disposition==='unchecked'&&tryNode&&ts.isTryStatement(tryNode)&&/JSON\.parse\(/.test(tryNode.tryBlock.getText(sf))&&!/(?:api|Api)\./.test(tryNode.tryBlock.getText(sf)))disposition='local-parser'
  }
  const fingerprint=createHash('sha256').update(kind+':'+owner(node)+':'+node.getText(sf).replace(/\s+/g,' ')).digest('hex').slice(0,16)
  rows.push({filename,line:sf.getLineAndCharacterOfPosition(pos).line+1,owner:owner(node),kind,fingerprint,disposition,snippet})
 }
 visit(sf,node=>{
  if(ts.isCatchClause(node))add(node,node.block,'catch')
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='catch'&&node.arguments[0])add(node,node.arguments[0],'catch')
  if(ts.isConditionalExpression(node)&&/\.success\b|\.status\s*===?\s*['"](?:fulfilled|rejected)['"]/.test(node.condition.getText(sf))) {
   if(empty(node.whenFalse))add(node,node.whenFalse,'failure-branch')
   if(empty(node.whenTrue))add(node,node.whenTrue,'failure-branch')
  }
  if(ts.isIfStatement(node)&&/!\s*\w+\.success\b|\.success\s*===?\s*false\b|\.status\s*===?\s*['"]rejected['"]/.test(node.expression.getText(sf)))add(node,node.thenStatement,'failure-branch')
 })
 return rows
}
export function auditScreenLoads(root){const files=[];const scan=dir=>{for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())scan(p);else if(/\.[tj]sx?$/.test(p)&&! /\.(test|spec)\.|fixture/.test(p))files.push(p)}};scan('src/v8');scan('src/app');return files.sort().flatMap(file=>auditLoadFailures(fs.readFileSync(path.join(root,file),'utf8'),file))}
export function unapprovedLoadFailures(rows,allowlist,reviewed=[]){
 const used=new Map()
 return rows.filter(row=>{
  const key=row.filename+':'+row.fingerprint+':'+row.disposition
  const candidates=row.disposition==='unchecked'?allowlist:reviewed
  const allowance=candidates.find(a=>a.filename===row.filename&&a.fingerprint===row.fingerprint&&a.reason?.trim()&&(row.disposition==='unchecked'||a.disposition===row.disposition))
  const count=(used.get(key)||0)+1;used.set(key,count)
  return !allowance||count>(allowance.count??1)
 })
}
