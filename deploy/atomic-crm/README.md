# Atomic CRM para BlueFishing (embudo de ventas)

Atomic CRM (marmelab, licencia MIT) es el **embudo/kanban** del dueño: contactos, oportunidades (deals), notas y tareas.
**Chatwoot** sigue siendo la **bandeja de conversaciones**, y **Matías** el bot. El bot sincroniza sus datos hacia Atomic CRM.

```
Cliente ──► WhatsApp / web / Chatwoot ──► Bot (Postgres propio en el VPS)
                                              │  job atomic-crm-sync (cada 5 min, opcional)
                                              ▼
                       Atomic CRM: Supabase cloud (DB + auth + API)  ◄── SPA estática en crm.bluefishing.cl (Caddy, VPS)
```

## Por qué esta arquitectura
Según la doc oficial, Atomic CRM **depende de Supabase**: Postgres + API REST (PostgREST) + Auth + Storage + Edge Functions
(invitación de usuarios, contraseñas, etc.). El frontend es una SPA estática.

| Opción | Costo | Infra en el VPS | Mantención | Elegida |
|---|---|---|---|---|
| **Supabase cloud (plan Free) + SPA servida por Caddy** | US$0 al inicio ⚠️ | Solo archivos estáticos | Baja (`build.sh` + `supabase-setup.sh`) | ✅ |
| Supabase self-hosted en Docker | US$0 + RAM | ~10 contenedores ⚠️ (Kong, GoTrue, PostgREST, Realtime, Storage, Studio, Edge Runtime…) junto a Chatwoot y el bot | Alta | ❌ demasiado pesado para el VPS |
| Data provider propio contra el Postgres del bot | US$0 | Reescribir auth, API y edge functions | Muy alta, se pierde la ruta de actualización | ❌ |

⚠️ Límites del plan Free de Supabase (pausa por inactividad, tamaño de la DB, cantidad de correos de Auth) **no verificados hoy**: revisarlos en supabase.com/pricing. La doc de Atomic CRM indica que el plan gratuito alcanza para un CRM chico.

## 1. Crear el backend (Supabase cloud)
1. Crear un proyecto en supabase.com (región cercana, p. ej. São Paulo). Guardar: Project ref, URL, **publishable key** y **secret key**.
2. Configurar SMTP propio en Supabase (Auth → SMTP). La doc de Atomic lo exige para las invitaciones y el reseteo de contraseñas (Postmark, Resend, SES…).
3. Desde un PC del equipo, con node 24:
   ```bash
   cp deploy/atomic-crm/.env.example deploy/atomic-crm/.env   # completar
   deploy/atomic-crm/supabase-setup.sh                          # migraciones + edge functions
   ```
4. Etapas del embudo: en el SQL Editor de Supabase correr `deploy/atomic-crm/stages.sql`, o configurarlas en la UI (Settings).
   Los valores **deben** ser `nuevo`, `interesado`, `cotizado`, `compro` y `perdido` (etiquetas Nuevo, Interesado, Cotizado, Compró y Perdido).

## 2. Publicar el frontend en el VPS
```bash
deploy/atomic-crm/build.sh              # compila el commit fijado y copia dist/ a /srv/atomic-crm
```
Agregar `Caddyfile.snippet` al Caddy del VPS (subdominio `crm.bluefishing.cl`). Con Traefik: un router `Host(crm.bluefishing.cl)` hacia un contenedor de archivos estáticos (p. ej. `caddy:alpine` o `nginx:alpine` montando `/srv/atomic-crm`). ⚠️ Los detalles de Traefik dependen del VPS.
Alternativa sin VPS: GitHub Pages (`npm run ghpages:deploy`, según la doc oficial).

## 3. Usuarios y roles
- La **primera persona** que abre el CRM crea el usuario **administrador** (el dueño).
- El administrador invita a los vendedores desde *avatar → Users → Add* (llega un correo vía el SMTP configurado).
- Roles: **Administrador** (usuarios, configuración, etapas) y **Usuario** (vendedor: ve y edita contactos y oportunidades).
- **Asignación:** el job usa `contacts.assigned_to` del bot (email del vendedor) y lo mapea a `sales.email` de Atomic. Lo no asignado queda en `ATOMIC_CRM_DEFAULT_SALES_ID`, o sin dueño.

## 4. Sincronización bot → Atomic CRM
Activar en `.env.production` del bot:
```
ATOMIC_CRM_ENABLED=true
ATOMIC_CRM_SUPABASE_URL=https://<ref>.supabase.co
ATOMIC_CRM_SUPABASE_SECRET_KEY=<secret key>   # solo en el VPS
```
Aplicar la migración del mapa de sincronización y levantar el job:
```bash
psql "$DATABASE_URL" -f db/migrations/003_atomic_crm_sync.sql
docker compose --profile atomic-crm up -d atomic-crm-sync
# prueba manual única:  docker compose run --rm atomic-crm-sync node scripts/atomic-crm-sync.js --once
```
Qué hace en cada corrida (por defecto cada 5 minutos, contactos con actividad en los últimos 30 días):
- **Contacto** del bot → `contacts` de Atomic (nombre, teléfono, primera y última actividad, origen). Solo se actualiza si cambió (hash).
- **Etapa:** se infiere de los datos del bot. *Cotizado* = el bot recomendó productos concretos; *Interesado* = intención media o alta, o se pidió humano. **Solo avanza**: nunca retrocede algo que el equipo movió en el kanban, y *Compró*/*Perdido* son finales. La etapa avanzada también se guarda en `contacts.stage` del bot.
- **Oportunidad (deal):** una por contacto desde *Interesado*, con los productos de interés en la descripción.
- **Handoffs** (`handoff_requests`) → una nota "hot" en el contacto, por cada handoff.
- **Idempotente:** la tabla `atomic_crm_sync` (en el Postgres del bot) mapea las filas del bot a los ids de Atomic. Correrlo dos veces no duplica nada.
- **Fail-safe:** un error en un contacto se registra con el id pseudonimizado y el job sigue con el resto. Si Supabase no responde, el bot no se ve afectado.

## 5. Vínculo con Chatwoot
- Chatwoot: conversaciones en vivo y traspaso a humano (etiqueta `humano`). Atomic CRM: seguimiento comercial (etapas, tareas, notas).
- Los contactos que llegan por Chatwoot se sincronizan igual (`channel=chatwoot`, con `source_channel` y sesión `cw:<conversación>`).
- Práctica sugerida: el vendedor atiende en Chatwoot y mueve la oportunidad en Atomic (Cotizado → Compró/Perdido).
- Enlace directo Chatwoot ↔ Atomic (por ejemplo, un link al contacto): no incluido; posible fase siguiente usando los custom attributes de Chatwoot.

## 6. Backups y actualización
- Supabase Free: ⚠️ verificar la política de backups del plan; exportar periódicamente con `pg_dump` usando la connection string del proyecto.
- Actualizar Atomic CRM: cambiar `ATOMIC_CRM_REF`, volver a correr `supabase-setup.sh` (migraciones) y `build.sh`. Revisar el CHANGELOG antes.
