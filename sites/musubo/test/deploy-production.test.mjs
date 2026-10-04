import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  deploymentPaths,
  expectedApexFiles,
  expectedRootNames,
  publicFiles,
  relativeTarget,
  remoteInstall,
  validateProductionHtml,
  validateRemoteState,
} from "../deploy-production.mjs";

const checksums = publicFiles
  .map((file, index) => `${String(index).padStart(64, "0")}  ${file}`)
  .join("\n");

test("production deploy program is valid bash and scoped to the apex", () => {
  const script = remoteInstall(
    "20261005083000-123456789abc",
    "fixtureuser",
    checksums,
  );
  execFileSync("bash", ["-n"], { input: script });
  assert.equal(relativeTarget, "musubo.jp/public_html");
  assert.equal(
    deploymentPaths("fixtureuser").target,
    "/home/fixtureuser/musubo.jp/public_html",
  );
  assert.match(script, /\.musubo-production-site-deploy\.lock/);
  assert.match(script, /musubo-site-backups\/production-/);
  assert.match(script, /trap finish EXIT/);
  assert.match(script, /readlink -f/);
  assert.match(script, /before\.tar\.gz/);
  assert.match(script, /sha256sum -c/);
  assert.match(script, /rmdir "\$lock"/);
  assert.match(script, /failed-output/);
  assert.match(script, /\/before\/privacy\/index\.html/);
  assert.match(script, /--exclude='\.\/stg\.musubo\.jp'/);
  assert.doesNotMatch(script, /rsync --delete|rm -|wrangler|\.env/);
  assert.ok(script.indexOf("tar -czf") < script.indexOf("started=1"));
  assert.match(script, /started=1\ninstall -m 644 '[^']+\/payload\//);
  assert.equal(publicFiles.length, 11);
  assert.ok(!publicFiles.includes(".user.ini"));
  assert.ok(!publicFiles.includes("default_page.png"));
});

test("only the audited apex inventory is accepted", () => {
  const state = {
    rootNames: expectedRootNames.join("\n"),
    apexFiles: expectedApexFiles.join("\n"),
    symlinks: "",
  };
  assert.doesNotThrow(() => validateRemoteState(state));
  assert.throws(
    () => validateRemoteState({ ...state, rootNames: `${state.rootNames}\nmanual.txt` }),
    /想定外/,
  );
  assert.throws(
    () => validateRemoteState({ ...state, apexFiles: state.apexFiles.replace("index.html", "") }),
    /想定外/,
  );
  assert.throws(
    () => validateRemoteState({ ...state, symlinks: "privacy/index.html" }),
    /シンボリックリンク/,
  );
});

test("production markers are required and staging markers fail closed", () => {
  const legal = "<p>施行日：2026-10-04</p><p>28日後に削除</p>";
  assert.doesNotThrow(() =>
    validateProductionHtml("privacy/index.html", legal, {
      effectiveDate: true,
      retention: true,
    }),
  );
  assert.throws(
    () =>
      validateProductionHtml("privacy/index.html", "施行日：2026-10-03", {
        effectiveDate: true,
      }),
    /新しい法務文面/,
  );
  assert.throws(
    () =>
      validateProductionHtml("privacy/index.html", "施行日：2026-10-04", {
        retention: true,
      }),
    /新しい削除期限/,
  );
  for (const marker of ["noindex", "確認用サイト", "stg.musubo.jp"])
    assert.throws(
      () => validateProductionHtml("index.html", marker),
      /staging用/,
    );
});

test("invalid users, release IDs and checksum lists fail closed", () => {
  assert.throws(() => deploymentPaths("../escape"), /MUSUBO_XSERVER_USER/);
  assert.throws(() => deploymentPaths("user;echo unsafe"), /MUSUBO_XSERVER_USER/);
  assert.throws(() => deploymentPaths(), /MUSUBO_XSERVER_USER/);
  assert.throws(
    () => remoteInstall("../../escape", "fixtureuser", checksums),
    /Invalid/,
  );
  assert.throws(
    () => remoteInstall("20261005083000-123456789abc", "fixtureuser", "bad"),
    /ハッシュ/,
  );
});
