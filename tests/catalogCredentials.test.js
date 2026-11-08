const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveCatalogCredentials } = require("../lib/catalogCredentials");

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";

function fakeDeps(connected, creds = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql) => {
      calls.push(sql);
      return { rows: connected.map((id) => ({ tenant_id: id })) };
    },
    store: {
      async getWooCredentials(id) {
        return creds[id] || null;
      },
    },
  };
}

const PANEL_CREDS = { storeUrl: "https://tienda.cl/", consumerKey: "ck_panel", consumerSecret: "cs_panel" };

test(".env keys win and never touch the database", async () => {
  const d = fakeDeps([T1], { [T1]: PANEL_CREDS });
  const c = await resolveCatalogCredentials({
    env: { WC_URL: "https://bluefishing.cl/", WC_CONSUMER_KEY: "ck_env", WC_CONSUMER_SECRET: "cs_env" },
    query: d.query, store: d.store, boxConfigured: true,
  });
  assert.equal(c.source, "env");
  assert.equal(c.storeUrl, "https://bluefishing.cl");
  assert.equal(c.consumerKey, "ck_env");
  assert.equal(d.calls.length, 0);
});

test("without .env keys, uses the single store connected from /panel", async () => {
  const d = fakeDeps([T1], { [T1]: PANEL_CREDS });
  const c = await resolveCatalogCredentials({ env: {}, query: d.query, store: d.store, boxConfigured: true });
  assert.equal(c.source, "panel");
  assert.equal(c.tenantId, T1);
  assert.equal(c.storeUrl, "https://tienda.cl");
  assert.equal(c.consumerKey, "ck_panel");
});

test("no connected store and no .env keys → null (falls back to public scraping)", async () => {
  const d = fakeDeps([]);
  assert.equal(await resolveCatalogCredentials({ env: {}, query: d.query, store: d.store, boxConfigured: true }), null);
});

test("without the credential vault configured, panel keys are not used", async () => {
  const d = fakeDeps([T1], { [T1]: PANEL_CREDS });
  assert.equal(await resolveCatalogCredentials({ env: {}, query: d.query, store: d.store, boxConfigured: false }), null);
  assert.equal(d.calls.length, 0);
});

test("several connected stores without a choice abort instead of mixing catalogs", async () => {
  const d = fakeDeps([T1, T2], { [T1]: PANEL_CREDS, [T2]: PANEL_CREDS });
  await assert.rejects(
    resolveCatalogCredentials({ env: {}, query: d.query, store: d.store, boxConfigured: true }),
    /WOO_CATALOG_TENANT_ID/
  );
});

test("WOO_CATALOG_TENANT_ID selects the store explicitly", async () => {
  const other = { storeUrl: "https://otra.cl", consumerKey: "ck_2", consumerSecret: "cs_2" };
  const d = fakeDeps([T1, T2], { [T1]: PANEL_CREDS, [T2]: other });
  const c = await resolveCatalogCredentials({ env: { WOO_CATALOG_TENANT_ID: T2 }, query: d.query, store: d.store, boxConfigured: true });
  assert.equal(c.tenantId, T2);
  assert.equal(c.storeUrl, "https://otra.cl");
  assert.equal(d.calls.length, 0);
});

test("selected tenant without a connected store is an explicit error", async () => {
  const d = fakeDeps([]);
  await assert.rejects(
    resolveCatalogCredentials({ env: { WOO_CATALOG_TENANT_ID: T1 }, query: d.query, store: d.store, boxConfigured: true }),
    /no tiene tienda WooCommerce conectada/
  );
});

test("the WooCommerce callback bypasses proxy basic auth (nginx and Traefik)", () => {
  const nginx = fs.readFileSync(path.join(__dirname, "..", "deploy", "hostinger", "nginx", "crm-bot.conf.template"), "utf8");
  const block = nginx.slice(nginx.indexOf("location = /panel/woo/callback"));
  const body = block.slice(0, block.indexOf("}\n\n") + 1);
  assert.ok(nginx.indexOf("location = /panel/woo/callback") >= 0);
  assert.doesNotMatch(body, /auth_basic/);
  assert.match(body, /limit_except POST/);

  const compose = fs.readFileSync(path.join(__dirname, "..", "docker-compose.yml"), "utf8");
  assert.match(compose, /crmbot-woo-callback\.rule: .*Path\(`\/panel\/woo\/callback`\) && Method\(`POST`\)/);
  assert.match(compose, /crmbot-woo-callback\.priority: "200"/);
  assert.doesNotMatch(compose, /crmbot-woo-callback\.middlewares/);
});
