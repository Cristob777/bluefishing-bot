const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const REQUIRED = ["BOT_DOMAIN", "POSTGRES_PASSWORD", "OPENAI_API_KEY", "VERIFY_TOKEN", "META_APP_SECRET", "WHATSAPP_TOKEN",
  "PHONE_NUMBER_ID", "HEALTHCHECK_TOKEN", "LOG_HASH_KEY", "ADMIN_DASHBOARD_USER", "ADMIN_DASHBOARD_PASSWORD",
  "ADMIN_SESSION_SECRET", "TRAEFIK_ADMIN_BASICAUTH_USERS", "CHATWOOT_DOMAIN", "CHATWOOT_SECRET_KEY_BASE",
  "CHATWOOT_POSTGRES_PASSWORD", "CHATWOOT_REDIS_PASSWORD", "CHATWOOT_ADMIN_EMAIL", "CHATWOOT_WEBHOOK_SECRET"];

function readEnv(file) {
  return Object.fromEntries(fs.readFileSync(file, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
}

test("init-env.sh fills every variable install.sh requires, without overwriting", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "initenv-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  // htpasswd -nbB USER PASS
  fs.writeFileSync(path.join(bin, "htpasswd"), '#!/bin/sh\necho "$2:\\$2y\\$05\\$testhashtesthashtesthashtesthashtesthashtesthashtes"\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ENV_FILE: path.join(dir, ".env"), SECRETS_DIR: path.join(dir, "secrets") };
  const answers = "\n\nops@example.cl\n\nS\nsk-x\nsecret-x\ntoken-x\n123456789\n";
  const out = execFileSync("bash", ["deploy/hostinger/init-env.sh"], { cwd: ROOT, env, input: answers }).toString();
  assert.doesNotMatch(out, /sk-x|secret-x|token-x/, "external secrets must never be echoed");

  const first = readEnv(env.ENV_FILE);
  for (const k of REQUIRED) assert.ok(first[k] && !first[k].startsWith("CHANGE_ME"), `${k} missing`);
  assert.equal(first.PROXY_MODE, "nginx");
  assert.match(first.CREDENTIALS_MASTER_KEY, /^[0-9a-f]{64}$/);
  assert.ok(first.PANEL_SESSION_SECRET.length >= 32);
  assert.match(first.TRAEFIK_ADMIN_BASICAUTH_USERS, /^operador:\$\$2y\$\$05\$\$/, "compose needs $$");
  assert.equal(fs.statSync(env.ENV_FILE).mode & 0o777, 0o600);
  const creds = fs.readFileSync(path.join(env.SECRETS_DIR, "credenciales-iniciales"), "utf8");
  assert.match(creds, /\/admin {2}usuario=admin/);
  assert.equal(fs.statSync(path.join(env.SECRETS_DIR, "credenciales-iniciales")).mode & 0o777, 0o600);

  execFileSync("bash", ["deploy/hostinger/init-env.sh"], { cwd: ROOT, env, input: "" });
  assert.deepEqual(readEnv(env.ENV_FILE), first, "second run must not change anything");
});
