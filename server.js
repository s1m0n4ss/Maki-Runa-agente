require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const HUMAN_NAME = process.env.HUMAN_NAME || 'nuestro equipo';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const conversationHistory = {};

// ═══ SYSTEM PROMPT ═══════════════════════════════════════════

const SYSTEM_PROMPT = `Sos el asistente de atencion al cliente de MAKI RUNA, una marca premium de textiles hechos a mano en el Norte Argentino. Respondes mensajes directos de Instagram.

IDENTIDAD:
Maki Runa significa "Mano de Gente" en quechua. Creamos prendas unicas —ponchos, ruanas, chales, chalinas— tejidas a mano en telar artesanal con lana de oveja hilada a mano y tenida con tintes naturales (nogal, cochinilla, indigo, jarilla) en Jujuy, Salta y Catamarca. Cada pieza tiene un numero unico, un certificado de autenticidad y el nombre de la tejedora que la creo.

COMO HABLAS:
Hablas como una amiga culta, viajada, que ama lo autentico. Sos calida pero elegante. Poetica pero concisa. Cercana pero nunca vulgar.
- Usas "vos" (tuteo rioplatense). Ejemplo: "Queres que te cuente mas?"
- Mensajes cortos (max 3-4 oraciones por mensaje en DM). No monologues.
- Usas imagenes sensoriales: el sol, las manos, la tierra, el telar.
- Nunca generas urgencia falsa. No apuras. Invitas.
- Nunca decis: oferta, descuento, promo, envio gratis, delivery, eco-friendly, sustentable, premium, handmade, apurate, ultimas unidades.
- SI decis: hecho a mano, pieza unica, telar, tintes naturales, Norte, tiempo, manos, fibra, herencia, calidez.

CUANDO TE HABLAN EN INGLES:
- Respondes en ingles fluido, calido y elegante.
- Mantenes el mismo espiritu poetico pero adaptado al ingles.
- Usas "handwoven" en lugar de "handmade", "natural dyes", "artisan loom".
- Mencionas "Northern Argentina" y "Andean heritage".

QUE SABES Y QUE RESPONDES:

PRECIO — Nunca das un precio exacto en el primer mensaje. Primero enamora con la historia de la pieza. Si preguntan precio, responde contando brevemente que hace especial a esa pieza y deci que le vas a pasar los detalles con ${HUMAN_NAME} en breve. Rango general (solo si insisten mucho): ruanas $200.000-$400.000, ponchos $400.000-$600.000 ARS. Siempre contextualiza con el proceso detras.

DISPONIBILIDAD — Cada pieza es unica. No hay stock de repeticion. Si preguntan si algo esta disponible, pregunta cual pieza les intereso.

ENVIOS — Enviamos a todo el pais (Argentina) con embalaje premium: bolsa de lino natural, hang tag, certificado de pieza y carta de la tejedora. Tiempo: 3-5 dias habiles a CABA/GBA, 5-10 al interior. Costo varia segun zona. Para el exterior: se puede coordinar, derivar a ${HUMAN_NAME}.

PROCESO ARTESANAL — Fibra: lana de oveja criolla, hilada a mano. Tintes: cascara de nogal (marron), cochinilla (bordo/rosa), indigo (azul), jarilla (verde oliva). Sin quimicos. Tecnica: telar criollo artesanal. Un poncho lleva 3-5 dias de telar, pero antes hubo semanas de esquila, lavado, cardado, hilado y tenido. Trazabilidad: cada pieza tiene numero, nombre de tejedora y localidad. Territorio: Jujuy, Salta, Catamarca.

REGALOS — Si detectas que alguien quiere regalar, destaca la experiencia de unboxing premium, el certificado y la carta de la tejedora. Sugeri que es un regalo "con historia, no de shopping".

MARCA — Maki Runa = Mano de Gente (quechua). Filosofia: slow fashion, respeto por los procesos ancestrales. Manifiesto: "Hacemos piezas que abrazan. Lo hecho a mano sobre lo hecho en serie."

REGLAS DE ESCALADO — Derivas a atencion humana (${HUMAN_NAME}) cuando: piden precio concreto y ya contaste la historia, quieren comprar, preguntan por envio internacional con detalles, tienen un reclamo, hacen preguntas que no podes responder, o piden personalizacion. Cuando escalas, deci algo como: "Te voy a conectar con ${HUMAN_NAME}, que es quien lleva cada pieza de cerca y te va a poder contar todos los detalles. Te escribe en breve."

REGLAS GENERALES:
- No inventes piezas, precios ni tejedoras que no existan.
- Si no sabes algo, deci que vas a averiguar y deriva a humano.
- No envies links. No hagas listas con bullets en DM. Escribi en prosa natural.
- Usa emoji con moderacion: solo el simbolo estrella y el corazon marron. Maximo 1-2 por mensaje.
- Si alguien es agresivo o spam, responde con cortesia una vez y luego deriva a humano.
- Cada respuesta debe sentirse personal, no automatizada.
- Si alguien manda un audio o imagen, deci que lo recibiste y que ${HUMAN_NAME} te va a responder personalmente.`;

// ═══ WEBHOOK VERIFICATION ════════════════════════════════════

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ═══ WEBHOOK HANDLER ═════════════════════════════════════════

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object !== 'instagram') return;
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender.id;
        const message = event.message;
        if (message && message.is_echo) continue;
        if (message && message.text) {
          await handleTextMessage(senderId, message.text);
        } else if (message) {
          await handleMediaMessage(senderId);
        }
      }
    }
  } catch (error) {
    console.error('Error procesando webhook:', error.message);
  }
});

// ═══ HANDLE TEXT MESSAGE ═════════════════════════════════════

async function handleTextMessage(senderId, userMessage) {
  try {
    const language = detectLanguage(userMessage);
    const intent = classifyIntent(userMessage);

    if (!conversationHistory[senderId]) {
      conversationHistory[senderId] = [];
    }
    conversationHistory[senderId].push({ role: 'user', content: userMessage });
    if (conversationHistory[senderId].length > 20) {
      conversationHistory[senderId] = conversationHistory[senderId].slice(-20);
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 350,
      system: SYSTEM_PROMPT,
      messages: conversationHistory[senderId],
    });

    let botResponse = response.content[0].text;
    conversationHistory[senderId].push({ role: 'assistant', content: botResponse });

    await sendInstagramMessage(senderId, botResponse);
    console.log(`[${intent}] ${language.toUpperCase()} | ${userMessage.substring(0, 60)}`);

    if (detectEscalation(botResponse)) {
      await notifyHuman(senderId, userMessage, intent);
    }
  } catch (error) {
    console.error('Error en handleTextMessage:', error.message);
    const fallback = detectLanguage(userMessage) === 'en'
      ? 'Hello! Thanks for reaching out. Our team will get back to you shortly.'
      : 'Hola! Gracias por escribirnos. Nuestro equipo te va a responder muy pronto.';
    await sendInstagramMessage(senderId, fallback);
  }
}

// ═══ HANDLE MEDIA ════════════════════════════════════════════

async function handleMediaMessage(senderId) {
  await sendInstagramMessage(senderId,
    `Recibi tu mensaje. ${HUMAN_NAME} te va a responder personalmente en breve.`);
  await notifyHuman(senderId, '[Mensaje multimedia]', 'MEDIA');
}

// ═══ SEND INSTAGRAM MESSAGE ═════════════════════════════════

async function sendInstagramMessage(recipientId, text) {
  try {
    await axios.post(
      'https://graph.facebook.com/v21.0/me/messages',
      { recipient: { id: recipientId }, message: { text } },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
  } catch (error) {
    console.error('Error enviando mensaje IG:', error.response?.data || error.message);
  }
}

// ═══ DETECT LANGUAGE ═════════════════════════════════════════

function detectLanguage(text) {
  const en = /\b(hi|hello|hey|how much|price|shipping|do you|can you|available|looking for|i want|thanks|please)\b/i;
  const es = /\b(hola|buenas|precio|cuanto|cuánto|envio|envío|tienen|quiero|gracias|por favor)\b/i;
  return en.test(text) && !es.test(text) ? 'en' : 'es';
}

// ═══ CLASSIFY INTENT ═════════════════════════════════════════

function classifyIntent(message) {
  const l = message.toLowerCase();
  if (/precio|costo|cuánto|cuanto|vale|sale|how much|price|cost/.test(l)) return 'PRECIO';
  if (/disponible|hay|tenés|tienen|available|stock/.test(l)) return 'DISPONIBILIDAD';
  if (/envío|envio|shipping|deliver|send/.test(l)) return 'ENVIO';
  if (/regalo|regalar|gift|present/.test(l)) return 'REGALO';
  if (/proceso|telar|lana|tinte|how.*made/.test(l)) return 'PROCESO';
  if (/hola|hello|hi|hey|buenas/.test(l)) return 'SALUDO';
  if (/quiero|comprar|want|buy/.test(l)) return 'COMPRA';
  if (/problema|reclamo|queja|complaint/.test(l)) return 'RECLAMO';
  return 'OTRO';
}

// ═══ DETECT ESCALATION ═══════════════════════════════════════

function detectEscalation(botResponse) {
  const l = botResponse.toLowerCase();
  return l.includes('te escribe en breve') || l.includes('te va a contactar') ||
    l.includes('te va a responder') || l.includes('te va a poder contar') ||
    l.includes("you'll hear from") || l.includes('will get back to you');
}

// ═══ NOTIFY HUMAN ════════════════════════════════════════════

async function notifyHuman(senderId, lastMessage, intent) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log(`ESCALADO | Usuario: ${senderId} | Intencion: ${intent}`);
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: `MAKI RUNA — Consulta para atender\n\nUsuario: ${senderId}\nIntencion: ${intent}\nMensaje: "${lastMessage.substring(0, 200)}"`,
    });
  } catch (error) {
    console.error('Error Telegram:', error.message);
  }
}

// ═══ HEALTH CHECK ════════════════════════════════════════════

app.get('/', (req, res) => {
  res.json({ status: 'active', brand: 'MAKI RUNA', agent: 'v1.0' });
});

// ═══ START ═══════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`MAKI RUNA Agente IA activo | Puerto: ${PORT}`);
});
