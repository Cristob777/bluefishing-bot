# Deploy de Bluefishing Bot en un VPS Hostinger (sin Vercel)

El bot ahora corre como un servidor Node permanente (`server.js`, Express) que
monta las mismas rutas que usaba en Vercel:

| Método | Ruta          | Handler              |
|--------|---------------|----------------------|
| GET    | `/webhook`    | verificación de Meta |
| POST   | `/webhook`    | mensajes de WhatsApp |
| POST   | `/chat`       | chat del widget web  |
| GET    | `/widget.js`  | script del widget    |
| GET    | `/admin`      | panel admin (HTML)   |
| POST   | `/admin-chat` | chat del admin       |
| GET    | `/health`     | healthcheck          |

## 1. Requisitos en el VPS

- Ubuntu/Debian con acceso SSH (root o sudo).
- **Node 18+** y npm. Recomendado instalar Node 20 LTS:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  node -v   # debe ser >= 18
  ```

## 2. Subir el código

Opción A (recomendada) — clonar desde GitHub una vez que el PR esté mergeado:
```bash
cd /opt
git clone https://github.com/Cristob777/bluefishing-bot.git
cd bluefishing-bot
```
Opción B — copiar por SCP/rsync desde tu máquina.

## 3. Instalar dependencias

```bash
npm install --omit=dev
```

## 4. Variables de entorno

Crea un archivo `.env` en la raíz (NO se commitea) a partir de `.env.example`:
```bash
cp .env.example .env
nano .env
```
Rellena como mínimo:
- `VERIFY_TOKEN` (el que pondrás en Meta para el webhook)
- `CLAUDE_API_KEY` (o `ANTHROPIC_API_KEY`)
- `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGIN` (ej: `https://bluefishing.cl,https://www.bluefishing.cl`)
- `PORT` (default 3000), `NODE_ENV=production`

> `server.js` carga automáticamente el archivo `.env` (via `dotenv`) al arrancar.
> También puedes inyectar las variables desde PM2 (`ecosystem.config.js` → `env`).

## 5. Probar manualmente

```bash
npm start
# [server] Bluefishing bot escuchando en puerto 3000
curl http://localhost:3000/health   # {"status":"ok"}
```

## 6. Dejarlo corriendo con PM2

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js      # o: pm2 start server.js --name bluefishing-bot
pm2 save
pm2 startup                        # ejecuta el comando que imprime, para arrancar al boot
pm2 logs bluefishing-bot
```

## 7. Reverse proxy + HTTPS

El bot escucha en el puerto interno (3000). Exponlo con HTTPS en tu dominio.

### Opción A — Caddy (HTTPS automático, lo más simple)
`/etc/caddy/Caddyfile`:
```
bot.bluefishing.cl {
    reverse_proxy localhost:3000
}
```
```bash
sudo systemctl reload caddy
```

### Opción B — Nginx + Certbot
`/etc/nginx/sites-available/bluefishing`:
```nginx
server {
    server_name bot.bluefishing.cl;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/bluefishing /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d bot.bluefishing.cl
```

Abre el firewall para 80/443 (`sudo ufw allow 80,443/tcp`). El puerto 3000 NO
debe quedar expuesto a Internet; solo lo usa el proxy en localhost.

## 8. Configurar el webhook en Meta

En Meta for Developers → WhatsApp → Configuration:
- **Callback URL:** `https://bot.bluefishing.cl/webhook`
- **Verify token:** el mismo valor de `VERIFY_TOKEN` del `.env`
- Suscribe el campo `messages`.

Meta hará un `GET /webhook` con `hub.challenge`; el servidor lo responde si el
token coincide.

## 9. Widget en la web

Incrusta en el sitio (WooCommerce/Hostinger):
```html
<script src="https://bot.bluefishing.cl/widget.js" data-color="#0b3d63"></script>
```
Asegúrate de que el dominio del sitio esté en `ALLOWED_ORIGIN`.

## 10. Docker (opcional)

```bash
docker build -t bluefishing-bot .
docker run -d --name bluefishing-bot --env-file .env -p 3000:3000 bluefishing-bot
```

## Actualizaciones

```bash
cd /opt/bluefishing-bot
git pull
npm install --omit=dev
pm2 restart bluefishing-bot
```
