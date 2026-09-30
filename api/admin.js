const crypto = require("node:crypto");
const { query } = require("../lib/postgres");
const { safeError } = require("../lib/logSanitizer");

const COOKIE = "bf_admin";
const TTL = 12 * 60 * 60;
const attempts = new Map();

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}

function configured() {
  return Boolean(process.env.ADMIN_DASHBOARD_USER && process.env.ADMIN_DASHBOARD_PASSWORD && process.env.ADMIN_SESSION_SECRET);
}

function eq(a,b) {
  const A=Buffer.from(String(a??"")), B=Buffer.from(String(b??""));
  return A.length===B.length && crypto.timingSafeEqual(A,B);
}

function sign(user) {
  const payload=Buffer.from(JSON.stringify({user,exp:Date.now()+TTL*1000})).toString("base64url");
  const sig=crypto.createHmac("sha256",process.env.ADMIN_SESSION_SECRET).update(payload).digest("base64url");
  return payload+"."+sig;
}

function verify(token) {
  try {
    const [payload,sig]=String(token||"").split(".");
    if(!payload||!sig) return false;
    const expected=crypto.createHmac("sha256",process.env.ADMIN_SESSION_SECRET).update(payload).digest("base64url");
    if(!eq(sig,expected)) return false;
    const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    return data.user===process.env.ADMIN_DASHBOARD_USER && Number(data.exp)>Date.now();
  } catch { return false; }
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie||"").split(";").map(x=>x.trim()).filter(Boolean).map(x=>{
    const i=x.indexOf("="); return i<0?[x,""]:[x.slice(0,i),x.slice(i+1)];
  }));
}

function headers(res) {
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","DENY");
  res.setHeader("Referrer-Policy","no-referrer");
  res.setHeader("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}

function send(res,status,body) {
  headers(res); res.statusCode=status; res.setHeader("Content-Type","text/html; charset=utf-8"); res.end(body);
}

function redirect(res,where,cookie) {
  headers(res); res.statusCode=303; res.setHeader("Location",where); if(cookie) res.setHeader("Set-Cookie",cookie); res.end();
}

function page(title,body) {
  const css="body{margin:0;background:#07111f;color:#edf5ff;font-family:system-ui,sans-serif}.w{max-width:1200px;margin:auto;padding:24px}.card{background:#0d1b2e;border:1px solid #20364f;border-radius:14px;padding:16px}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:16px 0}.cols{display:grid;grid-template-columns:1.3fr .7fr;gap:14px}.metric b{font-size:28px;display:block}.muted{color:#93a9c2;font-size:13px}a{color:#4fb8ff;text-decoration:none}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px;border-bottom:1px solid #20364f;text-align:left;vertical-align:top}th{color:#93a9c2}.pill{display:inline-block;border:1px solid #20364f;border-radius:999px;padding:3px 7px;margin:2px;font-size:11px;color:#93a9c2}.msg{padding:12px;border-radius:12px;margin:8px 0;white-space:pre-wrap}.u{background:#143253;margin-left:18%}.a{background:#13281f;margin-right:18%}.login{max-width:400px;margin:12vh auto}input,button{width:100%;padding:11px;margin:7px 0;border-radius:8px;border:1px solid #20364f;background:#0d1b2e;color:#edf5ff}button{cursor:pointer}.top{display:flex;justify-content:space-between;align-items:center;gap:15px}.filters a{display:inline-block;border:1px solid #20364f;padding:6px 9px;border-radius:8px;margin-right:6px}.rank{display:flex;justify-content:space-between;margin:9px 0}@media(max-width:900px){.grid{grid-template-columns:repeat(3,1fr)}.cols{grid-template-columns:1fr}}@media(max-width:600px){.grid{grid-template-columns:repeat(2,1fr)}.w{padding:14px}}";
  return "<!doctype html><html lang='es'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>"+esc(title)+"</title><style>"+css+"</style></head><body>"+body+"</body></html>";
}

function login(error="") {
  return page("BlueFishing Sales Console","<div class='w login'><h2>BlueFishing Sales Console</h2><p class='muted'>Acceso privado</p><div class='card'>"+(error?"<p>"+esc(error)+"</p>":"")+"<form method='post' action='/admin/login'><input name='username' placeholder='Usuario' autocomplete='username' required><input type='password' name='password' placeholder='Contraseña' autocomplete='current-password' required><button>Entrar</button></form></div></div>");
}

function fmt(n){return new Intl.NumberFormat("es-CL").format(Number(n||0));}
function date(v){try{return new Intl.DateTimeFormat("es-CL",{timeZone:process.env.ADMIN_TIMEZONE||"America/Santiago",dateStyle:"short",timeStyle:"short"}).format(new Date(v));}catch{return String(v||"");}}
function masked(id){const x=String(id||"").replace(/^wa:/,"");return x.length>7?x.slice(0,3)+" •••• "+x.slice(-4):"***"+x.slice(-3);}
function days(v){const n=Number(v);return [1,7,30,90].includes(n)?n:7;}
function form(body){return Object.fromEntries(new URLSearchParams(Buffer.from(body||"").toString("utf8")).entries());}
function cost(s){
  const i=Number(process.env.OPENAI_INPUT_COST_PER_1M||0), c=Number(process.env.OPENAI_CACHED_INPUT_COST_PER_1M||0), o=Number(process.env.OPENAI_OUTPUT_COST_PER_1M||0);
  if(!(i>0)||!(o>0)) return null;
  const input=Number(s.input_tokens||0), cached=Math.min(input,Number(s.cached_input_tokens||0));
  return ((input-cached)*i+cached*(c>0?c:i)+Number(s.output_tokens||0)*o)/1000000;
}

async function dashboard(d) {
  const q = await Promise.all([
    query("select count(*)::int interactions,count(distinct session_id)::int customers,coalesce(sum((llm_usage->>'llm_calls')::int),0)::bigint llm_calls,coalesce(sum((llm_usage->>'input_tokens')::bigint),0)::bigint input_tokens,coalesce(sum((llm_usage->>'cached_input_tokens')::bigint),0)::bigint cached_input_tokens,coalesce(sum((llm_usage->>'output_tokens')::bigint),0)::bigint output_tokens,coalesce(sum((llm_usage->>'total_tokens')::bigint),0)::bigint total_tokens,coalesce(round(avg(latency_ms))::int,0) avg_latency_ms,count(*) filter(where jsonb_array_length(products)=0 and handoff=false)::int no_product_turns,count(*) filter(where route like '%fallback')::int fallbacks from bot_events where created_at>=now()-($1::int*interval '1 day')",[d]),
    query("select count(*)::int count from bot_sessions where updated_at>=now()-($1::int*interval '1 day') and lower(coalesce(known_context->>'purchase_intent_level',''))='high'",[d]),
    query("select count(*)::int count from handoff_requests where status='open'"),
    query("select coalesce(intent,'sin_intent') name,count(*)::int count from bot_events where created_at>=now()-($1::int*interval '1 day') group by 1 order by count desc limit 6",[d]),
    query("select item->>'name' name,count(*)::int count from bot_events e cross join lateral jsonb_array_elements(e.products)item where e.created_at>=now()-($1::int*interval '1 day') and coalesce(item->>'name','')<>'' group by 1 order by count desc limit 6",[d]),
    query("select known_context->>'target_species' name,count(*)::int count from bot_sessions where updated_at>=now()-($1::int*interval '1 day') and coalesce(known_context->>'target_species','unknown') not in('','unknown') group by 1 order by count desc limit 6",[d]),
    query("select session_id,max(created_at) last_at,count(*)::int turns,coalesce(sum((llm_usage->>'total_tokens')::bigint),0)::bigint tokens,(array_agg(coalesce(intent,'') order by created_at desc))[1] last_intent,(array_agg(user_message order by created_at desc))[1] last_message from bot_events where created_at>=now()-($1::int*interval '1 day') group by session_id order by max(created_at) desc limit 25",[d]),
    query("select session_id,intent,last_message,created_at from handoff_requests where status='open' order by created_at desc limit 20")
  ]);
  return {s:q[0].rows[0]||{},high:Number(q[1].rows[0]?.count||0),handoffs:Number(q[2].rows[0]?.count||0),intents:q[3].rows,products:q[4].rows,species:q[5].rows,recent:q[6].rows,attention:q[7].rows};
}

function ranks(rows){return rows.length?rows.map(r=>"<div class='rank'><span>"+esc(r.name||"Sin dato")+"</span><b>"+fmt(r.count)+"</b></div>").join(""):"<p class='muted'>Sin datos.</p>";}

function dashboardHtml(x,d){
  const s=x.s, ai=cost(s), cur=process.env.AI_COST_CURRENCY||"USD";
  const recent=x.recent.map(r=>"<tr><td><a href='/admin?days="+d+"&session="+encodeURIComponent(r.session_id)+"'>"+esc(masked(r.session_id))+"</a></td><td>"+esc(r.last_intent||"—")+"</td><td>"+esc(String(r.last_message||"").slice(0,100))+"</td><td>"+fmt(r.turns)+"</td><td>"+fmt(r.tokens)+"</td><td>"+esc(date(r.last_at))+"</td></tr>").join("");
  const hand=x.attention.map(r=>"<tr><td>"+esc(masked(r.session_id))+"</td><td>"+esc(r.intent||"—")+"</td><td>"+esc(String(r.last_message||"").slice(0,100))+"</td><td>"+esc(date(r.created_at))+"</td></tr>").join("");
  return page("BlueFishing Sales Console","<div class='w'><div class='top'><div><h2>BlueFishing Sales Console</h2><div class='muted'>Matías · actividad comercial real</div></div><form method='post' action='/admin/logout'><button>Salir</button></form></div><div class='filters'><a href='/admin?days=1'>Hoy</a><a href='/admin?days=7'>7 días</a><a href='/admin?days=30'>30 días</a><a href='/admin?days=90'>90 días</a></div><div class='grid'>"+
  [["Interacciones",s.interactions],["Clientes activos",s.customers],["Intención alta",x.high],["Handoffs abiertos",x.handoffs],["Tokens IA",s.total_tokens],["Coste IA",ai===null?"—":cur+" "+ai.toFixed(4)]].map(m=>"<div class='card metric'><span class='muted'>"+m[0]+"</span><b>"+fmt(m[1])+"</b></div>").join("")+
  "</div><div class='cols'><div><div class='card'><h3>Conversaciones recientes</h3><table><tr><th>Cliente</th><th>Intención</th><th>Último mensaje</th><th>Turnos</th><th>Tokens</th><th>Actividad</th></tr>"+(recent||"<tr><td colspan='6'>Sin conversaciones.</td></tr>")+"</table></div><div class='card' style='margin-top:14px'><h3>Requiere atención humana</h3><table><tr><th>Cliente</th><th>Motivo</th><th>Último mensaje</th><th>Fecha</th></tr>"+(hand||"<tr><td colspan='4'>Sin handoffs abiertos.</td></tr>")+"</table></div></div><div><div class='card'><h3>Productos recomendados</h3>"+ranks(x.products)+"</div><div class='card' style='margin-top:14px'><h3>Especies consultadas</h3>"+ranks(x.species)+"</div><div class='card' style='margin-top:14px'><h3>Intenciones</h3>"+ranks(x.intents)+"</div><div class='card' style='margin-top:14px'><h3>Calidad operativa</h3><div class='rank'><span>Sin producto recuperado</span><b>"+fmt(s.no_product_turns)+"</b></div><div class='rank'><span>Fallbacks</span><b>"+fmt(s.fallbacks)+"</b></div><div class='rank'><span>Latencia media</span><b>"+fmt(s.avg_latency_ms)+" ms</b></div></div></div></div></div>");
}

async function conversation(id){
  const q=await Promise.all([
    query("select known_context,updated_at from bot_sessions where session_id=$1 limit 1",[id]),
    query("select user_message,bot_response,intent,products,latency_ms,route,llm_usage,created_at from bot_events where session_id=$1 order by created_at asc limit 100",[id])
  ]);
  return {session:q[0].rows[0]||{},events:q[1].rows};
}

function conversationHtml(id,x,d){
  const c=x.session.known_context||{};
  const pills=["product_type","target_species","water_type","fishing_position","technique","weight_range","weight_grams","budget_range","brand_preference","purchase_intent_level"].filter(k=>c[k]&&c[k]!=="unknown").map(k=>"<span class='pill'>"+esc(k)+": "+esc(c[k])+"</span>").join("");
  const ev=x.events.map(e=>"<div class='card' style='margin-top:10px'><div class='msg u'><b>Cliente</b><br>"+esc(e.user_message)+"</div><div class='msg a'><b>Matías</b><br>"+esc(e.bot_response||"")+"</div><div class='muted'>"+esc(date(e.created_at))+" · "+esc(e.intent||"") +" · "+esc(e.route||"")+" · "+fmt(e.llm_usage?.total_tokens)+" tokens · "+fmt(e.latency_ms)+" ms</div></div>").join("");
  return page("Conversación","<div class='w'><div class='top'><div><a href='/admin?days="+d+"'>← Dashboard</a><h2>Cliente "+esc(masked(id))+"</h2></div><form method='post' action='/admin/logout'><button>Salir</button></form></div><div class='card'><h3>Contexto detectado</h3>"+(pills||"<span class='muted'>Sin contexto confirmado.</span>")+"</div><h3 style='margin-top:18px'>Conversación</h3>"+(ev||"<div class='card'>Sin eventos.</div>")+"</div>");
}

module.exports = async function(req,res){
  if(!configured()){res.statusCode=404;return res.end("Not found");}
  const path=req.path||"/admin", ck=cookies(req), ok=verify(ck[COOKIE]);

  if(path==="/admin/login"&&req.method==="POST"){
    const ip=String(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"unknown").split(",")[0];
    const a=attempts.get(ip)||{n:0,t:Date.now()};
    if(Date.now()-a.t>15*60*1000){a.n=0;a.t=Date.now();}
    if(a.n>=5)return send(res,429,login("Demasiados intentos."));
    const f=form(req.rawBody);
    if(!eq(f.username,process.env.ADMIN_DASHBOARD_USER)||!eq(f.password,process.env.ADMIN_DASHBOARD_PASSWORD)){a.n++;attempts.set(ip,a);return send(res,401,login("Credenciales incorrectas."));}
    attempts.delete(ip);
    return redirect(res,"/admin",COOKIE+"="+sign(f.username)+"; Max-Age="+TTL+"; Path=/admin; HttpOnly; Secure; SameSite=Strict");
  }

  if(!ok)return send(res,200,login());
  if(path==="/admin/logout"&&req.method==="POST")return redirect(res,"/admin",COOKIE+"=; Max-Age=0; Path=/admin; HttpOnly; Secure; SameSite=Strict");
  if(req.method!=="GET"||path!=="/admin")return send(res,404,page("No encontrado","<div class='w'>No encontrado.</div>"));

  try{
    const d=days(req.query?.days), id=String(req.query?.session||"").slice(0,160);
    if(id)return send(res,200,conversationHtml(id,await conversation(id),d));
    return send(res,200,dashboardHtml(await dashboard(d),d));
  }catch(error){
    console.error("[Admin] Dashboard error:",safeError(error));
    return send(res,500,page("Error","<div class='w'><div class='card'>No pudimos cargar el dashboard.</div></div>"));
  }
};

module.exports._test={esc,sign,verify,days,masked,cost};