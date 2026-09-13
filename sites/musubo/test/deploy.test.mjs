import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  publicFiles,
  remoteInstall,
  target,
  validateInitialState,
} from "../deploy-preview.mjs";

test("first-install program is valid bash and scoped to the approved host", () => {
  const script = remoteInstall("20260913083000-123456789abc");
  execFileSync("bash", ["-n"], { input: script });
  assert.equal(target, "/home/andu2021/musubo.jp/public_html");
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
    () => validateInitialState(".htaccess\n.user.ini\nindex.php", "", ""),
    /変更/,
  );
  assert.throws(
    () =>
      validateInitialState(
        ".htaccess\n.user.ini\ndefault_page.png\nindex.html",
        "changed",
        "",
      ),
    /変わって/,
  );
  assert.throws(() => remoteInstall("../../escape"), /Invalid/);
  assert.throws(() => remoteInstall("20260913;echo unsafe"), /Invalid/);
});
