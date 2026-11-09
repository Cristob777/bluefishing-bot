const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { cloudflareClientIp } = require("../lib/clientIp");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function composeFiles(mode) {
  const out = execFileSync("bash", ["-c", 'source deploy/hostinger/lib.sh; set_dc; printf "%s\\n" "${DC[@]}"'], {
    cwd: ROOT, env: { ...process.env, PROXY_MODE: mode, ENV_FILE: "/nonexistent" },
  }).toString();
  return out.split("\n").filter((l) => l.endsWith(".yml"));
}

test("tunnel mode stacks the nginx override (loopback only, no Traefik) plus cloudflared", () => {
  assert.deepEqual(composeFiles("tunnel"), ["docker-compose.yml", "docker-compose.nginx.yml", "docker-compose.tunnel.yml"]);
  assert.deepEqual(composeFiles("nginx"), ["docker-compose.yml", "docker-compose.nginx.yml"]);
  assert.deepEqual(composeFiles("traefik"), ["docker-compose.yml"]);
});

test("cloudflared: pinned image, token via env, hardened, on the network that reaches app and Chatwoot", () => {
  const c = read("docker-compose.tunnel.yml");
  assert.match(c, /image: cloudflare\/cloudflared:\d{4}\.\d+\.\d+/);
  assert.match(c, /TUNNEL_TOKEN: \$\{CLOUDFLARE_TUNNEL_TOKEN:\?/);
  assert.doesNotMatch(c, /--token/);
  assert.match(c, /cap_drop:\s*\n\s*- ALL/);
  assert.match(c, /no-new-privileges:true/);
  assert.match(c, /read_only: true/);
  assert.match(c, /- chatwoot/);
  assert.doesNotMatch(c, /ports:/, "the tunnel publishes nothing on the host");
});

test("preflight and installer require the tunnel token in tunnel mode", () => {
  assert.match(read("deploy/hostinger/preflight.sh"), /PROXY_MODE=tunnel requiere CLOUDFLARE_TUNNEL_TOKEN/);
  assert.match(read("deploy/hostinger/install.sh"), /CLOUDFLARE_TUNNEL_TOKEN falta \(PROXY_MODE=tunnel\)/);
});

test("CF-Connecting-IP is trusted only in tunnel mode", () => {
  const req = { headers: { "cf-connecting-ip": "200.1.2.3", "x-forwarded-for": "6.6.6.6" } };
  assert.equal(cloudflareClientIp(req, { PROXY_MODE: "tunnel" }), "200.1.2.3");
  assert.equal(cloudflareClientIp(req, { PROXY_MODE: "nginx" }), null);
  assert.equal(cloudflareClientIp(req, {}), null);
  assert.equal(cloudflareClientIp({ headers: {} }, { PROXY_MODE: "tunnel" }), null);
});
