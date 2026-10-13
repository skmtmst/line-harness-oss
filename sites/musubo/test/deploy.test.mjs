import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  publicFiles,
  remoteInstall,
  deploymentPaths,
  relativeTarget,
  validateInitialState,
} from "../deploy-preview.mjs";

test("first-install program is valid bash and scoped to the approved host", () => {
  const script = remoteInstall("20260913083000-123456789abc", "fixtureuser");
  execFileSync("bash", ["-n"], { input: script });
  assert.equal(relativeTarget, "musubo.jp/public_html/stg.musubo.jp");
  assert.equal(
    deploymentPaths("fixtureuser").target,
    "/home/fixtureuser/musubo.jp/public_html/stg.musubo.jp",
  );
  assert.match(script, /\.musubo-stg-site-deploy\.lock/);
  assert.match(script, /musubo-site-backups\/stg-/);
  assert.doesNotMatch(
    script,
    /install -m 644 [^\n]+ '\/home\/fixtureuser\/musubo\.jp\/public_html\/(?!stg\.musubo\.jp\/)/,
  );
  assert.match(script, /trap finish EXIT/);
  assert.match(script, /before\.tar\.gz/);
  assert.match(script, /sha256sum -c/);
  assert.match(script, /rmdir "\$lock"/);
  assert.doesNotMatch(script, /rm -|--delete|wrangler|\.env/);
  assert.ok(script.indexOf("tar -czf") < script.indexOf("started=1"));
  assert.ok(script.indexOf("started=1") < script.indexOf("install -m"));
  assert.equal(publicFiles.length, 11);
  assert.ok(!publicFiles.includes(".user.ini"));
  assert.ok(!publicFiles.includes("default_page.png"));
});

test("foreign files, changed initial files and invalid IDs fail closed", () => {
  assert.throws(
    () => validateInitialState(".htaccess\n.user.ini\nindex.php", ""),
    /変更/,
  );
  assert.throws(
    () =>
      validateInitialState(
        ".user.ini\ndefault_page.png\nindex.html",
        "changed",
      ),
    /変わって/,
  );
  assert.throws(() => remoteInstall("../../escape"), /Invalid/);
  assert.throws(() => remoteInstall("20260913;echo unsafe"), /Invalid/);
  assert.throws(() => deploymentPaths("../escape"), /MUSUBO_XSERVER_USER/);
  assert.throws(
    () => deploymentPaths("user;echo unsafe"),
    /MUSUBO_XSERVER_USER/,
  );
  assert.throws(() => deploymentPaths(), /MUSUBO_XSERVER_USER/);
});

test("the audited subdomain initial state is accepted but an existing htaccess is protected", () => {
  const hash =
    "3be3cd528345bb63771b934886d37c3c9011400095f0506ae3e596cea4ff6190";
  const names = ".user.ini\ndefault_page.png\nindex.html";
  assert.doesNotThrow(() => validateInitialState(names, hash));
  assert.throws(
    () => validateInitialState(names + "\n.htaccess", hash),
    /変更/,
  );
});

test("update program for the installed review site is valid bash, verified, backed up and self-restoring", async () => {
  const {
    remoteUpdate,
    validateInstalledState,
    validateChecksums,
    isInitialState,
    installedRootNames,
    installedFiles,
  } = await import("../deploy-preview.mjs");
  const sums = publicFiles.map((f, i) => `${String(i).padStart(64, "a")}  ${f}`).join("\n");
  const script = remoteUpdate("20261013083000-123456789abc", "fixtureuser", sums);
  execFileSync("bash", ["-n"], { input: script });
  assert.match(script, /\.musubo-stg-site-deploy\.lock/);
  assert.match(script, /musubo-site-backups\/stg-/);
  assert.doesNotMatch(
    script,
    /install -m 644 [^\n]+ '\/home\/fixtureuser\/musubo\.jp\/public_html\/(?!stg\.musubo\.jp\/)/,
  );
  assert.doesNotMatch(script, /rm -|--delete|wrangler|\.env/);
  assert.match(script, /trap finish EXIT/);
  assert.match(script, /BEFORE_SHA256SUMS/);
  assert.ok(script.indexOf("tar -czf") < script.indexOf("started=1"));
  assert.ok(script.indexOf("sha256sum -c SHA256SUMS") < script.indexOf("started=1"));
  const firstInstallToSite = script.search(/install -m 644 '[^']+\/payload\/[^']+' '\/home\/fixtureuser\/musubo\.jp\/public_html\/stg\.musubo\.jp\//);
  assert.ok(firstInstallToSite > script.indexOf("started=1"));
  assert.throws(() => remoteUpdate("../../escape", "fixtureuser", sums), /Invalid/);
  assert.throws(() => validateChecksums("bad"), /全件|形式/);
  assert.throws(
    () => validateChecksums(sums.replace("index.html", "../index.html")),
    /形式/,
  );

  assert.equal(isInitialState(".user.ini\ndefault_page.png\nindex.html"), true);
  assert.equal(isInitialState(installedRootNames.join("\n")), false);
  const ok = { rootNames: installedRootNames.join("\n"), files: installedFiles.join("\n"), symlinks: "" };
  assert.doesNotThrow(() => validateInstalledState(ok));
  assert.throws(() => validateInstalledState({ ...ok, rootNames: ok.rootNames + "\nindex.php" }), /想定外/);
  assert.throws(() => validateInstalledState({ ...ok, files: ok.files + "\nassets/extra.js" }), /想定外/);
  assert.throws(() => validateInstalledState({ ...ok, symlinks: "index.html" }), /シンボリック/);
});
