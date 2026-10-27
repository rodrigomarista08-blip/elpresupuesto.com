# Propuesta: «Pregunta tus dudas» con IA a través de un Cloudflare Worker

**Estado: solo propuesta. No está desplegada ni activada.** Hoy la app responde con la guía integrada, que funciona sin conexión y no envía nada fuera del dispositivo. Este documento explica cómo añadir una IA de verdad sin poner ninguna clave en el navegador.

## Por qué hace falta un servidor

Todo lo que hay en `index.html` lo puede leer cualquiera que abra la web. Si la clave de la IA estuviera ahí, cualquiera podría copiarla y gastar a tu cuenta. Por eso la llamada a la IA tiene que pasar por un servidor pequeño que guarde la clave en secreto. Cloudflare Workers sirve bien: es gratuito para poco tráfico, no hay que mantener ninguna máquina y permite limitar peticiones por IP.

```
Navegador (GitHub Pages) ──POST {messages, context}──▶ Worker (guarda la clave) ──▶ API de Claude
```

## Qué recibe el Worker (los datos mínimos)

La app ya envía solo esto, y antes muestra un aviso con el contenido exacto y pide permiso:

- `messages`: la pregunta nueva y, como mucho, las 6 anteriores de la conversación (preguntas y respuestas).
- `context`: vacío, salvo que el usuario marque «Compartir mi reparto» y lo acepte en el aviso. En ese caso es una línea con el dinero del mes y, por sección, lo previsto y lo gastado.

Nunca se envían conceptos de gastos, fechas, objetivos ni copias. El Worker no debe guardar nada: ni registros de las preguntas ni de los datos.

## Código del Worker

Usa el SDK oficial de Anthropic para JavaScript (`npm install @anthropic-ai/sdk`), que funciona en Workers.

```js
// worker.js
import Anthropic from "@anthropic-ai/sdk";

const ORIGEN = "https://rodrigomarista08-blip.github.io"; // solo tu web puede llamar
const SISTEMA = "Eres el asistente de educación financiera de una app de presupuesto para jóvenes en España. " +
  "Responde en español, con tono cercano y claro, en menos de 140 palabras y en párrafos cortos. " +
  "Das educación financiera general: no eres asesor financiero ni fiscal, no recomiendas productos, " +
  "entidades ni valores concretos y no prometes rentabilidades. Si la pregunta depende de la situación " +
  "personal o es una decisión importante, explica los conceptos y sugiere consultar a un profesional o " +
  "a fuentes oficiales (CNMV, Banco de España, Agencia Tributaria). Si no trata de dinero personal, di " +
  "amablemente que solo ayudas con finanzas personales.";

function respuesta(cuerpo, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ORIGEN,
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    },
  });
}

/* Valida que la petición tenga la forma exacta que envía la app y nada más. */
function validar(d) {
  if (!d || !Array.isArray(d.messages) || d.messages.length < 1 || d.messages.length > 7) return null;
  const messages = d.messages.map((m) => ({
    role: m && m.role === "assistant" ? "assistant" : "user",
    content: String((m && m.content) || "").slice(0, 1200),
  }));
  if (messages[0].role !== "user" || messages[messages.length - 1].role !== "user") return null;
  const context = String(d.context || "").slice(0, 1200);
  return { messages, context };
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return respuesta(null, 204);
    if (req.method !== "POST") return respuesta({ error: "método" }, 405);
    if (req.headers.get("Origin") !== ORIGEN) return respuesta({ error: "origen" }, 403);

    // Límite por IP (binding de Rate Limiting de Workers, ver wrangler.toml)
    const ip = req.headers.get("CF-Connecting-IP") || "desconocida";
    const { success } = await env.LIMITE.limit({ key: ip });
    if (!success) return respuesta({ error: "demasiadas peticiones" }, 429);

    let datos;
    try { datos = validar(await req.json()); } catch { datos = null; }
    if (!datos) return respuesta({ error: "petición no válida" }, 400);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      const r = await client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 4096,
        output_config: { effort: "low" },          // respuestas cortas de chat
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",                      // si el modelo rechaza, otro modelo responde
        system: SISTEMA + (datos.context ? "\n\nDatos que el usuario ha decidido compartir: " + datos.context : ""),
        messages: datos.messages,
      });
      if (r.stop_reason === "refusal") return respuesta({ text: "No he podido responder a eso. Prueba a formularlo de otra manera." });
      const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return respuesta({ text });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return respuesta({ error: "ocupado" }, 429);
      return respuesta({ error: "no disponible" }, 502);   // la app usará la guía integrada
    }
  },
};
```

```toml
# wrangler.toml
name = "presupuesto-ia"
main = "worker.js"
compatibility_date = "2026-10-01"

# Límite de peticiones por IP: 10 por minuto.
# La sintaxis de este binding ha cambiado entre versiones de Wrangler: compruébala en la
# documentación de Cloudflare (Workers › Runtime APIs › Rate Limiting) antes de desplegar.
[[ratelimits]]
name = "LIMITE"
namespace_id = "1001"
simple = { limit = 10, period = 60 }
```

La clave se guarda como secreto, nunca en el código:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

## Pasos para activarlo (cuando decidas hacerlo)

1. Crear la cuenta de Cloudflare y la clave de la API de Anthropic con un límite de gasto mensual.
2. Desplegar el Worker (`npx wrangler deploy`) y guardar la clave como secreto.
3. En `index.html`, poner la URL del Worker en `AI_ENDPOINT`.
4. Añadir esa URL a `connect-src` de la Content-Security-Policy de `index.html`; si no, el navegador bloqueará la llamada.
5. Probar el aviso de consentimiento y el límite de peticiones.

## Notas

- **Modelo:** la propuesta usa `claude-opus-5-5`, con esfuerzo bajo para respuestas de chat. Si prefieres pagar menos, `claude-haiku-5-5` cuesta mucho menos por pregunta; es una decisión de coste que te corresponde a ti.
- **Coste:** con el límite por IP y un tope de gasto en la cuenta de Anthropic, nadie puede disparar el gasto aunque descubra la URL del Worker.
- **Si no se puede hacer así de forma segura** (por ejemplo, sin poder poner un límite de gasto), la recomendación es dejar solo la guía integrada, como ahora, en lugar de exponer una IA abierta.
