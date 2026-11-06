// Static exports cannot use per-request nonces. Move only build-owned inline
// scripts to same-origin, content-addressed files before publishing the export.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function externalizeHtml(html, save) {
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (tag, attrs, code) => {
    if (/\bsrc\s*=/i.test(attrs) || !code.trim()) return tag;
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (type && !['text/javascript', 'application/javascript'].includes(type)) {
      if (type === 'application/ld+json' || type === 'application/json') return tag;
      throw new Error('Unsupported inline script in static export');
    }
    const digest = createHash('sha256').update(code).digest();
    const path = `/_next/static/csp/${digest.toString('hex')}.js`;
    save(path, code);
    return `<script${attrs} src="${path}" integrity="sha256-${digest.toString('base64')}"></script>`;
  });
}

export function externalizeExport(root) {
  let pages = 0;
  const scripts = new Set();
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== '_next') walk(path); continue; }
      if (!entry.name.endsWith('.html')) continue;
      const html = externalizeHtml(readFileSync(path, 'utf8'), (name, code) => {
        const file = join(root, name);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, code);
        scripts.add(name);
      });
      writeFileSync(path, html);
      pages++;
    }
  }
  walk(root);
  return { pages, scripts: scripts.size };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(externalizeExport(resolve(process.argv[2] ?? 'apps/web/out'))));
}
