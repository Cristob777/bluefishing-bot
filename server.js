const http = require("node:http");
const { URL } = require("node:url");
const webhookHandler = require("./api/webhook");
const healthHandler = require("./api/health");
const { safeError } = require("./lib/logSanitizer");

const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1024 * 1024);

function makeResponse(res) {
  return {
    status(code) {
      res.statusCode = code;
      return this;
    },
    json(payload) {
      if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(payload));
    },
    send(payload) {
      if (Buffer.isBuffer(payload)) return res.end(payload);
      if (typeof payload === "object" && payload !== null) {
        if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify(payload));
      }
      if (!res.headersSent) res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(String(payload ?? ""));
    },
  };
}

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return Buffer.alloc(0);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Payload too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    req.query = Object.fromEntries(url.searchParams.entries());
    req.path = url.pathname;

    const rawBody = await readBody(req);
    req.rawBody = rawBody;
    req.body = {};

    if (rawBody.length) {
      const contentType = String(req.headers["content-type"] || "");
      if (contentType.includes("application/json")) {
        try {
          req.body = JSON.parse(rawBody.toString("utf8"));
        } catch {
          return makeResponse(res).status(400).json({ error: "invalid_json" });
        }
      }
    }

    const response = makeResponse(res);

    if (url.pathname === "/webhook") {
      await webhookHandler(req, response);
    } else if (url.pathname === "/health") {
      await healthHandler(req, response);
    } else {
      response.status(404).json({ error: "not_found" });
    }
  } catch (error) {
    console.error("[Server] Request error:", safeError(error));
    if (!res.writableEnded) {
      res.statusCode = error.statusCode || 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: error.statusCode === 413 ? "payload_too_large" : "internal_error" }));
    }
  } finally {
    console.log(JSON.stringify({
      method: req.method,
      path: req.path || "/",
      status: res.statusCode,
      latency_ms: Date.now() - started,
    }));
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Server] BlueFishing bot listening on :${PORT}`);
});

function shutdown(signal) {
  console.log(`[Server] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
