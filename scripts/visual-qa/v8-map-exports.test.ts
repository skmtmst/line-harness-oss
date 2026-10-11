import {existsSync,readFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {it,expect} from 'vitest'
const designDir=join(homedir(),'lh-work/design/v8')
it.skipIf(!existsSync(join(designDir,'html')))('DP-02 every design map board has HTML and text exports',()=>{
 const map=JSON.parse(readFileSync(new URL('./v8-design-map.json',import.meta.url),'utf8'))
 const missing:string[]=[]
 for(const [id,board] of Object.entries(map.boards) as [string,{exportHtml?:string;exportTexts?:string}][]) {
  for(const key of ['exportHtml','exportTexts'] as const)if(!board[key]||!existsSync(join(designDir,board[key]!)))missing.push(`${id}:${key}`)
 }
 expect(missing).toEqual([])
 expect(map.boardCount).toBe(Object.keys(map.boards).length)
})
