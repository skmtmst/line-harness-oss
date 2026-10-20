import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, dirname, extname, basename, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

export type Finding = { source: string; target: string; problem: string };
export type Link = { target: string; line: number };
const prose = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc']);
const normalize = (path: string) => path.split(sep).join('/');

/** Enumerate actual files, including newly added files; never follow symlinks. */
export function filesBelow(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (['.git', 'node_modules', '.next', 'out', 'dist', '.wrangler'].includes(entry.name)) return [];
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? filesBelow(path) : entry.isFile() ? [path] : [];
  });
}

export function isProse(path: string): boolean {
  return prose.has(extname(path).toLowerCase()) || /^(README|BEHAVIOR|NOTES|TODO)$/i.test(basename(path));
}

export function repositoryFiles(root: string): string[] {
  if (!existsSync(resolve(root, '.git'))) return filesBelow(root);
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean).map((p) => resolve(root, p)).filter((p) => existsSync(p) && statSync(p).isFile());
}

export function isDocument(root: string, path: string): boolean {
  const name = normalize(relative(root, path));
  return name.startsWith('docs/') || isProse(path)
    || name.startsWith('apps/web/public/manuals/') || name.startsWith('apps/docs/public/manual/');
}

/** Extract navigation, not example code. Keep line numbers for actionable errors. */
export function linksIn(text: string): Link[] {
  let fence = '';
  const lines = text.split('\n').map((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = '';
      return '';
    }
    return fence ? '' : line;
  });
  const definitions = new Map<string, string>();
  const key = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const destination = (s: string) => {
    if (s.startsWith('<')) return s.slice(1, s.indexOf('>'));
    return s.replace(/\s+["'].*$/, '').trim().replace(/\\([() ])/g, '$1');
  };
  for (const line of lines) {
    const match = /^\s{0,3}\[([^\]]+)\]:\s*(.+)$/.exec(line);
    if (match) definitions.set(key(match[1]), destination(match[2]));
  }
  const links: Link[] = [];
  lines.forEach((original, index) => {
    // Inline code and HTML comments are quotations, not links.
    const line = original.replace(/`+[^`]*`+/g, '').replace(/<!--.*?-->/g, '');
    if (/^\s{0,3}\[[^\]]+\]:/.test(line)) return;
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== '[' || line[i - 1] === '\\') continue;
      const close = line.indexOf(']', i + 1);
      if (close < 0) continue;
      const label = line.slice(i + 1, close);
      let target: string | undefined;
      let end = close;
      if (line[close + 1] === '(') {
        let depth = 1;
        let angle = false;
        end = close + 2;
        for (; end < line.length; end++) {
          if (line[end - 1] === '\\') continue;
          if (line[end] === '<') angle = true;
          if (line[end] === '>') angle = false;
          if (!angle && line[end] === '(') depth++;
          if (!angle && line[end] === ')' && --depth === 0) break;
        }
        if (end < line.length) target = destination(line.slice(close + 2, end));
      } else if (line[close + 1] === '[') {
        end = line.indexOf(']', close + 2);
        if (end >= 0) {
          const id = line.slice(close + 2, end) || label;
          target = definitions.get(key(id));
          if (!target) links.push({ target: `reference:${id}`, line: index + 1 });
        }
      } else target = definitions.get(key(label));
      if (target !== undefined) links.push({ target, line: index + 1 });
      i = Math.max(close, end);
    }
    for (const match of line.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
      links.push({ target: match[1].replace(/&amp;/g, '&'), line: index + 1 });
    }
  });
  return links;
}

export function localTarget(root: string, source: string, target: string): string | null {
  if (!target || /^(?:[a-z][a-z\d+.-]*:|#|\{)/i.test(target)) return null;
  let path: string;
  try { path = decodeURIComponent(target.split(/[?#]/, 1)[0]); }
  catch { return resolve(root, '__invalid_url_encoding__'); }
  if (path.startsWith('/')) {
    // /docs names repository documents; other root paths name app routes or sites.
    if (path !== '/docs' && !path.startsWith('/docs/')) return null;
    return resolve(root, `.${path}`);
  }
  return resolve(dirname(source), path);
}

/** Every document is catalogued once; every local navigation target exists. */
export function auditCatalog(root: string): Finding[] {
  const all = repositoryFiles(root);
  const index = resolve(root, 'docs/README.md');
  if (!existsSync(index)) return [{ source: 'docs/README.md', target: '', problem: '文書の入口がない' }];
  const documents = all.filter((p) => isDocument(root, p));
  const counts = new Map<string, number>();
  for (const link of linksIn(readFileSync(index, 'utf8'))) {
    const target = localTarget(root, index, link.target);
    if (target) counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  const findings: Finding[] = [];
  for (const file of documents) {
    if ((counts.get(file) ?? 0) !== 1) findings.push({
      source: 'docs/README.md', target: normalize(relative(root, file)), problem: '入口への掲載は1回必要',
    });
    if (!isProse(file) && extname(file) !== '.html') continue;
    for (const link of linksIn(readFileSync(file, 'utf8'))) {
      if (link.target.startsWith('reference:')) {
        findings.push({ source: `${normalize(relative(root, file))}:${link.line}`, target: link.target, problem: '参照リンクの定義がない' });
        continue;
      }
      const target = localTarget(root, file, link.target);
      if (target && (!existsSync(target) || relative(root, target).startsWith('..'))) findings.push({
        source: `${normalize(relative(root, file))}:${link.line}`, target: link.target, problem: 'ローカルリンクの行き先がない',
      });
      if (file === index && target && existsSync(target) && !statSync(target).isFile()) findings.push({
        source: `docs/README.md:${link.line}`, target: link.target, problem: '入口は文書ファイルへ直接つなぐ',
      });
    }
  }
  return findings;
}
