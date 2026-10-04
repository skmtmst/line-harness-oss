from pathlib import Path
import json, math
from argparse import ArgumentParser
from PIL import Image, ImageDraw
parser=ArgumentParser(description='DOM positions and root-aligned visual previews; not a pixel-perfect test')
parser.add_argument('--column-offset',type=float,default=0,help='Common horizontal alignment of the screenshot column, not a per-part correction')
args=parser.parse_args()
p=Path(__file__).resolve().parents[5]/'design/v8/parts-check'
refs=json.loads((p/'badges-reference-position.json').read_text())
imps={r['id']:r for r in json.loads((p/'badges-implementation-position.json').read_text())}
page=Image.open(p/'badges-position-page.jpg').convert('RGB')
def rounded(im,n):
    radius=n['values']['borderTopLeftRadius']
    r=float(radius.rstrip('px%'))
    if radius.endswith('%'): r=min(im.size)*r/100
    r=min(r,min(im.size)/2)
    if n['values']['backgroundColor']=='rgba(0, 0, 0, 0)' or r==0: return im
    mask=Image.new('L',im.size); ImageDraw.Draw(mask).rounded_rectangle((0,0,im.width-1,im.height-1),r,fill=255)
    result=Image.new('RGB',im.size,'white');result.paste(im,mask=mask)
    return result
rows=[]
overview=Image.new('RGB',(960,140*len(refs)), 'white');draw=ImageDraw.Draw(overview)
for idx,r in enumerate(refs):
    ident=r['id']; imp=imps[ident]; rn=r['nodes'][0]; geom=imp['rootRect'];w=math.ceil(rn['rect']['width']);h=math.ceil(rn['rect']['height'])
    ref=rounded(Image.open(p/f'{ident}-reference-raw.jpg').convert('RGB').transform((w,h),Image.Transform.AFFINE,(1,0,0,0,1,0),Image.Resampling.BICUBIC),rn)
    actual=page.transform((w,h),Image.Transform.AFFINE,(1,0,geom['x']+args.column_offset,0,1,geom['y']),Image.Resampling.BICUBIC)
    # Source captures remain unmodified
    posdiff=[]
    spacing_keys=['paddingTop','paddingRight','paddingBottom','paddingLeft','rowGap','columnGap']
    shape_keys=['width','height',*spacing_keys,'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius','backgroundColor','outlineStyle','outlineWidth','outlineOffset','boxShadow']
    if rn['values']['outlineStyle']!='none': shape_keys.append('outlineColor')
    for edge in ['Top','Right','Bottom','Left']:
        if float(rn['values'][f'border{edge}Width'].rstrip('px'))>0: shape_keys.append(f'border{edge}Color')
    style_diff=[key for key in shape_keys if rn['values'][key]!=imp['nodes'][0]['values'][key]]
    spacing_diff=[abs(float(rn['values'][key].replace('normal','0').rstrip('px'))-float(imp['nodes'][0]['values'][key].replace('normal','0').rstrip('px'))) for key in spacing_keys]
    for j,n in enumerate(r['nodes']):
        if j==0:i=imp['nodes'][0];key='rect'
        elif n.get('textRect'):i=next(z for z in imp['nodes'] if z['name']=='文字');key='textRect'
        elif n['name']=='点':i=next(z for z in imp['nodes'] if z['name']=='点');key='rect'
        elif n['name']=='済み':i=next(z for z in imp['nodes'] if z['name']=='済み');key='rect'
        else:i=next(z for z in imp['nodes'] if z['name']=='アイコン');key='rect'
        for k,v in n[key].items(): posdiff.append(abs(v-i[key][k]))
        if key=='textRect':
            style_diff += [k for k in ['fontSize','fontWeight','lineHeight','letterSpacing','color'] if n['values'][k]!=i['values'][k]]
    overlay=Image.blend(ref,actual,0.5)
    pair=Image.new('RGB',(720,110),'white');pd=ImageDraw.Draw(pair);pd.text((16,8),ident+'  reference',fill='black');pd.text((376,8),'implementation',fill='black');pair.paste(ref,(16,35));pair.paste(actual,(376,35));pair.save(p/f'{ident}.png');overlay.save(p/f'{ident}-overlay.png')
    top=idx*140;draw.text((10,top+3),f'{ident}: element / text position {max(posdiff):g}px',fill='black')
    for k,im in enumerate((ref,actual,overlay)):
        zoom=2 if w<150 else 1
        overview.paste(im.resize((w*zoom,h*zoom),Image.Resampling.NEAREST),(10+320*k,top+24))
    rows.append({'id':ident,'maxPositionDelta':max(posdiff),'positionsBeyond4px':sum(v>4 for v in posdiff),'positionChecks':len(posdiff),'maxSpacingDelta':max(spacing_diff),'styleMismatches':style_diff,'status':'PASS' if max(posdiff)<=1 and max(spacing_diff)<=1 and not style_diff else 'FAIL'})
overview.save(p/'badges-overlay-overview.png')
(p/'badges-overlay-results.json').write_text(json.dumps({'criterion':'DOM element/text positions (not JPEG pixel distance)','screenshotColumnOffset':args.column_offset,'parts':rows},ensure_ascii=False,indent=2)+'\n')
print(json.dumps(rows,ensure_ascii=False,indent=2))

if any(row["status"] != "PASS" for row in rows):
    raise SystemExit(1)
