import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
  createReadStream,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseBundleStream, verifyBundleHashes, verifyBundleIntegrity } from '../../packages/update-engine/src/bundle.js';
import { buildBundle } from './build-bundle.js';

function makeTmpDir(prefix = 'build-bundle-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

interface Fixture {
  root: string;
  workerJs: string;
  workerAssetsDir: string;
  adminDir: string;
  liffDir: string;
  migrationsDir: string;
  noticesDir: string;
  outPath: string;
}

function makeFixture(): Fixture {
  const root = makeTmpDir();

  // Worker bundled JS (single file).
  const workerJs = join(root, 'worker-dist', 'index.js');
  mkdirSync(join(root, 'worker-dist'), { recursive: true });
  writeFileSync(workerJs, '// fake worker bundle\nexport default {};\n');

  const workerAssetsDir = join(root, 'worker-assets');
  mkdirSync(workerAssetsDir, {recursive:true});
  writeFileSync(join(workerAssetsDir, 'index.html'), '<html>Worker LIFF</html>');
  // Admin static export.
  const adminDir = join(root, 'admin-out');
  mkdirSync(adminDir, { recursive: true });
  writeFileSync(join(adminDir, 'index.html'), '<html><body>admin</body></html>');
  mkdirSync(join(adminDir, 'assets'), { recursive: true });
  writeFileSync(join(adminDir, 'assets', 'app.js'), 'console.log("admin");');

  // LIFF static export.
  const liffDir = join(root, 'liff-dist');
  mkdirSync(liffDir, { recursive: true });
  writeFileSync(join(liffDir, 'index.html'), '<html><body>liff</body></html>');

  // Migrations.
  const migrationsDir = join(root, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(join(migrationsDir, '041_x.sql'), 'CREATE TABLE foo (id INTEGER);');
  writeFileSync(join(migrationsDir, '042_y.sql'), 'CREATE TABLE bar (id INTEGER);');

  // Note: outPath has a non-existent parent ('dist/'), so the test also
  // exercises the `mkdirSync(dirname(outPath), { recursive: true })` branch.
  const outPath = join(root, 'dist', 'bundle.tar.gz');
  const noticesDir = join(root, 'notices');
  mkdirSync(noticesDir);
  writeFileSync(join(noticesDir, 'LICENSE'), 'Fixture permission');
  writeFileSync(join(noticesDir, 'THIRD-PARTY-NOTICES.txt'), 'Fixture attribution');
  writeFileSync(join(noticesDir, 'sbom.cdx.json'), '{}');

  return { root, workerJs, workerAssetsDir, adminDir, liffDir, migrationsDir, noticesDir, outPath };
}

describe('buildBundle', () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = makeFixture();
  });

  afterEach(() => {
    rmSync(fx.root, { recursive: true, force: true });
  });

  it('creates a tarball at outPath (and mkdirs the parent dir)', () => {
    buildBundle({
      workerJs: fx.workerJs,
      workerAssetsDir: fx.workerAssetsDir,
      adminDir: fx.adminDir,
      liffDir: fx.liffDir,
      migrationsDir: fx.migrationsDir,
      noticesDir: fx.noticesDir,
      outPath: fx.outPath,
    });

    expect(existsSync(fx.outPath)).toBe(true);
    expect(statSync(fx.outPath).size).toBeGreaterThan(0);
  });

  it('tarball contains worker/admin/liff/migrations entries with the expected relative paths', () => {
    buildBundle({
      workerJs: fx.workerJs,
      workerAssetsDir: fx.workerAssetsDir,
      adminDir: fx.adminDir,
      liffDir: fx.liffDir,
      migrationsDir: fx.migrationsDir,
      noticesDir: fx.noticesDir,
      outPath: fx.outPath,
    });

    const listing = execSync(`tar tzf ${fx.outPath}`, { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    // Each of the 4 trees must appear at the top level of the archive.
    expect(listing).toContain('worker/index.js');
    expect(listing).toContain('worker-assets/index.html');
    expect(listing).toContain('admin/index.html');
    expect(listing).toContain('admin/assets/app.js');
    expect(listing).toContain('liff/index.html');
    expect(listing).toContain('migrations/041_x.sql');
    expect(listing).toContain('migrations/042_y.sql');
    expect(listing).toContain('notices/LICENSE');
    expect(listing).toContain('notices/THIRD-PARTY-NOTICES.txt');
    expect(listing).toContain('notices/sbom.cdx.json');
    expect(execSync(`tar xOzf ${fx.outPath} notices/LICENSE`, { encoding: 'utf8' })).toBe('Fixture permission');

    // Sanity: no absolute paths leaked into the archive.
    for (const entry of listing) {
      expect(entry.startsWith('/')).toBe(false);
      expect(entry).not.toMatch(/(^|\/)\.\.(\/|$)/);
    }
  });

  it('does not crash when migrations dir is empty', () => {
    // Wipe and recreate as empty.
    rmSync(fx.migrationsDir, { recursive: true, force: true });
    mkdirSync(fx.migrationsDir, { recursive: true });

    buildBundle({
      workerJs: fx.workerJs,
      workerAssetsDir: fx.workerAssetsDir,
      adminDir: fx.adminDir,
      liffDir: fx.liffDir,
      migrationsDir: fx.migrationsDir,
      noticesDir: fx.noticesDir,
      outPath: fx.outPath,
    });

    expect(existsSync(fx.outPath)).toBe(true);

    const listing = execSync(`tar tzf ${fx.outPath}`, { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    // Worker/admin/liff still present.
    expect(listing).toContain('worker/index.js');
    expect(listing).toContain('worker-assets/index.html');
    expect(listing).toContain('admin/index.html');
    expect(listing).toContain('liff/index.html');

    // migrations/ tree exists but contains no .sql files.
    expect(listing.some((p) => p === 'migrations/' || p === 'migrations')).toBe(true);
    expect(listing.some((p) => p.endsWith('.sql'))).toBe(false);
  });

  it('releaseのCLI引数を通したhashと梱包した全成果物が一致する', async()=>{
    const flags=['--worker-js',fx.workerJs,'--worker-assets',fx.workerAssetsDir,'--admin',fx.adminDir,'--liff',fx.liffDir,'--migrations',fx.migrationsDir,'--notices',fx.noticesDir,'--out',fx.outPath];
    execFileSync(process.execPath,['--import','tsx',fileURLToPath(new URL('./build-bundle.ts',import.meta.url)),...flags],{stdio:'pipe'});
    const output=execFileSync(process.execPath,['--import','tsx',fileURLToPath(new URL('../../apps/worker/scripts/inject-version.ts',import.meta.url)),
      '--version','1.0.0','--worker',fx.workerJs,'--worker-assets',fx.workerAssetsDir,'--admin',fx.adminDir,'--liff',fx.liffDir,'--migrations',fx.migrationsDir,
      '--commit','0000000000000000000000000000000000000000','--out',join(fx.root,'release-version.ts')],{encoding:'utf8'});
    const stamped=JSON.parse(output);
    const parsed=await parseBundleStream(createReadStream(fx.outPath));
    expect(()=>verifyBundleIntegrity(verifyBundleHashes(parsed),{version:'1.0.0',worker_bundle_hash:stamped.workerHash,worker_assets_hash:stamped.workerAssetsHash,migrations_hash:stamped.migrationsHash,admin_hash:stamped.adminHash,liff_hash:stamped.liffHash})).not.toThrow();
    expect(parsed.migrations.size).toBe(2);
  });

  it('does not publish a bundle without its attribution documents', () => {
    rmSync(join(fx.noticesDir, 'THIRD-PARTY-NOTICES.txt'));
    expect(() => buildBundle(fx)).toThrow();
    expect(existsSync(fx.outPath)).toBe(false);
  });
});
