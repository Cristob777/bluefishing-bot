# Prueba de punta a punta (antes de cada deploy)

Responde "¿funciona todo junto?" sin credenciales reales: corre `server.js` real contra un Postgres real
(base desechable `bf_e2e`) y simula OpenAI, Bsale, Meta (WhatsApp) y Chatwoot por HTTP.

```bash
# Requiere Node 22 y un Postgres local (cualquier versión ≥ 14) con un usuario que pueda crear bases.
npm ci
E2E_PG_ADMIN_URL=postgresql://postgres@localhost:5432/postgres bash e2e/run-staging.sh
```

## Qué cubre (35 verificaciones)
| Área | Verifica |
|---|---|
| Meta | Verificación del webhook, rechazo sin firma, respuesta al mismo número con el token del `.env` |
| Venta | Recomendación con producto real del catálogo, stock en vivo por SKU, producto agotado no se ofrece, confirmación de stock |
| Memoria | Guarda desde dónde pesca, técnica, presupuesto ("80 mil") y marca |
| Tienda | Responde dirección y horario desde `STORE_*` del `.env`; no inventa lo que no está configurado |
| CRM | Contacto creado, etapa automática (Cotizado), traspaso no retrocede la etapa, venta Bsale → Compró |
| Seguridad | Prompt injection bloqueado, chat web solo desde bluefishing.cl, `/admin` sin login no expone datos |
| Chatwoot | Matías responde, pedir persona → etiqueta `humano` + Abierta, Matías se pausa, "asesoría" no traspasa |
| Ventas | Sync Bsale atribuye por teléfono; boleta anónima sin datos personales |
| `/admin` | Login, embudo, Resultados con fuente Bsale, ficha con intereses y productos |

## Qué NO cubre (se prueba en el deploy con credenciales reales)
Calidad real de las respuestas de OpenAI, API real de Bsale (campos `client.phone`, `document_type.codeSii`),
Meta real (número, plantillas, ventana de 24 h), Chatwoot real, imágenes Docker, Cloudflare Tunnel y el sync
del catálogo contra bluefishing.cl (este último ya corre a diario en GitHub Actions).
