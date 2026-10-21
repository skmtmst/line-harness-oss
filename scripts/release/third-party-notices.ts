import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface LicenseEntry { paths: string[] }
interface DependencyManifest { name: string; version: string; license?: string }
interface NoticeText {
  name: string;
  text: string;
  source: { path: string; sha256: string; startLine: number; endLine: number };
  coversDeclaredLicense: boolean;
}
export interface NoticePackage extends DependencyManifest { texts: NoticeText[] }

/** Recognize complete grants, not a license name, badge or external link. */
function permissionKind(text: string): string | undefined {
  const plain = text.replace(/^\s*(?:\/\/|\*\/?|\/\*)\s?/gm, '').replace(/\s+/g, ' ');
  if (/permission is hereby granted/i.test(plain) && /copyright/i.test(plain)
    && /the above copyright notice and this permission notice/i.test(plain)
    && /the software is provided ["']as is["']/i.test(plain)
    && /the use or other dealings in the software/i.test(plain)) return 'MIT';
  if (/redistribution and use in source and binary forms/i.test(plain)
    && /redistributions of source code must retain/i.test(plain)
    && /redistributions in binary form must reproduce/i.test(plain)
    && /copyright/i.test(plain) && /this software is provided/i.test(plain)
    && /even if advised of the possibility of such damage/i.test(plain)) {
    return /neither the name/i.test(plain) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  }
  if (/released as ["']public domain["']/i.test(plain)
    && /copy, modify, re-release and re-license/i.test(plain)
    && /without restriction of any kind/i.test(plain)) return 'Public domain';
  return undefined;
}

function readmeLicenseSection(source: string): { text: string; startLine: number; endLine: number } | undefined {
  const lines = source.split('\n');
  const title = /^\s*(?:#{1,6}\s+)?Licen[cs]e(?:\s+\([^)]*\))?\s*#*\s*$/i;
  const start = lines.findIndex((line, index) => title.test(line)
    && (/^\s*#/.test(line) || /^\s*[-=]{3,}\s*$/.test(lines[index + 1] ?? '')));
  if (start < 0) return undefined;
  let end = lines.length;
  for (let i = start + 2; i < lines.length; i++) {
    if (/^\s*#{1,6}\s+\S/.test(lines[i]!)
      || (/\S/.test(lines[i]!) && /^\s*[-=]{3,}\s*$/.test(lines[i + 1] ?? ''))) { end = i; break; }
  }
  return { text: lines.slice(start, end).join('\n'), startLine: start + 1, endLine: end };
}

function noticeText(name: string, source: Buffer, text = source.toString('utf8'), startLine = 1, coversDeclaredLicense = true): NoticeText {
  return { name, text, coversDeclaredLicense, source: { path: name,
    sha256: createHash('sha256').update(source).digest('hex'), startLine,
    endLine: startLine + text.split('\n').length - 1 } };
}

const needsReview = (pkg: NoticePackage) => !pkg.texts.some(text => text.coversDeclaredLicense);

/** pnpm's report may group several versions: read each installed manifest. */
export function collectNoticePackages(report: Record<string, LicenseEntry[]>, root: string): NoticePackage[] {
  const modules = realpathSync(join(root, 'node_modules'));
  const packages = new Map<string, NoticePackage>();
  for (const entry of Object.values(report).flat()) {
    for (const path of entry.paths) {
      const base = realpathSync(path);
      const rel = relative(modules, base);
      // Workspace sources are covered by the root LICENSE. Never follow a report outside dependencies.
      if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) continue;
      const manifest = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')) as DependencyManifest;
      const key = `${manifest.name}@${manifest.version}`;
      const pkg = packages.get(key) ?? { ...manifest, texts: [] };
      const named = typeof manifest.license === 'string' ? /^SEE LICENSE IN (.+)$/i.exec(manifest.license)?.[1] : undefined;
      const files = readdirSync(base, { withFileTypes: true }).filter(item => item.isFile());
      const names = files.filter(item =>
        /^(?:licen[cs]e|copying|notice|copyright)(?:[.-]|$)/i.test(item.name) || item.name === named);
      for (const item of names) {
        const source = readFileSync(join(base, item.name));
        if (!pkg.texts.some(existing => existing.text === source.toString('utf8'))) pkg.texts.push(noticeText(item.name, source));
      }
      for (const item of files) {
        if (names.includes(item) || statSync(join(base, item.name)).size > 1024 * 1024) continue;
        const isReadme = /^readme(?:\.(?:md|markdown|txt))?$/i.test(item.name);
        const isSource = /\.(?:[cm]?js|ts)$/.test(item.name);
        if (!isReadme && !isSource) continue;
        const bytes = readFileSync(join(base, item.name));
        const source = bytes.toString('utf8');
        const section = isReadme ? readmeLicenseSection(source) : undefined;
        const header = isSource ? /^\s*(?:\/\*[\s\S]*?\*\/|(?:\/\/[^\n]*(?:\n|$))+)/.exec(source)?.[0] : undefined;
        const text = section?.text ?? header;
        const kind = text && permissionKind(text);
        if (!text || !kind || pkg.texts.some(existing => existing.text === text)) continue;
        // A source header covers that file, which may be borrowed code. Keep
        // it as supplementary evidence, not a package-wide permission claim.
        pkg.texts.push(noticeText(item.name, bytes, text, section?.startLine ?? 1, isReadme && kind === manifest.license));
      }
      packages.set(key, pkg);
    }
  }
  return [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
}

/** Includes declarations verbatim; it does not assert ownership or legal clearance. */
export function renderNotices(packages: NoticePackage[], version: string, lockHash: string) {
  const text = [
    'Third-party notices for musubo',
    `Version: ${version}\nLockfile SHA-256: ${lockHash}`,
    'Scope: installed workspace dependencies, including build/dev dependencies that may be bundled. Platform-optional packages absent on this build host, external assets, and prebuilt vendored bundles are not certified by this inventory.',
    ...packages.map(pkg => [
      `=== ${pkg.name}@${pkg.version} ===`,
      `Declared license: ${typeof pkg.license === 'string' ? pkg.license : 'NOASSERTION'}`,
      ...pkg.texts.map(item => `--- ${item.name} ---\nSource: ${item.source.path}:${item.source.startLine}-${item.source.endLine}\nSource SHA-256: ${item.source.sha256}\n${item.text}`),
      ...(needsReview(pkg) ? ['No license text found covering the package declaration. Supplementary notices, if any, do not resolve this review. Review the upstream distribution before redistribution.'] : []),
    ].join('\n')),
  ].join('\n\n') + '\n';
  const bom = {
    bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
    metadata: { component: { type: 'application', name: 'musubo', version }, properties: [
      { name: 'musubo:lockfile:sha256', value: lockHash },
      { name: 'musubo:inventory:scope', value: 'Installed workspace dependencies including build/dev packages; excludes absent optional packages, external assets and vendored bundles. Not a license clearance.' },
    ] },
    components: packages.map(pkg => ({
      type: 'library', 'bom-ref': `${pkg.name}@${pkg.version}`, name: pkg.name, version: pkg.version,
      ...(typeof pkg.license === 'string' ? { licenses: [{ license: { name: pkg.license } }] } : {}),
      properties: [{ name: 'musubo:license-text:status', value: needsReview(pkg) ? 'review-required' : 'included-in-notices' }],
    })),
  };
  return { text, bom };
}

export function generateNotices(root: string, outDir: string): void {
  const report = JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--json'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  const packages = collectNoticePackages(report, root);
  if (!packages.length) throw new Error('No installed workspace dependencies found; install the frozen lockfile first.');
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  const lockHash = createHash('sha256').update(readFileSync(join(root, 'pnpm-lock.yaml'))).digest('hex');
  const { text, bom } = renderNotices(packages, version, lockHash);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'LICENSE'), readFileSync(join(root, 'LICENSE')));
  writeFileSync(join(outDir, 'THIRD-PARTY-NOTICES.txt'), text);
  writeFileSync(join(outDir, 'sbom.cdx.json'), JSON.stringify(bom, null, 2) + '\n');
  console.log(`Recorded ${packages.length} workspace dependencies; ${packages.filter(needsReview).length} require license-text review.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  generateNotices(process.cwd(), resolve(process.argv[2] ?? 'dist/notices'));
}
