import { readFileSync,writeFileSync,existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname,join } from 'node:path'
const root='/Users/kentakenta/lh-work/lh-pages-matchm',out=new URL('.',import.meta.url).pathname
const require=createRequire(root+'/package.json'),ts=require('typescript')
const {run,codeFindings}=await import(root+'/scripts/visual-qa/v8-pattern-audit.mjs')
const report=run({code:root}),hits=codeFindings(report)
writeFileSync(out+'source-audit.json',JSON.stringify({meta:report.meta,code:report.code},null,2)+'\n')
const cases=JSON.parse(readFileSync(out+'cases.json'))
function dependencies(start){const found=new Set();function visit(file){if(found.has(file)||!existsSync(join(root,file)))return;found.add(file);if(!/\.[jt]sx?$/.test(file))return;const imports=ts.preProcessFile(readFileSync(join(root,file),'utf8'),true,true).importedFiles;for(const{fileName:name}of imports){const prefix=name.startsWith('@/')?'apps/web/src/'+name.slice(2):name.startsWith('.')?join(dirname(file),name):null;if(!prefix)continue;const next=[prefix,prefix+'.tsx',prefix+'.ts',prefix+'.module.css',join(prefix,'index.tsx'),join(prefix,'index.ts')].find(p=>existsSync(join(root,p)));if(next)visit(next)}}visit(start);return[...found]}
const rows=cases.map(c=>{const route=new URL(c.route,'http://local').pathname,files=dependencies(join('apps/web/src/app',route,'page.tsx'));return{board:c.board,files,candidates:hits.filter(h=>files.includes(h.file))}})
writeFileSync(out+'source-by-board.json',JSON.stringify(rows,null,2)+'\n');console.log(rows.length,hits.length)
