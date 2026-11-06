/** 初期セットの同じ4面定義から、LINEに渡す実PNGを再生成する。 */
import {assertInitialImageVersion} from './image-version.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(path.join(root,'apps/web/package.json'));
const ts=require('typescript'), sharp=createRequire(require.resolve('next/package.json'))('sharp');
const source=await readFile(path.join(root,'packages/shared/src/initial-rich-menu.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {INITIAL_MENUS,initialMenuBounds,INITIAL_MENU_VERSION}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const icons={calendar:'M30 40h140v120H30z M30 70h140 M60 20v40 M140 20v40 M60 100h20 M110 100h20 M60 130h20',check:'M30 40h140v120H30z M30 70h140 M60 20v40 M140 20v40 M65 115l22 22 45-45',list:'M40 35h120v135H40z M65 70h70 M65 100h70 M65 130h45',pin:'M100 175s65-60 65-110a65 65 0 0 0-130 0c0 50 65 110 65 110z M120 65a20 20 0 1 1-40 0 20 20 0 1 1 40 0',message:'M25 35h150v110H95l-40 30v-30H25z M55 75h90 M55 105h65',shop:'M30 70h140v100H30z M20 70l20-45h120l20 45 M80 170v-65h40v65',person:'M130 55a30 30 0 1 1-60 0 30 30 0 1 1 60 0 M35 175v-25a65 65 0 0 1 130 0v25',book:'M100 45C75 20 40 20 20 35v125c25-15 55-15 80 5 25-20 55-20 80-5V35c-20-15-55-15-80 10z M100 45v120'};
const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const images={};
for(const [style,menu] of Object.entries(INITIAL_MENUS)) {
 const tiles=menu.buttons.map((button,i)=>{const b=initialMenuBounds(i);return `<g transform="translate(${b.x} ${b.y})"><rect width="${b.width}" height="${b.height}" fill="${menu.color}"/><g transform="translate(525 190)" fill="none" stroke="${menu.ink}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[button.icon]}"/></g><text x="625" y="570" text-anchor="middle" fill="${menu.ink}" font-family="Hiragino Sans,Hiragino Kaku Gothic ProN,sans-serif" font-size="66" font-weight="600">${escape(button.label)}</text></g>`}).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="2500" height="1686" viewBox="0 0 2500 1686">${tiles}<path d="M1250 0v1686M0 843h2500" stroke="#fff" stroke-width="8"/></svg>`;
 const png=await sharp(Buffer.from(svg)).png({palette:true,colours:64,compressionLevel:9}).toBuffer();
 const meta=await sharp(png).metadata();if(meta.width!==2500||meta.height!==1686)throw new Error('image_size_mismatch');
 images[style]=png.toString('base64');
 console.log(style,png.length);
}
await mkdir(path.join(root,'packages/shared/src/assets'),{recursive:true});
const destination=path.join(root,'packages/shared/src/assets/initial-rich-menu-images.json');
let previous=null;try{previous=JSON.parse(await readFile(destination,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
assertInitialImageVersion(previous,INITIAL_MENU_VERSION,images);
await writeFile(destination,JSON.stringify({_version:INITIAL_MENU_VERSION,...images},null,2)+'\n');
