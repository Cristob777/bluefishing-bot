// Simuladores HTTP de los servicios externos: OpenAI, Bsale, Meta Graph, Chatwoot.
const http = require("node:http");
const fs = require("node:fs");
const LOG = process.env.E2E_MOCK_LOG || require("node:path").join(__dirname, ".mock-log.jsonl");
fs.writeFileSync(LOG, "");
const rec = (o) => fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...o }) + "\n");
const stock = { "CHACAO-235": 3, "GRAPHITE-JIGGING-182": 0 };
const today = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) / 1000);
http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
    const u = new URL(req.url, "http://x"); const p = u.pathname;
    const json = (code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    // ---- OpenAI Responses API
    if (p === "/openai/v1/responses") {
      const b = JSON.parse(body || "{}"); const all = JSON.stringify(b);
      let text;
      if (all.includes("known_context")) {
        rec({ svc: "openai", kind: "classifier" });
        text = "<classification><intent>pedir_recomendacion</intent><confidence>0.9</confidence><ambiguity_flag>false</ambiguity_flag>" +
          "<extracted_context><product_type>caña</product_type><water_type>mar</water_type><fishing_position>roca</fishing_position><technique>popping</technique><brand_preference>badfish</brand_preference><budget_range>hasta 80000</budget_range><purchase_intent_level>media</purchase_intent_level></extracted_context>" +
          "<next_best_question></next_best_question><reasoning_summary>ok</reasoning_summary></classification>";
      } else {
        const raw = JSON.parse(all.replace(/^"|"$/g, "") ? all : "{}");
        const flat = all.replace(/\\n/g, "\n").replace(/\\"/g, '"');
        const line = (flat.match(/\nP1[^\n]*/) || [""])[0];
        const name = line.replace(/^\nP1\W*/, "").split("|")[0].trim();
        const price = (line.match(/\$[\d.]+/) || [""])[0];
        const url = (line.match(/https:\/\/bluefishing\.cl\/producto\/[^\s|"\\]+/) || [""])[0];
        const hasStock = /stock=\d+/.test(line);
        rec({ svc: "openai", kind: "sales", p1: name, stockLabel: (line.match(/stock=\S+/) || [null])[0] });
        text = `Te recomiendo ${name} a ${price}${hasStock ? ", hay stock ahora" : ""}. ${url} ¿Te la dejo lista?`;
      }
      return json(200, { output_text: text, usage: { input_tokens: 100, output_tokens: 40 } });
    }
    // ---- Bsale
    if (p.startsWith("/bsale/v1/")) {
      if (req.headers.access_token !== "bsale-staging-token") return json(401, {});
      if (p.endsWith("/stocks.json")) {
        const code = u.searchParams.get("code"); rec({ svc: "bsale", kind: "stock", code });
        return json(200, { items: code in stock ? [{ quantityAvailable: stock[code], office: { id: "1" } }] : [] });
      }
      if (p.endsWith("/documents.json")) {
        rec({ svc: "bsale", kind: "documents" });
        return json(200, { count: 2, items: [
          { id: 9001, number: 7001, emissionDate: today, totalAmount: 69000, state: 0, office: { id: 1 }, document_type: { codeSii: 39, isCreditNote: 0, isSalesNote: 0 }, client: { phone: "+56 9 1111 2222" } },
          { id: 9002, number: 7002, emissionDate: today, totalAmount: 15990, state: 0, office: { id: 1 }, document_type: { codeSii: 39 }, client: null },
        ] });
      }
      if (p.endsWith("/offices.json")) return json(200, { items: [{ id: 1, name: "Tienda", state: 0 }] });
      return json(404, {});
    }
    // ---- Meta Graph (envío de WhatsApp)
    const g = p.match(/^\/graph\/v[\d.]+\/(\w+)\/messages$/);
    if (g) {
      const b = JSON.parse(body); rec({ svc: "meta", kind: "send", to: b.to, text: b.text?.body, auth: (req.headers.authorization || "").slice(0, 12) });
      return json(200, { messages: [{ id: "wamid.mock" + Date.now() }] });
    }
    // ---- Chatwoot API
    const c = p.match(/^\/chatwoot\/api\/v1\/accounts\/(\d+)\/conversations\/(\d+)\/(messages|toggle_status|labels)$/);
    if (c) {
      const b = JSON.parse(body || "{}"); rec({ svc: "chatwoot", kind: c[3], conv: c[2], body: b, token: req.headers.api_access_token ? "ok" : "none" });
      return json(200, { id: 1 });
    }
    rec({ svc: "unknown", path: p }); json(404, { error: "mock_not_found" });
  });
}).listen(Number(process.env.E2E_MOCK_PORT || 4010), "127.0.0.1", () => console.log("mocks listos"));
