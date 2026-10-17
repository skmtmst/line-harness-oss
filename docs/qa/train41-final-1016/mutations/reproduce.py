from pathlib import Path
import shutil,subprocess,json,os
root=Path.cwd()
dest=Path('/tmp/train41-resume-1016/mutations-fixed').resolve();dest.mkdir(exist_ok=True)
for name in ['v8-pattern-audit.mjs','pattern-css-evidence.mjs','pattern-source-evidence.mjs','temporary-allowances.mjs','v8-pattern-catalog.json','pattern-css-evidence.test.ts','pattern-semantic-evidence.test.ts']:
 shutil.copy2(root/'scripts/visual-qa'/name,dest/name)
if not (dest/'node_modules').exists():(dest/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
(dest/'vitest.config.mts').write_text("import {defineConfig} from 'vitest/config'; export default defineConfig({test:{include:['*.test.ts']}})")
original={n:(dest/n).read_text() for n in ['v8-pattern-audit.mjs','pattern-css-evidence.mjs']}
css='pattern-css-evidence.mjs';audit='v8-pattern-audit.mjs'
anchor='  if (!uses || /:global'
cases=[('normal',None,None,None),
 ('native-counted',css,(anchor,'  if (selector.includes("data-state")) return false\n'+anchor),'素の要素だけ'),
 ('shared-missed',css,(anchor,'  if (selector.includes("data-state")) return true\n'+anchor),'共通部品に当たる'),
 ('global-missed',css,(anchor,'  if (selector.includes(":global")) return true\n'+anchor),'判断できない選択子'),
 ('has-missed',css,(anchor,'  if (selector.includes(":has(")) return true\n'+anchor),'判断できない選択子'),
 ('unknown-missed',css,(anchor,'  if (selector.includes(".unknown")) return true\n'+anchor),'判断できない選択子'),
 ('readonly-counted',audit,("signal.id === 'own-label' && proof?.readOnlyText", "false && signal.id === 'own-label' && proof?.readOnlyText"),'読むだけの動作説明'),
 ('editor-missed',audit,("      if (signal.id === 'own-label' && proof?.readOnlyText", "      if (signal.id === 'own-label') continue\n      if (signal.id === 'own-label' && proof?.readOnlyText"),'読むだけの動作説明'),
 ('svg-shared-missed',css,(anchor,'  if (selector.endsWith("svg")) return true\n'+anchor),'直接のsvg指定'),
 ('liff-raw-missed',audit,("      if (rel.startsWith('apps/liff/') && codeRoot && pattern.owner?.liff", "      if (rel.startsWith('apps/liff/')) continue\n      if (rel.startsWith('apps/liff/') && codeRoot && pattern.owner?.liff"),'LIFFの本物'),
 ('restored',None,None,None)]
results=[]
for label,file,change,pattern in cases:
 for n,code in original.items():(dest/n).write_text(code)
 if file:
  before,after=change
  assert before in original[file],label
  (dest/file).write_text(original[file].replace(before,after,1))
 cmd=['pnpm','exec','vitest','run','--root',str(dest),'--config',str(dest/'vitest.config.mts'),'--maxWorkers=2']
 if pattern:cmd+=['-t',pattern]
 result=subprocess.run(cmd,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (dest/(label+'.log')).write_text(result.stdout)
 expected=0 if file is None else 1
 results.append({'case':label,'exit':result.returncode,'expected':expected,'assertion_failed': 'AssertionError' in result.stdout})
 print(label,result.returncode,flush=True)
for n,code in original.items():(dest/n).write_text(code)
(dest/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
assert all(x['exit']==x['expected'] and (not x['expected'] or x['assertion_failed']) for x in results)
