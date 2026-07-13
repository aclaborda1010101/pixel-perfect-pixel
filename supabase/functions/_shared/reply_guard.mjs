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
// Palabras PROHIBIDAS por contenido (auditoría cliente): el bot no menciona la vía de contacto.
const PALABRAS_PROHIBIDAS = /\b(revista|revistas|buzone|folleto|el?\s+cart[oó]n)\b|\bla carta\b|\bnuestra carta\b|\bpor la carta\b/i;

// R1 · Ficha viva: mapa CAMPO ya conocido → patrón de pregunta que lo REPREGUNTA (no debe ocurrir).
const FIELD_REASK = {
  nombre_apellidos: /(con qui[eé]n tengo|c[oó]mo se llama|cu[aá]l es su nombre|me dice su nombre|me recuerda su nombre|con qui[eé]n hablo)/i,
  estado_edificio: /(c[oó]mo (est[aá]|anda|se encuentra)( hoy)? el edificio|est[aá] alquilad|alquilado.{0,12}vac[ií]o|vac[ií]o.{0,12}alquilad|parte y parte)/i,
  cuota_participacion: /(qu[eé] (parte|porcentaje|cuota) (le|te)|cu[aá]nto le (corresponde|toca)|qu[eé] % (tiene|le)|cu[aá]l es su (parte|cuota|porcentaje))/i,
  gestion_rentas: /(qui[eé]n (se ocupa|gestiona|lleva|acaba llevando)|de la gesti[oó]n del d[ií]a a d[ií]a|qui[eé]n lo gestiona)/i,
  renta_mensual_estimada: /(qu[eé] renta entra|cu[aá]nto entra (al mes|de renta)|qu[eé] rentas)/i,
};
// R3 · Cliente propone hora/día concreto para la cita.
const RE_PROPONE_HORA = /\b(a las?\s*\d{1,2}([:.]\d{2})?|\d{1,2}\s*h\b|\d{1,2}\s*de la (ma[ñn]ana|tarde|noche)|(este|el)\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|ma[ñn]ana (por la|a las)|pasado ma[ñn]ana)\b/i;
// R3 · el borrador confirma la cita (acusa día/hora + cierra).
const RE_CONFIRMA = /(perfecto|estupendo|hecho|queda(mos)?|anotad|le llama|te llama|le llamamos|le pasa|hablamos entonces|nos vemos)/i;
// R3 · el borrador de confirmación debe REPETIR el día/hora (plantilla Rev.4 "[día] a las [hora]").
const RE_SENAL_TEMPORAL = /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|ma[ñn]ana|hoy|pasado ma[ñn]ana|\d{1,2}\s*(h\b|:\d|de la (ma[ñn]ana|tarde|noche)))/i;
const RE_REABRE_HORA = /\?[^?]*$/;
const RE_PREGUNTA_HORA = /(a qu[eé] (hora|n[uú]mero)|qu[eé] (d[ií]a|hora|horario)|cu[aá]ndo le (viene|va)|en qu[eé] horario|le viene (mejor|bien).*\?)/i;
// R4 · el borrador propone reunión/llamada.
const RE_PROPONE_CITA = /\b(le (llama|llame|llamamos|llamen|organizo|preparo)|una llamada|nos vemos|quedamos|una (reuni[oó]n|cita|visita)|se (pasa|acerca) (un compa|alguien)|le (pongo|paso) (con|en contacto)|agend)/i;
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
  { re: /es un l[ií]o|un desastre|estoy hart|no aguanto|agotad|cansad|no puedo m[aá]s|un infierno|ni ganas|sin ganas|no tengo (ni )?(tiempo|ganas)|no me apetece|no quiero (l[ií]os|complicaci|movidas|historias)|paso de (esto|todo|esta)|qu[eé] pereza|menudo (l[ií]o|marr[oó]n)|vaya (l[ií]o|marr[oó]n)/i, tema: "hartazgo/carga" },
  { re: /co[ñn]o|joder|hostia|me cago|estoy hasta/i, tema: "enfado/frustración" },
];

// ¿El cliente ya se ha presentado en el historial? Red de seguridad para R1/R4/R5 cuando el
// modelo no llega a extraer nombre_apellidos a la ficha a tiempo (evita repreguntar el nombre).
const RE_CLIENTE_NOMBRE = /\b(soy|me llamo|mi nombre es|me llaman)\s+[a-záéíóúñ]{2,}/i;

// NO-PRESUPOSICIÓN (fallo real 13-jul): en la apertura, mientras el CLIENTE no haya revelado que
// tiene una propiedad/caso, el bot NO puede hablar de "su situación / su caso / en qué punto está /
// su inmueble". Frases que delatan la presuposición en el borrador:
const RE_PRESUPONE = /\b(su (situaci[oó]n|caso|tema|inmueble|propiedad|edificio|piso|parte|proindiviso|herencia)|en qu[eé] (situaci[oó]n|punto)|qu[eé] situaci[oó]n)\b/i;
// Señales de que el CLIENTE (no el bot) ya reveló que tiene una propiedad/contexto de proindiviso.
const RE_PROP_REVELADA = /\b(edificio|inmueble|piso|vivienda|proindiviso|herenci|hered[eé]|copropiet|comuner|mi parte|mi porcentaje|mi cuota|compart(o|imos|ida)|local|finca|alquil|inquilin|propiedad|metros cuadrad|catastr|es mi casa|mi hogar)\b/i;

// ¿El cliente ya reveló ÉL MISMO que tiene una propiedad/caso? (solo escanea mensajes entrantes).
export function clientRevealedProperty(history, lastInText) {
  if (RE_PROP_REVELADA.test(String(lastInText || ""))) return true;
  return (history || []).some((m) => (m.role === "user" || m.direction === "in") && RE_PROP_REVELADA.test(String(m.content ?? "")));
}

// R6 · Variación: saludos/aperturas que NO deben repetirse en mensajes seguidos del bot
// ("Perfecto, Carlos." / "Encantado, Agustín." / "Buenas, ..."). El fallo medido con Luna: el bot
// abre 2-3 mensajes seguidos con la misma fórmula. Detecta la palabra-saludo de apertura.
const SALUDOS_APERTURA = new Set(["perfecto", "encantado", "estupendo", "genial", "buenas", "hola", "vale", "bien", "de", "muy", "claro", "entendido", "marchando"]);
export function aperturaSaludo(s) {
  const first = String(s || "").trim().toLowerCase().replace(/^[¡¿"'\s]+/, "").split(/[\s,.:;!?]+/)[0];
  return SALUDOS_APERTURA.has(first) ? first : null;
}
export function clientGaveName(history) {
  const arr = history || [];
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i];
    const isClient = m.role === "user" || m.direction === "in";
    if (!isClient) continue;
    const c = String(m.content ?? "").trim();
    if (RE_CLIENTE_NOMBRE.test(c)) return true;
    // respuesta corta (1-3 palabras, con inicial mayúscula) justo tras el bot pidiendo el nombre
    const prev = arr[i - 1];
    const prevBot = prev && (prev.role === "assistant" || prev.direction === "out") ? String(prev.content ?? "") : "";
    if (/con qui[eé]n tengo|c[oó]mo se llama|su nombre|qui[eé]n hablo/i.test(prevBot)) {
      const STOP = new Set(["buenas", "buenos", "hola", "vale", "si", "no", "gracias", "ok", "perfecto", "dias", "días", "tardes", "noches", "que", "pues", "mire", "oiga", "usted"]);
      const words = c.replace(/[.,;!?¡¿]/g, "").split(/\s+/).filter(Boolean);
      if (words.length <= 4 && words.some((w) => /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,}$/.test(w) && !STOP.has(w.toLowerCase()))) return true;
    }
  }
  return false;
}

export function detectModes(lastInText, history) {
  const t = String(lastInText || "");
  const inbound = (history || []).filter((m) => m.role === "user" || m.direction === "in");
  const contentOf = (m) => m.content ?? "";
  const precioVeces = inbound.filter((m) => RE_PRECIO.test(contentOf(m))).length + (RE_PRECIO.test(t) && !inbound.some((m)=>contentOf(m)===t) ? 1 : 0);
  const reproche = RE_REPROCHE.test(t);
  // Nº de reproches de estilo en toda la conversación: si el cliente ya reprochó 2+ veces, no
  // sirve seguir justificándose/disculpándose — hay que derivar a una persona (corta el bucle).
  const reprocheCount = inbound.filter((m) => RE_REPROCHE.test(contentOf(m))).length + (reproche && !inbound.some((m) => contentOf(m) === t) ? 1 : 0);
  let emocion = null;
  for (const e of RE_EMOCION) if (e.re.test(t)) { emocion = e.tema; break; }
  const pideTuteo = RE_TUTEO_REQUEST.test(t) || (history || []).some((m) => (m.role === "user" || m.direction === "in") && RE_TUTEO_REQUEST.test(contentOf(m)));
  // R3: el cliente da una hora/día concreto (sólo cuenta como propuesta de cita si el bot ya
  // orientó hacia una reunión/llamada en algún momento — evita falsos positivos tipo "mañana te
  // escribo").
  const botOfrecioCita = (history || []).some((m) => (m.role === "assistant" || m.direction === "out") && RE_PROPONE_CITA.test(contentOf(m)));
  const clienteProponeHora = RE_PROPONE_HORA.test(t) && (botOfrecioCita || /qued|llam|ve[rn]|cita|reuni|\b(vale|ok|perfecto|de acuerdo|me viene|acepto|venga)\b/i.test(t));
  const nombreDado = clientGaveName(history);
  const propiedadRevelada = clientRevealedProperty(history, lastInText);
  return { reproche, reprocheCount, precioVeces: Math.max(precioVeces, RE_PRECIO.test(t) ? 1 : 0), emocion, pideTuteo, clienteProponeHora, nombreDado, propiedadRevelada };
}

// registro establecido: usted por defecto; sólo tú si el cliente lo pidió explícito.
export function resolveRegister(modes, prevRegister) {
  if (prevRegister === "tu") return "tu";
  if (modes.pideTuteo) return "tu";
  return "usted";
}

// ── directiva de turno (política dura inyectada en el prompt) ─────────────────
// ficha = objeto de datos ya conocidos (qualification). Se usa para R1 (no repreguntar) y R4/R5.
export function buildTurnDirective(modes, register, ficha = {}) {
  const lines = [];
  lines.push(`REGISTRO FIJO ESTE TURNO Y TODA LA CONVERSACIÓN: trata de "${register === "tu" ? "tú" : "usted"}". No lo cambies.`);
  lines.push(`NUNCA menciones "carta", "revista" ni "buzoneo" como vía de contacto. Si preguntan cómo le contactasteis: "identificamos edificios en proindiviso en Madrid con información pública".`);

  // R1 · Ficha viva: recuerda al modelo qué NO repreguntar.
  const conocidos = Object.entries(ficha || {})
    .filter(([k, v]) => v != null && v !== "" && ["nombre_apellidos", "estado_edificio", "cuota_participacion", "gestion_rentas", "renta_mensual_estimada", "perfil_copropietario"].includes(k))
    .map(([k]) => k);
  if (conocidos.length) lines.push(`YA SABES estos datos (NO los vuelvas a preguntar, úsalos): ${conocidos.join(", ")}. Si el cliente ya dio el dato, se usa y se avanza a lo siguiente.`);

  if (modes.reprocheCount >= 2) lines.push(`⚠️ EL CLIENTE YA HA REPROCHADO VARIAS VECES tu forma de responder. NO te vuelvas a disculpar ni a justificar (eso alarga el bucle y suena a robot). Ofrécele directamente hablar con una persona del equipo ("Prefiero que le llame un compañero y lo vea con calma, ¿le parece?") y NO insistas más.`);
  else if (modes.reproche) lines.push(`⚠️ TURNO DE REPROCHE: el cliente critica tu estilo o te dice que te repites. Tu mensaje DEBE empezar reconociéndolo en una frase corta ("Tiene razón, disculpe") y NO puede contener NINGUNA pregunta de datos. Cambia de enfoque a algo concreto y útil de SU caso. Prohibido volver a usar la fórmula que le molestó, y no repitas una disculpa que ya diste antes.`);
  if (modes.emocion) lines.push(`⚠️ EMOCIÓN DETECTADA (${modes.emocion}): tu PRIMERA frase valida eso con algo CONCRETO que él acaba de decir, sin prometer de más. PROHIBIDO pedir ningún dato en este turno. Nada de logística ni reunión aún.`);
  if (modes.precioVeces >= 2) lines.push(`⚠️ ${modes.precioVeces}ª VEZ QUE PIDE PRECIO: PROHIBIDO repetir que "lo ve el equipo/en la llamada". Haz esto: (1) reconoce que no le esquivas; (2) di los CRITERIOS concretos que miráis (zona, m², estado, situación legal/cargas, urgencia); (3) explica en una frase por qué sin verlos una cifra cerrada le perjudica; (4) ofrece llamada O visita. Una sola vez, sin muletilla.`);
  else if (modes.precioVeces === 1) lines.push(`El cliente pide precio (1ª vez): no des cifra, di brevemente de qué depende y ofrece la llamada donde se la concretan. Sin muletilla de "experto".`);

  // R3 · Cierre confirmado.
  if (modes.clienteProponeHora) lines.push(`⚠️ CIERRE: el cliente acaba de proponer un día/hora. Tu mensaje es SOLO la confirmación, en UNA frase: "Perfecto, [día] a las [hora]. Le llama alguien del equipo a este número." y PARA AHÍ. PROHIBIDO en ese mensaje: otra pregunta, pedir otro dato, despedidas largas, o repetir la confirmación. Una frase y cierras.`);

  // R4 · Puerta de cierre: sin nombre no se agenda a secas (mira ficha Y lo que el cliente ya dijo).
  const tieneNombre = !!ficha.nombre_apellidos || modes.nombreDado;
  if (!tieneNombre) lines.push(`AÚN NO tienes el nombre del propietario. Si propones o aceptas una llamada, PIDE su nombre con naturalidad en el MISMO mensaje ("Con gusto se la organizo. ¿Cómo se llama, para dejarlo anotado?"). No agendes con la ficha vacía.`);
  // R1+R5 · Si YA se presentó, NO repreguntes el nombre; a lo sumo pide el apellido UNA vez.
  else lines.push(`El propietario YA te dio su nombre — NO se lo vuelvas a preguntar bajo ninguna forma (ni "su nombre", ni "nombre completo"). Si solo tienes el nombre de pila, puedes pedir el apellido UNA vez con naturalidad ("¿y su apellido, para dejarlo bien anotado?"); si no lo da, sigues sin insistir.`);

  return lines.length ? `\n════════ POLÍTICA OBLIGATORIA DE ESTE TURNO (gana a todo) ════════\n- ${lines.join("\n- ")}\n` : "";
}

// ── validación del borrador ──────────────────────────────────────────────────
export function validateDraft(text, ctx) {
  const { lastBotMsgs = [], lastClientMsgs = [], register = "usted", modes = {}, ficha = {}, maxChars = 300, simThreshold = 0.58, espejoThreshold = 0.45 } = ctx || {};
  const violations = [];
  const t = String(text || "");
  const n = norm(t);

  const qCount = (t.match(/\?/g) || []).length;
  if (qCount >= 2) violations.push({ rule: "dos_preguntas", detail: `${qCount} preguntas en un mensaje` });

  if (t.length > maxChars) violations.push({ rule: "muy_largo", detail: `${t.length} chars (>${maxChars})` });

  for (const m of MULETILLAS) if (n.includes(norm(m))) violations.push({ rule: "muletilla", detail: m });
  for (const e of ESPEJO_EMPATIA) if (n.includes(norm(e))) violations.push({ rule: "espejo_empatia", detail: e });

  // Contenido prohibido (auditoría): carta / revista / buzoneo como vía de contacto.
  if (PALABRAS_PROHIBIDAS.test(t)) violations.push({ rule: "menciona_via_contacto", detail: (t.match(PALABRAS_PROHIBIDAS) || [""])[0] });

  // NO-PRESUPOSICIÓN (fallo real 13-jul): si el cliente aún NO ha revelado que tiene una propiedad
  // y el borrador ya habla de "su situación / su caso / en qué punto está / su inmueble", es
  // presuposición → se bloquea. (Determinista: no depende de que el modelo obedezca el prompt.)
  if (!modes.propiedadRevelada && RE_PRESUPONE.test(t))
    violations.push({ rule: "presupone_situacion", detail: (t.match(RE_PRESUPONE) || [""])[0] });

  // R1 · Ficha viva: no repreguntar un dato ya conocido (por ficha O por el historial en el caso
  // del nombre, que el modelo a veces no extrae a tiempo).
  if (DATA_QUESTION.test(t)) {
    for (const [field, re] of Object.entries(FIELD_REASK)) {
      const known = (ficha && ficha[field] != null && ficha[field] !== "") || (field === "nombre_apellidos" && modes.nombreDado);
      if (known && re.test(t)) { violations.push({ rule: "repregunta_dato", detail: `repregunta ${field} (ya conocido)` }); break; }
    }
  }

  // R3 · Cierre confirmado: si el cliente propuso hora, el borrador debe confirmarla, REPETIR el
  // día/hora (plantilla Rev.4) y NO reabrirla.
  if (modes.clienteProponeHora) {
    if (RE_PREGUNTA_HORA.test(t)) violations.push({ rule: "cierre_reabre_hora", detail: "repregunta hora/número tras propuesta del cliente" });
    else if (!RE_CONFIRMA.test(t)) violations.push({ rule: "cierre_no_confirmado", detail: "no acusa/confirma la hora propuesta" });
    else if (!RE_SENAL_TEMPORAL.test(t)) violations.push({ rule: "cierre_sin_repetir_hora", detail: "confirma pero no repite el día/hora acordado" });
    // El mensaje de cierre debe ser SOLO la confirmación: si confirma la cita y además mete otra
    // pregunta de dato, no cierra en seco (fallo R3: confirma pero sigue hablando).
    if (RE_CONFIRMA.test(t) && DATA_QUESTION.test(t) && DATA_TOPIC.test(t))
      violations.push({ rule: "cierre_con_pregunta_extra", detail: "confirma la cita pero añade otra pregunta de dato" });
  }

  // Disculpa repetida: si el bot ya abrió con "tiene razón/disculpe" en su mensaje anterior y vuelve
  // a abrir igual, suena a bucle (fallo Enrique). Debe variar o cambiar de enfoque.
  const RE_DISCULPA = /^(\s*)(tiene raz[oó]n|disculpe|perd[oó]n|le pido perd|me repet)/i;
  if (RE_DISCULPA.test(t) && lastBotMsgs.length && RE_DISCULPA.test(String(lastBotMsgs[lastBotMsgs.length - 1])))
    violations.push({ rule: "disculpa_repetida", detail: "dos disculpas de apertura seguidas" });

  // R4 · Puerta de cierre: no proponer/aceptar llamada sin al menos el nombre (ficha O historial).
  const nombreConocido = (ficha && ficha.nombre_apellidos) || modes.nombreDado;
  if (RE_PROPONE_CITA.test(t) && !nombreConocido) {
    // salvo que en el MISMO mensaje ya esté pidiendo el nombre (eso es lo correcto).
    if (!FIELD_REASK.nombre_apellidos.test(t) && !/(c[oó]mo se llama|su nombre|qui[eé]n (es|habla))/i.test(t))
      violations.push({ rule: "cierre_sin_nombre", detail: "propone cita sin tener el nombre" });
  }

  for (const prev of lastBotMsgs) {
    const sim = maxSimilarity(t, prev);
    if (sim >= simThreshold) { violations.push({ rule: "repite_idea", detail: `sim ${sim.toFixed(2)} vs "${String(prev).slice(0, 60)}"` }); break; }
  }
  // R6 · Apertura repetida: abre con el mismo saludo que CUALQUIERA de sus últimos 2-3 mensajes
  // ("Perfecto, X." / "Encantado, X." repetido, aunque no sea consecutivo).
  const apT = aperturaSaludo(t);
  if (apT && lastBotMsgs.some((m) => aperturaSaludo(m) === apT))
    violations.push({ rule: "saludo_repetido", detail: `abre otra vez con "${apT}"` });
  // R6 · Re-pregunta del nombre: ya pidió el nombre en un mensaje reciente y lo vuelve a pedir
  // (aunque cambie las palabras). Suena a robot repetitivo (fallo Carlos).
  if (FIELD_REASK.nombre_apellidos.test(t) && lastBotMsgs.some((m) => FIELD_REASK.nombre_apellidos.test(String(m))))
    violations.push({ rule: "repregunta_nombre", detail: "vuelve a pedir el nombre ya solicitado" });
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
    menciona_via_contacto: "Quita cualquier mención a 'carta', 'revista' o 'buzoneo'. Si hablas del origen, di solo 'con información pública'.",
    repregunta_dato: "Estás preguntando un dato que el propietario YA te dio. No lo repreguntes: úsalo y avanza a lo siguiente.",
    cierre_no_confirmado: "El cliente propuso un día/hora. Confírmalo explícitamente ('Perfecto, [día] a las [hora]. Le llama alguien del equipo a este número.') y para.",
    cierre_reabre_hora: "No vuelvas a preguntar la hora, el día ni el número: el cliente ya los dio. Solo confirma y cierra.",
    cierre_sin_nombre: "No agendes con la ficha vacía: acepta la llamada pero pide su nombre en el mismo mensaje ('¿cómo se llama, para dejarlo anotado?').",
    cierre_sin_repetir_hora: "Al confirmar la cita, REPITE el día y la hora que el cliente propuso ('Perfecto, [día] a las [hora]. Le llama alguien del equipo a este número.').",
    disculpa_repetida: "Ya te disculpaste en el mensaje anterior. NO abras otra vez con 'tiene razón/disculpe': cambia de enfoque o, si el cliente sigue molesto, ofrécele hablar con una persona del equipo.",
    presupone_situacion: "El cliente TODAVÍA no ha dicho que tenga ninguna propiedad, caso ni situación. QUITA por completo 'su situación', 'su caso', 'en qué punto está', 'su inmueble/edificio/propiedad'. Tras su nombre, pregunta SOLO abierto y corto, sin presuponer nada: 'Encantado, [nombre]. Cuénteme, ¿qué le ha traído a escribirnos?'.",
    saludo_repetido: "Ya abriste tu mensaje ANTERIOR con ese mismo saludo ('Perfecto, …' / 'Encantado, …' / 'Buenas, …'). NO lo repitas: entra DIRECTO al contenido, sin saludo ni el nombre al principio.",
    repregunta_nombre: "Ya le pediste el nombre en un mensaje reciente. NO lo vuelvas a pedir (ni con otras palabras): si no lo dio, sigue sin él y avanza con lo siguiente; si lo dio, úsalo.",
    cierre_con_pregunta_extra: "El cliente ya propuso día/hora: tu mensaje debe ser SOLO la confirmación ('Perfecto, [día] a las [hora]. Le llama alguien del equipo a este número.') y nada más. Quita cualquier otra pregunta o petición de dato de este mensaje.",
  };
  const uniq = [...new Set(violations.map((v) => v.rule))];
  const fixes = uniq.map((r) => `- ${map[r] || r}`).join("\n");
  return `Tu borrador anterior incumple estas reglas duras. Reescríbelo corrigiendo SOLO esto, mismo idioma y tono, y devuelve el mismo JSON:\n${fixes}`;
}

// ── fallback determinista (si la reparación tampoco pasa) ─────────────────────
export function hardFallback(text, ctx) {
  const { modes = {}, register = "usted", lastBotMsgs = [] } = ctx || {};
  const u = register === "tu"; // tú
  // R6 · Apertura repetida: si el borrador abre con el mismo saludo que el mensaje anterior,
  // quita la primera cláusula (el saludo) y deja el resto.
  {
    const apT = aperturaSaludo(text);
    if (apT && lastBotMsgs.length && aperturaSaludo(lastBotMsgs[lastBotMsgs.length - 1]) === apT) {
      const stripped = String(text || "").replace(/^\s*[¡¿"']?\s*[^.!?,]{0,40}[.,!]\s*/, "").trim();
      if (stripped && stripped.length > 8) text = stripped[0].toUpperCase() + stripped.slice(1);
    }
  }
  // NO-PRESUPOSICIÓN: si el cliente no reveló propiedad y el borrador presupone, reescribe a la
  // pregunta abierta limpia (determinista; funciona con cualquier modelo).
  if (!modes.propiedadRevelada && RE_PRESUPONE.test(String(text || ""))) {
    return u
      ? "Encantado. Cuéntame, ¿qué te ha traído a escribirnos?"
      : "Encantado. Cuénteme, ¿qué le ha traído a escribirnos?";
  }
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
