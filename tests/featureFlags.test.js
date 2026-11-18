const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { panelEnabled } = require("../lib/featureFlags");

test("panel is off unless PANEL_ENABLED is explicitly true", () => {
  assert.equal(panelEnabled({}), false);
  assert.equal(panelEnabled({ PANEL_ENABLED: "" }), false);
  assert.equal(panelEnabled({ PANEL_ENABLED: "false" }), false);
  assert.equal(panelEnabled({ PANEL_ENABLED: "0" }), false);
  assert.equal(panelEnabled({ PANEL_ENABLED: "true" }), true);
  assert.equal(panelEnabled({ PANEL_ENABLED: " TRUE " }), true);
  assert.equal(panelEnabled({ PANEL_ENABLED: "1" }), true);
});

test("server routes /panel through the flag before the handler", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const branch = server.slice(server.indexOf('url.pathname === "/panel"'), server.indexOf('url.pathname === "/admin"'));
  assert.match(branch, /if \(!panelEnabled\(\)\)/);
  assert.ok(branch.indexOf("panelEnabled()") < branch.indexOf("panelHandler("));
});

test("compose declares a recurring catalog-sync service on the runtime volume", () => {
  const compose = fs.readFileSync(path.join(__dirname, "..", "docker-compose.yml"), "utf8");
  const start = compose.indexOf("\n  catalog-sync:");
  assert.ok(start > 0, "catalog-sync service missing");
  const svc = compose.slice(start, compose.indexOf("\n  atomic-crm-sync:"));
  assert.match(svc, /scripts\/sync-catalogo\.js/);
  assert.match(svc, /scripts\/enrich-catalogo\.js/);
  assert.match(svc, /catalogo_runtime:\/app\/data\/catalogo/);
  assert.match(svc, /CATALOG_RUNTIME_DIR: \/app\/data\/catalogo/);
  assert.match(svc, /scripts\/woo-orders-sync\.js/);
  assert.match(svc, /sleep/);
});

test("backup includes the catalog runtime volume", () => {
  const backup = fs.readFileSync(path.join(__dirname, "..", "deploy", "hostinger", "backup_bluefishing.sh"), "utf8");
  assert.match(backup, /catalogo-runtime-\$TS\.tar\.gz/);
});
