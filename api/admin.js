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

const ui = require("../lib/ui");
const { icon } = ui;
function page(title, body) { return ui.doc(title, `<div class="content" style="margin:auto">${body}</div>`); }

function login(error = "") {
  const form = `<h1>Panel de ventas</h1><p class="muted" style="margin:6px 0 20px">Acceso privado del operador.</p>${error ? `<div class="alert err" role="alert">${icon("alert", 16)} ${esc(error)}</div>` : ""}
<div class="card"><form method="post" action="/admin/login"><label for="au">Usuario</label><input id="au" name="username" placeholder="Usuario" autocomplete="username" required><label for="ap">Contraseña</label><input id="ap" type="password" name="password" placeholder="••••••••••••" autocomplete="current-password" required><div style="margin-top:16px"><button class="btn full">Entrar</button></div></form></div>`;
  return ui.authLayout({ title: "BlueFishing · Panel de ventas", tagline: "Todo lo que Matías vende, en un solo panel.", feats: ["Conversaciones de WhatsApp y web", "Embudo de clientes por etapa", "Derivaciones a humano al instante"], form });
}

function fmt(n){return new Intl.NumberFormat("es-CL").format(Number(n||0));}
function date(v){try{return new Intl.DateTimeFormat("es-CL",{timeZone:process.env.ADMIN_TIMEZONE||"America/Santiago",dateStyle:"short",timeStyle:"short"}).format(new Date(v));}catch{return String(v||"");}}
function masked(id){const s=String(id||"");const ch=s.startsWith("web:")?"Web ":s.startsWith("cw:")?"Chatwoot ":"";const x=s.replace(/^(wa|web|cw):([0-9a-f-]{36}:)?/,"");return ch+(x.length>7?x.slice(0,3)+" •••• "+x.slice(-4):"•••"+x.slice(-3));}
function days(v){const n=Number(v);return [1,7,30,90].includes(n)?n:7;}
function form(body){return Object.fromEntries(new URLSearchParams(Buffer.from(body||"").toString("utf8")).entries());}
function cost(s){
  const i=Number(process.env.OPENAI_INPUT_COST_PER_1M||0), c=Number(process.env.OPENAI_CACHED_INPUT_COST_PER_1M||0), o=Number(process.env.OPENAI_OUTPUT_COST_PER_1M||0);
  if(!(i>0)||!(o>0)) return null;
  const input=Number(s.input_tokens||0), cached=Math.min(input,Number(s.cached_input_tokens||0));
  return ((input-cached)*i+cached*(c>0?c:i)+Number(s.output_tokens||0)*o)/1000000;
}

const NAV=[["","Inicio","home"],["conversaciones","Conversaciones","chat"],["embudo","Embudo","board"]];
function shell(view,d,title,body){
  return ui.shell({title,product:"Blue Fishing",nav:NAV.map(([v,l,i])=>({href:"/admin?days="+d+(v?"&view="+v:""),label:l,icon:i,on:v===view})),
    user:{name:process.env.ADMIN_DASHBOARD_USER||"Operador",sub:"Operador"},logout:{action:"/admin/logout"},body});
}
const tabs=(d,view)=>"<div class='tabs'>"+[[1,"Hoy"],[7,"7 días"],[30,"30 días"],[90,"90 días"]].map(([n,l])=>"<a class='"+(n===d?"on":"")+"' href='/admin?days="+n+(view?"&view="+view:"")+"'>"+l+"</a>").join("")+"</div>";

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

function ranks(rows,lab=(x)=>x){return rows.length?"<div class='list'>"+rows.map(r=>"<div class='it'><span>"+esc(lab(r.name)||"Sin dato")+"</span><b>"+fmt(r.count)+"</b></div>").join("")+"</div>":"<div class='muted small'>Sin datos en este período.</div>";}
const kpi=(ic,v,l)=>"<div class='card kpi'><span class='ic'>"+icon(ic,20)+"</span><div><b>"+v+"</b><span>"+l+"</span></div></div>";
function convTable(rows,d){
  if(!rows.length)return "<div class='card'>"+ui.empty("chat","Sin conversaciones en este período","Prueba con «30 días» o «90 días».")+"</div>";
  return "<div class='tw'><table><thead><tr><th>Cliente</th><th>Intención</th><th>Último mensaje</th><th>Turnos</th><th>Actividad</th></tr></thead><tbody>"+rows.map(r=>"<tr><td><a href='/admin?days="+d+"&session="+encodeURIComponent(r.session_id)+"'><b>"+esc(masked(r.session_id))+"</b></a></td><td><span class='badge b-brand'>"+esc(ui.intentLabel(r.last_intent))+"</span></td><td>"+esc(String(r.last_message||"").slice(0,100))+"</td><td>"+fmt(r.turns)+"</td><td class='muted small'>"+esc(date(r.last_at))+"</td></tr>").join("")+"</tbody></table></div>";
}
function dashboardHtml(x,d){
  const s=x.s, ai=cost(s), cur=process.env.AI_COST_CURRENCY||"USD";
  const hand=x.attention.length?"<div class='list'>"+x.attention.map(r=>"<div class='it'><span><a href='/admin?days="+d+"&session="+encodeURIComponent(r.session_id)+"'><b>"+esc(masked(r.session_id))+"</b></a><div class='muted small'>"+esc(String(r.last_message||"").slice(0,80))+"</div></span><span class='muted small'>"+esc(date(r.created_at))+"</span></div>").join("")+"</div>":ui.empty("check","Nadie está esperando","No hay clientes pidiendo atención humana.");
  return shell("",d,"Inicio","<div class='head'><div><h1>Panel de ventas</h1><div class='muted'>Matías · actividad comercial real</div></div>"+tabs(d,"")+"</div>"+
  "<div class='grid g4' style='margin-bottom:16px'>"+kpi("msg",fmt(s.interactions),"Mensajes")+kpi("users",fmt(s.customers),"Contactos activos")+kpi("hand",fmt(x.handoffs),"Derivados a humano")+kpi("bolt",fmt(x.high),"Intención alta")+"</div>"+
  "<div class='grid' style='grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:16px' id='cols'><div><div class='head' style='margin:6px 0 10px'><h2>Conversaciones recientes</h2><a class='small' href='/admin?days="+d+"&view=conversaciones'>Ver todas →</a></div>"+convTable(x.recent.slice(0,8),d)+
  "<div class='card' style='margin-top:16px'><h3>Requiere atención humana</h3>"+hand+"</div></div><div class='grid' style='gap:16px;align-content:start'>"+
  "<div class='card'><h3>Productos recomendados</h3>"+ranks(x.products)+"</div><div class='card'><h3>Especies consultadas</h3>"+ranks(x.species)+"</div><div class='card'><h3>Intenciones</h3>"+ranks(x.intents,ui.intentLabel)+"</div>"+
  "<div class='card'><h3>Calidad y costo</h3><div class='list'><div class='it'><span>Sin producto encontrado</span><b>"+fmt(s.no_product_turns)+"</b></div><div class='it'><span>Respuestas de respaldo</span><b>"+fmt(s.fallbacks)+"</b></div><div class='it'><span>Latencia media</span><b>"+fmt(s.avg_latency_ms)+" ms</b></div><div class='it'><span>Tokens IA</span><b>"+fmt(s.total_tokens)+"</b></div><div class='it'><span>Coste IA</span><b>"+(ai===null?"—":esc(cur+" "+ai.toFixed(4)))+"</b></div></div></div></div></div>"+
  "<style>@media(max-width:1000px){#cols{grid-template-columns:1fr!important}}</style>");
}
function conversationsHtml(rows,d){return shell("conversaciones",d,"Conversaciones","<div class='head'><div><h1>Conversaciones</h1><div class='muted'>WhatsApp, web y Chatwoot.</div></div>"+tabs(d,"conversaciones")+"</div>"+convTable(rows,d));}

const STAGES=[["nuevo","Nuevo"],["interesado","Interesado"],["cotizado","Cotizado"],["compro","Compró"],["perdido","Perdido"]];
async function funnel(){
  try{return (await query("select c.stage,c.session_id,c.name,c.channel,c.message_count,c.last_seen_at from contacts c order by c.last_seen_at desc limit 300")).rows;}catch{return [];}
}
function funnelHtml(rows,d){
  const cols=STAGES.map(([k,l])=>{const it=rows.filter(r=>r.stage===k);return "<div class='col'><h3><span>"+l+"</span><span class='badge b-off'>"+it.length+"</span></h3>"+(it.length?it.map(r=>"<a class='dcard' href='/admin?days="+d+"&session="+encodeURIComponent(r.session_id)+"'><b>"+esc(r.name||masked(r.session_id))+"</b><div class='muted small'>"+esc(r.channel==="web"?"Chat web":r.channel==="chatwoot"?"Chatwoot":"WhatsApp")+" · "+fmt(r.message_count)+(Number(r.message_count)===1?" mensaje":" mensajes")+"</div><div class='muted small'>"+esc(date(r.last_seen_at))+"</div></a>").join(""):"<div class='muted small' style='text-align:center;padding:20px 0'>Sin contactos</div>")+"</div>";}).join("");
  return shell("embudo",d,"Embudo","<div class='head'><div><h1>Embudo de clientes</h1><div class='muted'>Cada contacto en su etapa. Las etapas se sincronizan con Atomic CRM si está activo.</div></div></div>"+(rows.length?"<div class='kan'>"+cols+"</div>":"<div class='card'>"+ui.empty("board","El embudo está vacío","Los contactos aparecen aquí cuando escriben por WhatsApp o por el chat web.")+"</div>"));
}

async function conversation(id){
  const q=await Promise.all([
    query("select known_context,updated_at from bot_sessions where session_id=$1 limit 1",[id]),
    query("select user_message,bot_response,intent,products,latency_ms,route,llm_usage,created_at from bot_events where session_id=$1 order by created_at asc limit 100",[id]),
    query("select status,created_at from handoff_requests where session_id=$1 order by created_at desc limit 5",[id]).catch(()=>({rows:[]})),
    query("select stage,name,channel,phone from contacts where session_id=$1 limit 1",[id]).catch(()=>({rows:[]}))
  ]);
  return {session:q[0].rows[0]||{},events:q[1].rows,handoffs:q[2].rows,contact:q[3].rows[0]||null};
}

function conversationHtml(id,x,d){
  const c=x.session.known_context||{}, ct=x.contact||{};
  const L={product_type:"Producto",target_species:"Especie",water_type:"Tipo de agua",fishing_position:"Desde",technique:"Técnica",weight_range:"Rango de peso",weight_grams:"Peso (g)",budget_range:"Presupuesto",brand_preference:"Marca",purchase_intent_level:"Intención de compra"};
  const props=[["Cliente",ct.name||masked(id)],["Canal",ct.channel==="web"||id.startsWith("web:")?"Chat web":id.startsWith("cw:")?"Chatwoot":"WhatsApp"],["Mensajes",fmt(x.events.length)],["Última actividad",x.events.length?date(x.events[x.events.length-1].created_at):"—"]].concat(Object.keys(L).filter(k=>c[k]&&c[k]!=="unknown").map(k=>[L[k],c[k]]));
  const tl=x.events.length?x.events.map(e=>"<div class='ev'><div class='muted small'>"+esc(date(e.created_at))+" · "+esc(ui.intentLabel(e.intent))+" · "+fmt(e.latency_ms)+" ms</div><div class='bub u'>"+esc(e.user_message)+"</div>"+(e.bot_response?"<div class='bub a'>"+esc(e.bot_response)+"</div>":"")+"</div>").join(""):ui.empty("chat","Sin mensajes","No hay eventos para este cliente.");
  const stage=(STAGES.find(s=>s[0]===ct.stage)||[null,"Sin etapa"])[1];
  const prods=[...new Set(x.events.flatMap(e=>(Array.isArray(e.products)?e.products:[]).map(p=>p&&p.name).filter(Boolean)))].slice(0,6);
  return shell("conversaciones",d,"Contacto","<div class='head'><div><a class='small' href='/admin?days="+d+"&view=conversaciones'>← Conversaciones</a><h1 style='margin-top:6px'>"+esc(ct.name||masked(id))+"</h1></div><span class='badge b-brand'>"+esc(stage)+"</span></div>"+
  "<div class='rec'><div class='card'><h3>Propiedades</h3>"+props.map(p=>"<div class='prop'><span>"+esc(p[0])+"</span><b>"+esc(p[1])+"</b></div>").join("")+"</div>"+
  "<div class='card'><h3>Actividad</h3><div class='tl'>"+tl+"</div></div>"+
  "<div class='grid' style='gap:16px'><div class='card'><h3>Etapa del embudo</h3><div class='list'>"+STAGES.map(s=>"<div class='it'><span>"+s[1]+"</span>"+(s[0]===ct.stage?"<span class='badge b-ok'>Actual</span>":"")+"</div>").join("")+"</div></div>"+
  "<div class='card'><h3>Productos recomendados</h3>"+(prods.length?"<div class='list'>"+prods.map(p=>"<div class='it'><span>"+esc(p)+"</span></div>").join("")+"</div>":"<div class='muted small'>Aún ninguno.</div>")+"</div>"+
  "<div class='card'><h3>Derivaciones</h3>"+(x.handoffs.length?"<div class='list'>"+x.handoffs.map(h=>"<div class='it'><span class='badge "+(h.status==="open"?"b-err":"b-off")+"'>"+(h.status==="open"?"Abierta":h.status==="contacted"?"Contactado":"Cerrada")+"</span><span class='muted small'>"+esc(date(h.created_at))+"</span></div>").join("")+"</div>":"<div class='muted small'>No pidió hablar con una persona.</div>")+"</div></div></div>");
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
  if(req.method!=="GET"||path!=="/admin")return send(res,404,ui.errorPage("Página no encontrada","El enlace no existe o cambió.","/admin","Volver al panel de ventas"));

  try{
    const d=days(req.query?.days), id=String(req.query?.session||"").slice(0,160);
    if(id)return send(res,200,conversationHtml(id,await conversation(id),d));
    const view=String(req.query?.view||"");
    if(view==="embudo")return send(res,200,funnelHtml(await funnel(),d));
    if(view==="conversaciones")return send(res,200,conversationsHtml((await dashboard(d)).recent,d));
    return send(res,200,dashboardHtml(await dashboard(d),d));
  }catch(error){
    console.error("[Admin] Dashboard error:",safeError(error));
    return send(res,500,ui.errorPage("Algo salió mal","No pudimos cargar el panel. Inténtalo de nuevo.","/admin","Reintentar"));
  }
};

module.exports._test={esc,sign,verify,days,masked,cost};