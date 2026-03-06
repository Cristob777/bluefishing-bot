# Bluefishing Bot - Chatbot Matías

Chatbot de WhatsApp para **Bluefishing.cl**, la tienda especializada en pesca deportiva.

## Stack

- **Runtime:** Node.js 18+
- **AI:** Google Gemini 1.5 Flash
- **Mensajería:** WhatsApp Business API (Cloud API)
- **Deploy:** Vercel (Serverless Functions)

## Variables de entorno

| Variable | Descripción |
|---|---|
| `VERIFY_TOKEN` | Token de verificación del webhook (default: `bluefishing123`) |
| `GEMINI_API_KEY` | API Key de Google Generative AI |
| `WHATSAPP_TOKEN` | Token de acceso de WhatsApp Business |
| `PHONE_NUMBER_ID` | ID del número de teléfono de WhatsApp Business |

## Deploy en Vercel

1. Importa el repositorio en [vercel.com](https://vercel.com)
2. Configura las variables de entorno en el dashboard
3. El webhook estará disponible en `https://tu-proyecto.vercel.app/webhook`  
   (Producción: `https://bluefishing-253ejz32i-cristob777s-projects.vercel.app/webhook`)

## Configuración de WhatsApp

1. En Meta for Developers, configura el webhook URL: `https://tu-proyecto.vercel.app/webhook`
2. Usa el `VERIFY_TOKEN` configurado para la verificación
3. Suscríbete al campo `messages`
