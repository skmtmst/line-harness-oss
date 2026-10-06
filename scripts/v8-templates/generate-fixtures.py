#!/usr/bin/env python3
"""正本HTMLから確認ページの中身だけを抽出する。正本は変更しない。
使い方: python3 scripts/v8-templates/generate-fixtures.py /abs/design/v8/html
"""
import base64, copy, gzip, hashlib, html, json, re, sys
from html.parser import HTMLParser
from pathlib import Path
source=Path(sys.argv[1])
class Parser(HTMLParser):
 def __init__(self):super().__init__();self.stack=[];self.nodes=[]
 def handle_starttag(self,tag,attrs):
  node={'tag':tag,'attrs':dict(attrs),'children':[]}
  (self.stack[-1]['children'] if self.stack else self.nodes).append(node)
  if tag not in ['meta','link','img','br','input']:self.stack.append(node)
 def handle_endtag(self,tag):
  if self.stack and self.stack[-1]['tag']==tag:self.stack.pop()
 def handle_data(self,text):
  if self.stack and text.strip():self.stack[-1]['text']=self.stack[-1].get('text','')+text.strip()
def nodes(ns):
 for n in ns:
  yield n;yield from nodes(n['children'])
def load(f):
 parser=Parser()
 parser.feed((source / (f+'.html')).read_text())
 return parser.nodes
def by(ns,id):return next(n for n in nodes(ns) if n['attrs'].get('data-pencil-id')==id)
def named(n,name):return next(c for c in n['children'] if c['attrs'].get('data-pencil-name')==name)
def render(n,inner=False):
 children=html.escape(n.get('text',''))+''.join(render(c) for c in n['children'])
 if inner:return children
 attrs=' '.join(k+'="'+html.escape(v,quote=True)+'"' for k,v in n['attrs'].items())
 if n['tag'] in ['meta','link','img','br','input']:return '<'+n['tag']+' '+attrs+'>'
 return '<'+n['tag']+' '+attrs+'>'+children+'</'+n['tag']+'>'
def content(n):return render(n,True)
def txt(n):return n.get('text','')+''.join(txt(c) for c in n['children'])
fixtures={}
for kind,f,id in [('dashboard','d8X09',None),('list','components-NbomF','oDiaE'),('create','components-NbomF','iychL'),('detail','components-NbomF','tBB0a'),('inbox','components-NbomF','pmrtN'),('settings','components-x6BDY','R2ojn'),('analytics','components-x6BDY','bx1eN'),('list-folders','I1E7Bt',None)]:
 ns=load(f)
 screen=by(ns,id) if id else next(n for n in nodes(ns) if 'width: 1440px' in n['attrs'].get('style','') and 'background-color: #f5f5f7' in n['attrs'].get('style',''))
 board=next(n for n in nodes([screen]) if n['attrs'].get('data-pencil-name')=='白い板')
 reference=render(screen);empty=copy.deepcopy(screen)
 eb=next(n for n in nodes([empty]) if n['attrs'].get('data-pencil-name')=='白い板');eb['children']=[];eb['attrs']['data-template-mount']=''
 data={'source':f,'screenId':screen['attrs'].get('data-pencil-id'),'reference':reference,'shell':render(empty),'shellLeft':render(screen['children'][0]),'shellTop':render(screen['children'][1]['children'][0]),'height':int(re.search(r'(?:^|;) ?height: (\d+)px',screen['attrs'].get('style','')).group(1)),'slots':{},'heading':{}}
 head=next((n for n in board['children'] if '板の頭' in n['attrs'].get('data-pencil-name','')),None)
 if head:
  group=next(n for n in head['children'] if n['attrs'].get('data-pencil-name') in ['題と説明','題','名'])
  cs=group['children'];data['heading']['title']=txt(cs[0]);data['heading']['description']=txt(cs[1]) if len(cs)>1 else ''
  start=head['children'].index(group)
  data['slots']['identity']=''.join(render(n) for n in head['children'][:start])
  # Strip only spacing nodes; steps and actions remain content.
  rest=[n for n in head['children'][start+1:] if not n['attrs'].get('data-pencil-name','').startswith('間')]
  steps=[n for n in rest if n['attrs'].get('data-pencil-name','').startswith(('手順','線'))]
  actions=[n for n in rest if n not in steps]
  data['slots']['steps']=''.join(render(n) for n in steps);data['slots']['actions']=''.join(render(n) for n in actions)
 s=data['slots']
 if kind=='dashboard':
  s['notice']=content(named(board,'はじめの設定'));s['stats']=content(named(board,'今日やること（数の帯）'))
  data['rows']=[]
  for n in board['children']:
   if n['attrs'].get('data-pencil-name') in ['段A','段B','段C','段D']:
    data['rows'].append({'name':n['attrs']['data-pencil-name'],'cells':[content(c) for c in n['children']],'styles':[c['attrs'].get('style') for c in n['children']]})
  s['tail']=''.join(render(n) for n in board['children'][-2:])
 elif kind in ['list','list-folders']:
  s['tabs']=content(named(board,'タブの段'));s['stats']=content(named(board,'数の帯'))
  if kind=='list':
   s['toolbar']=content(named(board,'道具'));s['pagination']=content(named(board,'ページ送り'))
   s['content']=''.join(render(n) for n in board['children'] if n['attrs'].get('data-pencil-name','').startswith(('表の見出し','行 ')))
  else:
   body=named(board,'本文');s['folders']=content(body['children'][0]);listing=body['children'][1]
   for n in listing['children']:
    name=n['attrs'].get('data-pencil-name','')
    if '道具' in name:s['toolbar']=content(n)
    elif 'ページ送り' in name:s['pagination']=content(n)
    else:s['content']=s.get('content','')+render(n)
 elif kind=='create':
  body=named(board,'中身');s['content']=content(body['children'][0]);s['preview']=content(body['children'][1])
 elif kind=='detail':
  s['tabs']=content(named(board,'タブ'));body=named(board,'中身');s['summary']=content(body['children'][0]);s['content']=content(body['children'][1])
 elif kind=='inbox':
  s['list']=content(board['children'][0]);s['conversation']=content(board['children'][1]);s['summary']=content(board['children'][2])
 elif kind=='settings':
  body=named(board,'中身');s['navigation']=content(body['children'][0]);s['content']=content(body['children'][1])
  s['referenceFooter']=render(board['children'][2])
 elif kind=='analytics':
  s['period']=content(named(board,'期間の行'));s['stats']=content(named(board,'数の帯'));body=named(board,'下');s['content']=content(body['children'][0]);s['aside']=content(body['children'][1])
 fixtures[kind]=data

raw=json.dumps(fixtures,ensure_ascii=False,separators=(',',':')).encode()
files=['components-NbomF','components-x6BDY','d8X09','I1E7Bt']
packed={'sources':{f+'.html':hashlib.sha256((source/(f+'.html')).read_bytes()).hexdigest() for f in files},'gzip':base64.b64encode(gzip.compress(raw,mtime=0)).decode()}
target=Path(__file__).resolve().parents[2]/'apps/web/src/app/v8-templates/reference-fixtures.json'
target.write_text(json.dumps(packed,separators=(',',':'))+'\n')
print(target)
