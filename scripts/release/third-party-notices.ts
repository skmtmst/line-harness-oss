import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface LicenseEntry { paths: string[] }
interface DependencyManifest { name: string; version: string; license?: string }
export interface NoticePackage extends DependencyManifest { texts: Array<{ name: string; text: string }> }

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
      const names = readdirSync(base, { withFileTypes: true }).filter(item => item.isFile()
        && (/^(?:licen[cs]e|copying|notice|copyright)(?:[.-]|$)/i.test(item.name) || item.name === named));
      for (const item of names) {
        const text = readFileSync(join(base, item.name), 'utf8');
        if (!pkg.texts.some(existing => existing.text === text)) pkg.texts.push({ name: item.name, text });
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
      ...(pkg.texts.length ? pkg.texts.map(item => `--- ${item.name} ---\n${item.text}`)
        : ['No license text found at the package root. Review the upstream distribution before redistribution.']),
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
      properties: [{ name: 'musubo:license-text:status', value: pkg.texts.length ? 'included-in-notices' : 'review-required' }],
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
  console.log(`Recorded ${packages.length} workspace dependencies; ${packages.filter(pkg => !pkg.texts.length).length} require license-text review.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  generateNotices(process.cwd(), resolve(process.argv[2] ?? 'dist/notices'));
}
