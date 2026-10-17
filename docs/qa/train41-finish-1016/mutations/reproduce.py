from pathlib import Path
import shutil, subprocess, json
root=Path.cwd(); dest=Path('/tmp/train41-pattern-mutations').resolve(); dest.mkdir(exist_ok=True)
source=root/'scripts/visual-qa'
for file in ['v8-pattern-audit.mjs','pattern-css-evidence.mjs','pattern-source-evidence.mjs','temporary-allowances.mjs','v8-pattern-catalog.json','pattern-css-evidence.test.ts']:
 shutil.copy2(source/file,dest/file)
if not (dest/'node_modules').exists(): (dest/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
(dest/'vitest.config.mts').write_text("import {defineConfig} from 'vitest/config'; export default defineConfig({test:{include:['*.test.ts']}})")
original=(dest/'pattern-css-evidence.mjs').read_text()
runs=[('normal',original,None),('native-counted',original.replace('if (!uses || /:global', 'if (selector.includes("data-state")) return false\n  if (!uses || /:global'), '素の要素だけ'),('shared-missed',original.replace('if (!uses || /:global', 'if (selector.includes("data-state")) return true\n  if (!uses || /:global'), '共通部品に当たる'),('unknown-missed',original.replace('if (!uses || /:global', 'if (selector.includes(":global")) return true\n  if (!uses || /:global'), '判断できない選択子'),('has-missed',original.replace('if (!uses || /:global', 'if (selector.includes(":has(")) return true\n  if (!uses || /:global'), '判断できない選択子'),('unknown-target-missed',original.replace('if (!uses || /:global', 'if (selector.includes(".unknown")) return true\n  if (!uses || /:global'), '判断できない選択子'),('restored',original,None)]
results=[]
for name,code,pattern in runs:
 (dest/'pattern-css-evidence.mjs').write_text(code)
 cmd=['pnpm','exec','vitest','run','--root',str(dest),'--config',str(dest/'vitest.config.mts'),'--maxWorkers=2']
 if pattern:cmd+=['-t',pattern]
 result=subprocess.run(cmd,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (dest/(name+'.log')).write_text(result.stdout)
 results.append({'case':name,'exit':result.returncode,'expected':0 if name in ['normal','restored'] else 1})
(dest/'pattern-css-evidence.mjs').write_text(original)
(dest/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
if any(x['exit']!=x['expected'] for x in results):raise SystemExit(1)
