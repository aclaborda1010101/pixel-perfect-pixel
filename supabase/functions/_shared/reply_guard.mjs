// reply_guard — controles de código ANTES de enviar el mensaje del bot.
// "El prompt decide estilo; el código decide límites." Funciones PURAS (sin red, sin Deno),
// para que las importen igual el edge function (Deno) y el banco de simulación (Node).
//
// Flujo: detectModes() sobre el entrante → buildTurnDirective() inyecta política dura de ESTE
// turno en el prompt → el modelo genera → validateDraft() sobre el borrador → si falla,
// repairInstruction() para UNA regeneración → si aún falla, hardFallback() determinista.

// ── normalización y similitud ────────────────────────────────────────────────
export function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function trigrams(s) {
  const t = norm(s).replace(/ /g, "_");
  const g = new Set();
  for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3));
  return g;
}
// Coseno sobre conjuntos de trigramas de caracteres: caza "nadie le mueve de su casa" vs
// "nadie le pide que se mueva de su casa" (misma idea, otras palabras) sin necesitar embeddings.
export function similarity(a, b) {
  const ga = trigrams(a), gb = trigrams(b);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / Math.sqrt(ga.size * gb.size);
}
// Coeficiente de solapamiento (containment): cuánto del más pequeño está contenido en el más
// grande. Mejor que el coseno para "¿reutiliza esta frase?" cuando el otro mensaje lleva relleno
// ("tranquilo, Enrique, nadie le mueve de su casa" contiene "nadie le mueve de su casa").
function overlap(a, b) {
  const ga = trigrams(a), gb = trigrams(b);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / Math.min(ga.size, gb.size);
}
function splitSentences(s) {
  return String(s || "").split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim()).filter((x) => norm(x).split(" ").length >= 3);
}
// Máxima similitud considerando mensaje-completo Y frase-a-frase, con coseno Y containment: caza
// una FRASE repetida aunque vaya embebida en un mensaje más largo o con relleno alrededor.
export function maxSimilarity(draft, prev) {
  const score = (a, b) => Math.max(similarity(a, b), 0.9 * overlap(a, b));
  let best = score(draft, prev);
  const ds = splitSentences(draft), ps = splitSentences(prev);
  for (const d of ds) for (const p of ps) { const s = score(d, p); if (s > best) best = s; }
  return best;
}

// ── listas ───────────────────────────────────────────────────────────────────
const MULETILLAS = [
  "caso por caso", "lo ve un experto", "lo afina un experto", "lo afina una persona",
  "lo valora un experto", "lo valora una persona", "sin compromiso", "es de cajon",
  "no le robo mas tiempo", "encantado de ayudarle", "quedo a su disposicion",
  "los detalles los afina", "lo afina con tranquilidad", "vemos con frecuencia",
  "casos asi los vemos", "lo vemos mucho", "es muy habitual", "lo vemos a menudo",
];
const ESPEJO_EMPATIA = [
  "entiendo perfectamente", "es muy comprensible", "es muy injusto", "le entiendo",
  "tiene todo el sentido", "te entiendo", "lo entiendo perfectamente", "se lo que es",
];
const TUTEO_MARKERS = /\b(t[uú]|te|tuyo|tuya|contigo|tienes|quieres|puedes|sabes|d[ií]game(?!)|prefieres|vienes|dime|mira|oye)\b/i;
const USTED_MARKERS = /\b(usted|le|su|sus|d[ií]game|prefiere|viene|tiene(?! razón)|puede|sabe|dice)\b/i;
// pregunta que pide un DATO del caso (no una calibrada de cierre emocional)
const DATA_QUESTION = /\?/;
const DATA_TOPIC = /(alquilad|vac[ií]|renta|cuota|porcentaje|zona|barrio|c[oó]digo postal|direcci[oó]n|metros|m2|gesti[oó]n|inquilin|derram|escritur|herenci|cu[aá]nto|cu[aá]ntos|qui[eé]n)/i;

// ── detección de modos sobre el entrante + historial ─────────────────────────
const RE_REPROCHE = /(no te repit|no me repit|pareces? un (bot|robot|m[aá]quina)|eres? un (bot|robot|m[aá]quina)|dando largas|deja de marear|no hagas como si|no s[eé] qu[eé] tiene que ver|me est[aá]s repitiendo|disco rayado|otra vez lo mismo|ya me lo has dicho|ya me lo dijiste|contigo no se puede|eso ya me lo)/i;
const RE_PRECIO = /(cu[aá]nto|precio|cifra|rango|n[uú]mero|pag[aá]is|valdr[ií]a|me dar[ií]ais|adelanto|orientaci[oó]n de.*(valdr|precio)|una idea de.*(valdr|precio))/i;
const RE_TUTEO_REQUEST = /(p[uú]edes tutearme|h[aá]blame de t[uú]|no hace falta.*usted|tut[eé]ame|de t[uú] mejor)/i;
const RE_EMOCION = [
  { re: /de mi casa no me (mueve|echa|saca|mueven)|no me mueve nadie|llevo (aqu[ií]|toda la vida|\d+ años)|aqu[ií] me quedo|mi hogar|es mi casa/i, tema: "apego/miedo a perder su casa" },
  { re: /no me f[ií]o|no me fio|desconf[ií]|es una estafa|es un timo|me qued[oé] sin nada|luego viene el papeleo|eso dec[ií]s todos/i, tema: "desconfianza/recelo" },
  { re: /es un l[ií]o|un desastre|estoy hart|no aguanto|agotad|cansad|no puedo m[aá]s|un infierno/i, tema: "hartazgo/carga" },
  { re: /co[ñn]o|joder|hostia|me cago|estoy hasta/i, tema: "enfado/frustración" },
];

export function detectModes(lastInText, history) {
  const t = String(lastInText || "");
  const inbound = (history || []).filter((m) => m.role === "user" || m.direction === "in");
  const contentOf = (m) => m.content ?? "";
  const precioVeces = inbound.filter((m) => RE_PRECIO.test(contentOf(m))).length + (RE_PRECIO.test(t) && !inbound.some((m)=>contentOf(m)===t) ? 1 : 0);
  const reproche = RE_REPROCHE.test(t);
  let emocion = null;
  for (const e of RE_EMOCION) if (e.re.test(t)) { emocion = e.tema; break; }
  const pideTuteo = RE_TUTEO_REQUEST.test(t) || (history || []).some((m) => (m.role === "user" || m.direction === "in") && RE_TUTEO_REQUEST.test(contentOf(m)));
  return { reproche, precioVeces: Math.max(precioVeces, RE_PRECIO.test(t) ? 1 : 0), emocion, pideTuteo };
}

// registro establecido: usted por defecto; sólo tú si el cliente lo pidió explícito.
export function resolveRegister(modes, prevRegister) {
  if (prevRegister === "tu") return "tu";
  if (modes.pideTuteo) return "tu";
  return "usted";
}

// ── directiva de turno (política dura inyectada en el prompt) ─────────────────
export function buildTurnDirective(modes, register) {
  const lines = [];
  lines.push(`REGISTRO FIJO ESTE TURNO Y TODA LA CONVERSACIÓN: trata de "${register === "tu" ? "tú" : "usted"}". No lo cambies.`);
  if (modes.reproche) lines.push(`⚠️ TURNO DE REPROCHE: el cliente critica tu estilo o te dice que te repites. Tu mensaje DEBE empezar reconociéndolo en una frase corta ("Tiene razón, disculpe") y NO puede contener NINGUNA pregunta de datos. Cambia de enfoque a algo concreto y útil de SU caso. Prohibido volver a usar la fórmula que le molestó.`);
  if (modes.emocion) lines.push(`⚠️ EMOCIÓN DETECTADA (${modes.emocion}): tu PRIMERA frase valida eso con algo CONCRETO que él acaba de decir, sin prometer de más. PROHIBIDO pedir ningún dato en este turno. Nada de logística ni reunión aún.`);
  if (modes.precioVeces >= 2) lines.push(`⚠️ ${modes.precioVeces}ª VEZ QUE PIDE PRECIO: PROHIBIDO repetir que "lo ve el equipo/en la llamada". Haz esto: (1) reconoce que no le esquivas; (2) di los CRITERIOS concretos que miráis (zona, m², estado, situación legal/cargas, urgencia); (3) explica en una frase por qué sin verlos una cifra cerrada le perjudica; (4) ofrece llamada O visita. Una sola vez, sin muletilla.`);
  else if (modes.precioVeces === 1) lines.push(`El cliente pide precio (1ª vez): no des cifra, di brevemente de qué depende y ofrece la llamada donde se la concretan. Sin muletilla de "experto".`);
  return lines.length ? `\n════════ POLÍTICA OBLIGATORIA DE ESTE TURNO (gana a todo) ════════\n- ${lines.join("\n- ")}\n` : "";
}

// ── validación del borrador ──────────────────────────────────────────────────
export function validateDraft(text, ctx) {
  const { lastBotMsgs = [], lastClientMsgs = [], register = "usted", modes = {}, maxChars = 300, simThreshold = 0.58, espejoThreshold = 0.45 } = ctx || {};
  const violations = [];
  const t = String(text || "");
  const n = norm(t);

  const qCount = (t.match(/\?/g) || []).length;
  if (qCount >= 2) violations.push({ rule: "dos_preguntas", detail: `${qCount} preguntas en un mensaje` });

  if (t.length > maxChars) violations.push({ rule: "muy_largo", detail: `${t.length} chars (>${maxChars})` });

  for (const m of MULETILLAS) if (n.includes(norm(m))) violations.push({ rule: "muletilla", detail: m });
  for (const e of ESPEJO_EMPATIA) if (n.includes(norm(e))) violations.push({ rule: "espejo_empatia", detail: e });

  for (const prev of lastBotMsgs) {
    const sim = maxSimilarity(t, prev);
    if (sim >= simThreshold) { violations.push({ rule: "repite_idea", detail: `sim ${sim.toFixed(2)} vs "${String(prev).slice(0, 60)}"` }); break; }
  }
  // Espejo AL CLIENTE: parrotea/parafrasea lo que el cliente acaba de decir (loro léxico).
  // Caza el espejo léxico (palabras reutilizadas); el paráfrasis semántico profundo requiere
  // embeddings o auto-crítica LLM (nivel 2). Excluye preguntas (referenciar un dato es legítimo).
  if (!DATA_QUESTION.test(t)) {
    for (const cm of lastClientMsgs) {
      const sim = maxSimilarity(t, cm);
      if (sim >= espejoThreshold) { violations.push({ rule: "espejo_cliente", detail: `sim ${sim.toFixed(2)} vs cliente "${String(cm).slice(0, 50)}"` }); break; }
    }
  }

  // registro
  if (register === "usted" && TUTEO_MARKERS.test(t) && !USTED_MARKERS.test(t)) violations.push({ rule: "registro", detail: "tuteo con registro=usted" });
  if (register === "tu" && /\busted\b/i.test(t)) violations.push({ rule: "registro", detail: "usted con registro=tu" });

  // emoción / reproche: prohibido pedir dato
  const asksData = DATA_QUESTION.test(t) && DATA_TOPIC.test(t);
  if (modes.emocion && asksData) violations.push({ rule: "pide_dato_en_emocion", detail: "pregunta de dato en turno emocional" });
  if (modes.reproche && asksData) violations.push({ rule: "reproche_pide_dato", detail: "pregunta de dato tras reproche" });
  if (modes.reproche && !/tiene raz[oó]n|disculp|perd[oó]n|le pido perd/i.test(t)) violations.push({ rule: "reproche_sin_reconocer", detail: "no reconoce el reproche" });

  return { ok: violations.length === 0, violations };
}

// ── instrucción de reparación (para UNA regeneración dirigida) ────────────────
export function repairInstruction(violations, register) {
  const map = {
    dos_preguntas: "Deja UNA sola pregunta (la más importante), quita las demás.",
    muy_largo: "Acórtalo a 1-2 frases, máximo ~280 caracteres, una sola idea.",
    muletilla: "Quita la muletilla de folleto; di lo mismo con palabras normales y concretas.",
    espejo_empatia: "Quita la coletilla de empatía genérica; si validas, hazlo con un detalle CONCRETO de su caso.",
    repite_idea: "Estás repitiendo una idea que ya dijiste antes con otras palabras. Di algo NUEVO o cambia de enfoque; no repitas.",
    registro: `Usa "${register === "tu" ? "tú" : "usted"}" de forma consistente en TODO el mensaje.`,
    pide_dato_en_emocion: "NO pidas ningún dato: valida su emoción con algo concreto suyo y para ahí.",
    reproche_pide_dato: "NO pidas datos: reconoce el reproche en una frase y cambia de enfoque.",
    reproche_sin_reconocer: "Empieza reconociendo el reproche ('Tiene razón, disculpe') y cambia de enfoque.",
    espejo_cliente: "Estás repitiendo/parafraseando lo que el cliente acaba de decir (le suena a loro). NO le devuelvas su frase; aporta algo NUEVO o haz una única pregunta que avance.",
  };
  const uniq = [...new Set(violations.map((v) => v.rule))];
  const fixes = uniq.map((r) => `- ${map[r] || r}`).join("\n");
  return `Tu borrador anterior incumple estas reglas duras. Reescríbelo corrigiendo SOLO esto, mismo idioma y tono, y devuelve el mismo JSON:\n${fixes}`;
}

// ── fallback determinista (si la reparación tampoco pasa) ─────────────────────
export function hardFallback(text, ctx) {
  const { modes = {}, register = "usted" } = ctx || {};
  const u = register === "tu"; // tú
  if (modes.reproche) {
    return u
      ? "Tienes razón, disculpa. Sin rodeos: dime tú qué es lo que más te preocupa y vamos por ahí."
      : "Tiene razón, disculpe. Sin rodeos: dígame qué es lo que más le preocupa y vamos por ahí.";
  }
  if (modes.precioVeces >= 2) {
    return u
      ? "No quiero darte largas. Una cifra cerrada sin ver zona, m², estado y cargas te perjudicaría; eso es justo lo que miramos. ¿Lo vemos en una llamada o prefieres una visita?"
      : "No quiero darle largas. Una cifra cerrada sin ver zona, m², estado y cargas le perjudicaría; eso es justo lo que miramos. ¿Lo vemos en una llamada o prefiere una visita?";
  }
  // genérico: recorta a la primera frase y a una sola pregunta
  let t = String(text || "").trim();
  const parts = t.split(/(?<=[.!?…])\s+/);
  let out = "";
  for (const p of parts) { if ((out + p).length > 260) break; out += (out ? " " : "") + p; if ((out.match(/\?/g) || []).length >= 1) break; }
  return out || t.slice(0, 260);
}

// helper: últimos N mensajes salientes (bot) del historial, más recientes primero
export function lastBotMessages(history, n = 3) {
  return (history || [])
    .filter((m) => m.role === "assistant" || m.direction === "out")
    .map((m) => m.content ?? "")
    .filter(Boolean)
    .slice(-n);
}

// helper: últimos N mensajes entrantes (cliente) — para detectar espejo al cliente
export function lastClientMessages(history, n = 2) {
  return (history || [])
    .filter((m) => m.role === "user" || m.direction === "in")
    .map((m) => m.content ?? "")
    .filter(Boolean)
    .slice(-n);
}
