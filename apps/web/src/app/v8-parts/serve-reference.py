"""Serve a production export alongside unmodified Pencil HTML for local verification.
Run: python3 apps/web/src/app/v8-parts/serve-reference.py --port 3116
"""
from argparse import ArgumentParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

parser = ArgumentParser()
parser.add_argument('--port', type=int, default=3116)
parser.add_argument('--references', type=Path, default=Path.home() / 'lh-work/design/v8/parts')
args = parser.parse_args()
web = Path(__file__).resolve().parents[3]
export = web / 'out'

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(export), **kw)

    def translate_path(self, path):
        route = urlsplit(path).path
        prefix = '/v8-parts/reference/'
        if route.startswith(prefix):
            filename = route[len(prefix):]
            if '/' not in filename and filename.endswith('.html') and filename[:-5].isalnum():
                return str(args.references / filename)
        target = super().translate_path(path)
        if not Path(target).exists() and Path(target + '.html').is_file():
            return target + '.html'
        return target

server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
print(f'V8 badges preview: http://127.0.0.1:{server.server_address[1]}/v8-parts', flush=True)
server.serve_forever()
