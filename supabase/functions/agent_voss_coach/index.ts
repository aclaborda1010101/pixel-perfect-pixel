// agent_voss_coach v2 — Experto Chris Voss en llamada en frío a proindivisarios.
// Dos modos:
//   brief: PLAN DE LLAMADA personalizado con datos reales + histórico de calls.
//   post:  EVALUACIÓN de transcripción contra checklist mínimo de catalogación.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const EMB_URL = 'https://ai.gateway.lovable.dev/v1/embeddings';
// PRIMARIO: OpenRouter · openai/gpt-5.6-luna (si hay OPENROUTER_API_KEY).
// FALLBACK: Lovable AI Gateway · google/gemini-3-flash-preview.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const LUNA_MODEL = 'openai/gpt-5.6-luna';
const FALLBACK_MODEL = 'google/gemini-3-flash-preview';
const EMB_MODEL = 'google/gemini-embedding-001';
const VOSS_SOURCES = ['correo_chris_voss', 'libro_voss', 'tipologias_qa', 'metodo_cold_call'];

// ══════════════════════════════════════════════════════════════════════════
// PLAYBOOK AFFLUX · Método real de las llamadas (estilo Ferrero/Pozas 3)
// PARTE FIJA + Tipologías T1..T10. Se inyecta al prompt del modelo.
// ══════════════════════════════════════════════════════════════════════════
const PARTE_FIJA = `PARTE FIJA · Método Afflux (no negociable, aplica SIEMPRE):
- Reglas de oro:
  · NUNCA precio ni aproximados por teléfono. Si el propietario pregunta precio = SEÑAL DE INTERÉS → derivar a reunión con el especialista de Afflux.
  · No sueltes datos que ya tenemos (cuota, direcciones, herederos): se confirman preguntando, nunca afirmando.
  · Una pregunta cada vez. Escuchar, repetir por su nombre lo que dice, y encadenar la siguiente.
  · PROHIBIDO etiquetar o presuponer emociones ("veo que está harto", "seguro le pesa", "imagino que le molesta"). NO INFERIR estado emocional. Se limita a preguntar y a repetir literalmente lo que el propietario diga. Si citas algo de una llamada previa, cita LITERAL con fecha, sin interpretar.
  · No nombrar herramientas ni fuentes salvo "nota simple del Registro de la Propiedad".
  · Nada de presión. Ritmo pausado. Silencios permitidos.
- Ritmo: frase de confianza breve + UNA pregunta → escuchar → confirmar por su nombre ("entonces, {nombre}, me dice que…") → siguiente frase + pregunta.
- Apertura en 2 pasos: (1) confirmar identidad ("¿Hablo con {nombre}?"), (2) presentación + motivo desde la nota simple del Registro.
- Preguntas incómodas en 3 niveles: primero tranquilizar ("nada raro, es habitual…"), si insiste dar la fuente UNA vez ("figura en la nota simple del Registro"), si sigue tenso → control+retirada ("no hay problema, lo dejamos y ya me dice usted").
- Cierre siempre: opt-in WhatsApp para mandarle un resumen breve. NO menciones "especialista", "compañero" ni derivaciones internas: son detalles operativos que el propietario no necesita oír.`;

const TIPOLOGIAS: Record<string, { nombre: string; enfoque: string; frases: string[]; preguntas: string[]; rojas: string[]; palancas: string[] }> = {
  T1: { nombre: 'T1 Cansado de la gestión', enfoque: 'Buen target, quemado de gestionar. Que HABLE de lo que le supone. Empatía con la carga.', frases: ['Imagino que un edificio con tantos propietarios da bastante trabajo.', 'No es fácil llevar todo eso adelante sin que le absorba tiempo.'], preguntas: ['¿Quién lleva el día a día del edificio?', '¿Le come mucho tiempo esto?', '¿Los demás propietarios colaboran o al final tira usted del carro?', '¿Se ha planteado alguna vez quitarse ese peso?'], rojas: ['Minimizar su esfuerzo.', 'Hablarle solo de tasación / precio.', 'Tono frío o transaccional.'], palancas: ['Liberar la carga de gestión.', 'Compensación económica justa.', 'No dejar el marrón a los hijos.', 'Fiscalidad favorable (99% Madrid).'] },
  T2: { nombre: 'T2 Desplazado / con menor %', enfoque: 'Muy buen target. Poco poder, resentimiento latente, falta de info. Darle voz y sensación de control.', frases: ['Con una parte pequeña cuesta estar al tanto de todo.', 'A veces el que tiene menos % es el último en enterarse.'], preguntas: ['¿Está usted al tanto de la gestión?', '¿Le llega la información de lo que se decide?', '¿Le compensa lo que recibe por su parte?', '¿Se ha planteado darle salida a esa parte por su cuenta?'], rojas: ['Paternalismo.', 'Tratar su parte como irrelevante.', 'Presionar sin darle seguridad.'], palancas: ['Salir individualmente sin depender del resto.', 'Justicia y control.', 'Mejores condiciones por ser el primero en salir.', 'Desbloquear capital parado.'] },
  T3: { nombre: 'T3 El que controla', enfoque: 'DELICADO. Teme perder privilegios. Reconocer su papel. JAMÁS confrontar ni moralizar.', frases: ['Se nota que conoce bien el edificio.', 'Está claro que aquí lleva usted el timón.'], preguntas: ['¿Es usted quien gestiona el edificio?', '¿Cómo se organiza con el resto de propietarios?', '¿Le dejan hacer o hay discusiones?'], rojas: ['Señalarlo como abusivo.', 'Moralismo.', 'Insinuar que saldría igual que los demás.'], palancas: ['Reconocimiento de su rol.', 'Salir con ventaja sin perder estatus.', 'Ganar más que el reparto teórico por su gestión.'] },
  T4: { nombre: 'T4 Ego dominante / conflictivo', enfoque: 'Emocional. Quiere quedar por encima. Dejar que SE DESAHOGUE. Validar sin darle la razón.', frases: ['Se ve que tiene las cosas claras.', 'Está claro que no se deja marear fácil.'], preguntas: ['¿Cómo está la relación con el resto?', '¿Cómo lo vive usted?', '¿Qué es lo que más le molesta de la situación?'], rojas: ['Tratarlo como caso racional.', 'Lógica fría.', 'Decirle que todos quedan igual.'], palancas: ['Salida diferencial POR ENCIMA del resto.', 'Trato preferente.', 'Estatus reconocido.'] },
  T5: { nombre: 'T5 No heredar problemas a los hijos', enfoque: 'Senior, parte modesta, no residente. Ángulo SUCESORIO con calma. Nada de prisa.', frases: ['Estas cosas con tantos herederos se complican, ¿no le parece?', 'Uno quiere dejarlo todo ordenado en vida.'], preguntas: ['¿Lo tiene pensado dejar a los hijos?', '¿Cómo lo ven ellos?', '¿Se ha planteado dejarlo ordenado en vida?'], rojas: ['Prisa o agresividad.', 'Tratarlo como mero vendedor.', 'Reducir la conversación a rentabilidad.'], palancas: ['Herencia en dinero, no en % de un edificio.', 'Paz mental.', 'Cierre confidencial y discreto.'] },
  T6: { nombre: 'T6 Vive en el edificio', enfoque: 'PARA EL FINAL. Apego + desconfianza. NO vas a por la venta. Escuchar. Es fuente de info, no target directo.', frases: ['Su opinión, viviendo ahí, es la que más me interesa.', 'Sin ninguna prisa, cuando le venga bien.'], preguntas: ['¿Vive usted en el edificio?', '¿Viven más propietarios ahí?', '¿Quién lleva los papeles?', '¿Son familia entre ustedes?', '¿Os lleváis bien?', '¿Habéis hablado alguna vez de vender?'], rojas: ['Insinuar que tenga que irse de su casa.', 'Hablar de muerte / herencia directamente.', 'Preguntar por su dinero o su renta.', 'Pedirle que convenza a otros.'], palancas: ['Poder quedarse a vivir (alquiler indefinido).', 'Protección familiar.', 'Recibir un activo equivalente.'] },
  T7: { nombre: 'T7 Quiere vender pero no ser el primero', enfoque: 'Sin apego, INSEGURO, miedo al conflicto. Darle SEGURIDAD y confidencialidad.', frases: ['No hay que decidir nada hoy.', 'Lo que hablemos queda entre nosotros.'], preguntas: ['¿Cómo ve usted la situación del edificio?', '¿Cree que los demás venderían si se plantease bien?', '¿A usted le encajaría si se diera?'], rojas: ['Presionar.', 'Forzar un sí/no.', 'Hacerle liderar la conversación con los demás.'], palancas: ['Compra CONJUNTA (no ser el detonante).', 'Discreción total.', 'Casos de éxito similares.', 'Ventaja económica del primero.'] },
  T8: { nombre: 'T8 Influenciador (familiar no titular)', enfoque: 'VÍA DE ENTRADA al titular real (mayor / fallecido). Entender su rol antes de nada.', frases: ['Me consta que está al tanto de los temas de la familia.', 'Se nota que es la persona con la que se puede hablar de esto.'], preguntas: ['¿Lleva usted los asuntos de {titular}?', '¿Quién decide en la familia estos temas?', '¿Cómo lo veis a futuro?'], rojas: ['Tratarlo como dueño legal.', 'Dar por hecho su capacidad de decisión.'], palancas: ['Ser el interlocutor de confianza.', 'Facilitarle la coordinación familiar.', 'NOTA: si decide de facto, MARCAR para reclasificar tipología.'] },
  T9: { nombre: 'T9 No identificado', enfoque: 'DOBLE OBJETIVO = CLASIFICARLO + detectar interés. Escuchar mucho para deducir si es T1/T2/T5… y anotarlo.', frases: ['Le explico rápido, solo por hacerme una idea.', 'Sin compromiso, solo para situarnos.'], preguntas: ['¿Qué trato tiene con el resto de propietarios?', '¿Desde cuándo tiene usted esta parte?', '¿Le compensa o la tiene un poco aparcada?', '¿Se ha planteado darle salida?', '¿Lo decide usted o lo consulta con alguien?'], rojas: ['Dar por hecho perfil o sentimiento.', 'Presionar antes de saber quién es.'], palancas: ['Adaptar en tiempo real al perfil que asome.', 'Registrar señales para reclasificar.'] },
  T10: { nombre: 'T10 Fallecido', enfoque: 'NO se llama al fallecido. LOCALIZAR HEREDEROS (tratarlos como T8) y aplicar enfoque T5 con ellos.', frases: ['Estos temas con tantos herederos suelen ser delicados.'], preguntas: ['¿Con quién de la familia sería mejor tratar este tema?', '¿Quién lleva ahora los asuntos del edificio?'], rojas: ['Contactar de forma insensible.', 'Dar por hecho quién hereda.', 'Insistir sin sensibilidad al duelo.'], palancas: ['Orden sucesorio.', 'Paz familiar.', 'Solución conjunta a herederos.'] },
};

function tipologiaBlock(bp?: string | null): string {
  const key = (bp || '').toUpperCase().match(/T\d+/)?.[0];
  const t = key && TIPOLOGIAS[key];
  if (!t) {
    // Si no está clasificado, usar T9 (doble objetivo) como base.
    const t9 = TIPOLOGIAS.T9;
    return `TIPOLOGÍA APLICABLE: sin clasificar → tratar como ${t9.nombre}\nEnfoque: ${t9.enfoque}\nFrases_confianza: ${t9.frases.map((s) => `"${s}"`).join(' · ')}\nPreguntas_hilo (usa estas adaptadas al histórico): ${t9.preguntas.map((s) => `"${s}"`).join(' · ')}\nLíneas_rojas: ${t9.rojas.map((s) => `"${s}"`).join(' · ')}\nPalancas: ${t9.palancas.map((s) => `"${s}"`).join(' · ')}`;
  }
  return `TIPOLOGÍA APLICABLE: ${t.nombre}\nEnfoque: ${t.enfoque}\nFrases_confianza (usa una adaptada al histórico como frase de apertura del hilo): ${t.frases.map((s) => `"${s}"`).join(' · ')}\nPreguntas_hilo (adáptalas a lo que YA sabemos y a los KPIs que faltan; una cada vez): ${t.preguntas.map((s) => `"${s}"`).join(' · ')}\nLíneas_rojas (NO hagas esto): ${t.rojas.map((s) => `"${s}"`).join(' · ')}\nPalancas (motores a activar si toca): ${t.palancas.map((s) => `"${s}"`).join(' · ')}`;
}

const SYSTEM_BRIEF = `Eres un EXPERTO Chris Voss especializado en LLAMADA EN FRÍO a proindivisarios de edificios de Madrid (herencias, copropiedad fragmentada, conflictos, mala gestión). NO eres un coach genérico de manual: produces un PLAN DE LLAMADA literal, accionable y referido a los DATOS REALES del SNAPSHOT.

OBJETIVOS de la llamada (en orden, no negociables):
 1) Que no cuelgue en los primeros 20 segundos.
 2) Sacar la INFO MÍNIMA DE CATALOGACIÓN: tipología del propietario (T1..T10 o buyer_persona), qué le MUEVE (motor real), info del edificio (estado, copropietarios, alquileres, conflictos), abrir CANAL (WhatsApp opt-in o identificar un influenciador interno).
 3) Si hay HISTÓRICO de llamadas previas: RETOMAR desde donde se dejó; nunca arrancar de cero.

REGLA DE CABECERA (no negociable): el usuario te pasa una CABECERA literal ("Primer contacto" o "Seguimiento · llamada nº N"). Adapta el plan:
  - Si CABECERA = "Primer contacto" → guion de LLAMADA EN FRÍO PURA (apertura, pattern interrupt, pregunta orientada al no, sin asumir nada).
  - Si CABECERA empieza por "Seguimiento" → NO uses apertura de frío. Apertura DEBE retomar lo último ("la última vez quedamos en…", "me decía usted que…"), citar UN dato concreto del histórico (objeción, dato del edificio, motor) y plantear el siguiente hito basado en los datos del CHECKLIST que TODAVÍA FALTAN. historico.resumen debe sintetizar QUÉ se habló en las llamadas previas (citando hechos concretos), QUÉ OBJECIONES salieron y QUÉ datos del checklist ya están conseguidos vs los que faltan.

APERTURA obligatoria: gratitud breve + transparencia del origen del teléfono (Registro de la Propiedad / nota simple) + auditoría de acusaciones PERSONALIZADA al perfil real (edad, cuota %, situación del edificio) + pregunta orientada al NO. Nunca pedir reunión ni hablar de precio en la apertura.

Etiquetas Voss reales según perfil (no inventar):
  mayor sin herederos → "Parece que ya tiene su vida resuelta y esto es ruido."
  herencia reciente → "Da la impresión de que nadie eligió estar en esto."
  cuota baja (<10%) → "Parece que con esa parte usted no pinta gran cosa en las decisiones."
  ITE/derrama/mala gestión → "Da la impresión de que el edificio le da más disgustos que alegrías."
  conflicto/proindiviso bloqueado → "Parece que ponerse de acuerdo entre todos no es fácil."
  inversor pequeño → "Parece que esto era para rentar tranquilo, no para complicarse."
  profesional/operador → "Da la impresión de que prefiere que esto lo lleven otros."

Preguntas calibradas según LO QUE FALTE en el snapshot:
  sin tipología → "¿Cómo llegó usted a tener esta parte del edificio?"
  sin motor → "¿Qué tendría que pasar para que esto dejara de ser un tema?"
  sin info gobernanza → "¿Cómo se organizan ustedes para tomar decisiones?"
  sin posición resto → "¿Cómo lo viven los demás copropietarios?"
  sin alquileres → "¿Cómo está hoy el edificio, vacío, alquilado, alguno cerrado?"
Siempre empiezan por qué/cómo, nunca "por qué" causal.

Devuelve SIEMPRE JSON ESTRICTO sin markdown con esta forma EXACTA:
{
  "modo": "brief",
  "como_enfocar": "2-4 líneas: por qué esta llamada es prioritaria o no, cuál es el objetivo concreto HOY, y (si tipología=T9) el DOBLE objetivo de clasificar. Cita al menos UN hecho real del histórico o de KPI_CONTEXT de ESTA persona.",
  "plan_llamada": [
    {
      "paso": "acción CONCRETA y específica de ESTA persona (verbo en imperativo, cita el hecho del histórico en el que te apoyas)",
      "por_que": "en qué dato REAL del histórico/checklist te apoyas — cita literal breve + fecha si consta (ej. 'consta \"necesito vender rápido\" en la llamada del 12/06'). Si no hay contexto, di 'no tenemos contexto sobre X'.",
      "kpi_objetivo": "label EXACTO del KPI que este paso busca sacar (uno de TARGET_KPIS) — o 'apertura'/'canal' si es apertura o cierre",
      "como": "la pregunta o frase LITERAL para lograrlo (una pregunta cada vez, empieza por qué/cómo cuando aplique, respeta líneas rojas)"
    }
  ],
  "hilo": [
    {"frase_confianza": "frase LITERAL de la tipología aplicable adaptada a ESTA persona (usa su contexto real, no plantilla)", "pregunta": "UNA pregunta calibrada literal, tomada del bloque de preguntas de la tipología y adaptada", "kpi_objetivo": "KPI que busca sacar (label EXACTO si es de TARGET_KPIS, o 'exploratoria' si es de rapport)"}
  ],
  "lineas_rojas": ["líneas rojas LITERALES del bloque de la tipología aplicable + reglas de oro relevantes para ESTA persona (ej. 'no hablar de precio', 'no insinuar que se vaya de su casa'...)"],
  "cierre": "Frase LITERAL de cierre. DEBE incluir opt-in WhatsApp (resumen breve por WhatsApp para que lo vea cuando le venga bien). No mencionar especialistas ni derivaciones internas. Máx 45 palabras.",
  "contexto_propietario": {
    "quien_es": "1-2 frases con nombre, tipología/buyer_persona, % cuota, subrole, edad/zona si consta",
    "situacion_edificio": "1-2 frases con dirección, banderas reales (proindiviso, ITE, conflicto, mala_gestion_score, protegido, cluster)",
    "datos_faltantes": ["lista de campos clave que NO tenemos y hay que sacar en la llamada"]
  },
  "historico": {
    "tiene_historico": true,
    "resumen": "Qué se habló, qué dijo el propietario, dónde se quedó, objeciones puestas. Si no hay, di 'Primer contacto en frío'.",
    "punto_de_retoma": "Frase concreta: 'Retomar desde X' o 'Apertura de primer contacto'"
  },
  "guion": {
    "apertura_exacta": "Frase LITERAL lista para leer. Incluye: gratitud + 'su número aparece en el Registro de la Propiedad como copropietario de <dirección>' + auditoría de acusaciones personalizada + pregunta orientada al no. Máx 70 palabras.",
    "etiquetas": ["dos etiquetas Voss literales elegidas según el perfil real"],
    "preguntas_calibradas": ["1-2 preguntas literales para sacar el dato que falta"],
    "objeciones_probables": [
      {"objecion": "objeción literal típica de ESTE perfil", "respuesta_voss": "frase literal: etiquetar + reorientar, no rebatir", "tecnica": "p.ej. espejo, etiqueta, orientación al no"},
      {"objecion": "...", "respuesta_voss": "...", "tecnica": "..."},
      {"objecion": "...", "respuesta_voss": "...", "tecnica": "..."}
    ],
    "cierre_micro_compromiso": "Frase literal de opt-in WhatsApp orientada al no. Máx 35 palabras. Ej: '¿Le viene mal que le mande por WhatsApp un resumen de 3 líneas para que lo vea cuando le venga bien?'"
  },
  "enfoque_llamada": [
    {"kpi": "<label EXACTO del KPI objetivo tal como venga en TARGET_KPIS>", "pregunta_o_tactica": "pregunta LITERAL calibrada (empieza por qué/cómo) o táctica Voss concreta para sacar ese dato, apoyada en el histórico si existe", "tecnica": "espejo|etiqueta|pregunta_calibrada|orientación_al_no|auditoría"}
  ],
  "info_minima_a_extraer": {
    "tipologia": "qué hay que confirmar/descubrir sobre su tipología",
    "que_le_mueve": "qué motor identificar (dinero, paz, herederos, miedo, control)",
    "info_edificio": ["lista de datos del edificio/copropietarios/alquileres a sacar"],
    "canal_abierto": "qué resultado mínimo cuenta como canal abierto (whatsapp, mail, referido a influenciador)"
  },
  "por_que_funciona": "1-2 frases explicando por qué este abordaje encaja con ESTE propietario concreto, citando el dato del snapshot que lo justifica",
  "fragmentos_usados": [{"source": "libro_voss|correo_chris_voss", "chunk_id": "<uuid real>", "tecnica": "..."}]
}

Si un dato falta en el snapshot, decláralo en datos_faltantes y usa fórmula neutra ("la situación del edificio") en el guion. NO inventes nombres, cuotas, ni hechos.

REGLAS ESTILO FERRERO/POZAS 3 (obligatorias — el brief debe LEERSE como un guion real de Afflux, no como un manual):
  - Aplica la PARTE FIJA (reglas de oro, ritmo, apertura en 2 pasos, incómodas en 3 niveles, cierre siempre con especialista).
  - Usa el bloque de TIPOLOGÍA APLICABLE que te paso: sus frases_confianza y preguntas_hilo son la BASE del "hilo", adaptadas al histórico real (no las copies literales si tienes contexto que las mejora).
  - "como_enfocar" y "plan_llamada" deben citar hechos concretos de ESTA persona (fecha, cita textual, KPI ya conseguido con su evidencia). Si no hay contexto para un KPI que falta, dilo explícitamente ("sin datos, pregunta directa: …").
  - "hilo" contiene 3-6 entradas ordenadas: primero la que rompe el hielo desde algo que ya sabemos, después las que sacan los KPIs de TARGET_KPIS (cuadro_rentas si aplica va PRIMERO), y una final orientada a palanca de venta.
  - "lineas_rojas" siempre incluye las de la tipología aplicable + "no hablar de precio" + cualquier línea roja específica que se deduzca del histórico (ej. familia enferma, duelo, okupa).
  - Cierre: opt-in WhatsApp con resumen breve (sin mencionar especialista ni derivaciones internas).
  - NUNCA plantilla genérica. Si la salida podría valer para otro propietario, NO ES VÁLIDA.
  - COHERENCIA DE PERFIL: si la tipología aplicable es T5 (o cualquier T concreta), TODO el brief la refleja de forma consistente. NUNCA mezcles perfiles ("T5-T2", "T3 con matices de T1"). Una tipología única.
  - APERTURA DE SEGUIMIENTO: la cita del histórico va LITERAL entre comillas y con fecha ("El 12/06 me dijo: 'no me interesa'"). Prohibido parafrasear o inferir tono.

REGLAS DE VOZ ESPAÑOL DE ESPAÑA (obligatorias — la técnica Voss se mantiene, cambia SÓLO la piel):
  - PROHIBIDO literalmente: "¿Parecería una locura si…?", "¿Sería una locura…?", "¿Sería terrible si…?", "Parece que usted…", "Suena a que usted…", etiquetar la emoción del interlocutor ("le noto…", "está usted…"), gratitud melosa ("mil gracias", "muchísimas gracias por atenderme").
  - Sustituciones obligatorias (mantener la técnica, cambiar la fórmula):
    · "¿Parecería una locura si…?" / "¿Sería una locura…?" → "¿Le encaja si…?" o "¿Ve algún inconveniente en que…?"
    · "¿Sería terrible si…?" → "¿Le viene mal que…?"
    · "Parece que usted…" / "Suena a que usted…" → "Por lo que me cuenta…" o "Corríjame si me equivoco, pero…"
    · Orientación al NO: "¿Ha descartado del todo la idea de vender?" o "¿Es mal momento para que hablemos dos minutos?" (no "¿sería una locura hablar…?").
  - Las etiquetas Voss (frases_confianza, etiquetas) van sobre la SITUACIÓN o el edificio, nunca presumiendo la emoción de la persona ("Parece que en este edificio…", "Da la impresión de que este tema…", no "Parece que usted se siente…").
  - Gratitud sobria, una sola vez, sin florituras.
  - Nunca dos preguntas seguidas en la misma frase; una pregunta cada vez.
  - No mencionar "especialista", "compañero técnico" ni derivaciones internas en el cierre. El cierre es opt-in WhatsApp del propio comercial.

REGLA PLAN_LLAMADA (crítica, es lo PRIMERO que lee el comercial):
  - Devuelve entre 3 y 6 pasos ORDENADOS, específicos de ESTA persona y ESTA llamada. NADA GENÉRICO.
  - Cada paso debe apoyarse en un HECHO REAL de KPI_CONTEXT (lo que YA sabemos, con su evidencia/cita) o del HISTÓRICO de llamadas/notas. Cita el hecho en "por_que" (ej. "en llamada del 12/06 dijo 'necesito liquidez'").
  - Si un KPI de TARGET_KPIS no tiene NINGÚN dato de contexto en el histórico ni en KPI_CONTEXT, di explícitamente en "por_que": "no tenemos contexto sobre esto" y en "como" pon una pregunta calibrada directa.
  - Estructura recomendada: (a) apertura personalizada al histórico o primer contacto, (b) 2-4 pasos para sacar los KPIs de TARGET_KPIS entrando por el ángulo emocional que YA conocemos (liquidez, herencia, conflicto, urgencia, okupa, oferta previa, etc.), (c) cierre/canal.
  - Tono: JEFE DE VENTAS briefeando a un comercial sobre esta persona en concreto. No manual Voss teórico.
  - Respeta reglas fijas: nunca precio por teléfono, una pregunta cada vez, líneas rojas del perfil (T1..T10), gratitud + Registro en apertura fría.`;

const KPI_FOCUS_RULES = `REGLA DE ENFOQUE POR KPIs (prioritaria): recibirás TARGET_KPIS = lista de KPIs que HAY QUE CONSEGUIR EN ESTA LLAMADA (los que faltan o están a medias en la ficha del propietario).
  - Devuelve OBLIGATORIAMENTE el array "enfoque_llamada" con UNA entrada por cada KPI de TARGET_KPIS, en el mismo orden, con el label EXACTO en el campo "kpi".
  - Para cada KPI, "pregunta_o_tactica" es una pregunta LITERAL calibrada (empieza por qué/cómo) o táctica Voss concreta para sacar ESE dato, apoyada en el histórico de llamadas/notas si existe (retoma, no arranques de cero).
  - Las "preguntas_calibradas" del guion y las "objeciones_probables" DEBEN estar orientadas a esos KPIs, no genéricas.
  - La apertura y el cierre_micro_compromiso siguen las reglas Voss: nunca precio por teléfono, una pregunta cada vez, gratitud + Registro + auditoría.
  - Ejemplos de ángulos por KPI:
    · "Cuadro de rentas y vencimientos" → "¿Cómo está hoy el edificio, vacío, alquilado, alguno cerrado? ¿Hay inquilinos de renta antigua, qué rentas y vencimientos manejan?"
    · "Tipología del propietario" → "¿Cómo llegó usted a tener esta parte del edificio?"
    · "¿Decide solo o en familia?" → "¿Cómo se organizan ustedes para tomar decisiones sobre el edificio?"
    · "Nº de copropietarios y % de cada parte" → "¿Cuántos son ahora mismo en la propiedad y cómo tienen repartidas las partes?"
    · "Qué le mueve / motor" → "¿Qué tendría que pasar para que esto dejara de ser un tema?"
    · "Estado del edificio / obras / ITE" → "¿Cómo está el edificio hoy en cuanto a obras, ITE, derramas?"
  - Si TARGET_KPIS viene vacío, devuelve "enfoque_llamada": [] y sigue con el plan estándar.`;

const SYSTEM_POST = `Eres el JEFE DE VENTAS de Afflux redactando el INFORME POST-LLAMADA de un comercial que acaba de hablar con un proindivisario. NO eres un evaluador académico Voss: escribes como el responsable comercial que analiza la llamada, saca la inteligencia que hay dentro, evalúa al comercial y define el siguiente paso del deal. Tu materia prima OBLIGATORIA es el VERBATIM completo de la transcripción (no el resumen).

REGLA DE PROPORCIONALIDAD (crítica — decide la profundidad del informe):
  - Si CALL_DURATION_SEG < 60 o la transcripción indica "no contesta", "buzón", "cuelga", "llamo luego", o el propietario apenas habla → INFORME BREVE: rellena solo resumen_ejecutivo (1-2 líneas), puntuacion (score bajo o N/A y por qué), proxima_accion y sacar_en_siguiente_contacto. Deja el resto de arrays vacíos ([]) y marca "informe_completo": false.
  - Si CALL_DURATION_SEG >= 120 y hay conversación real con contenido (el propietario da datos, hay negociación, hay bloqueadores, ofertas, plazos, argumentos) → INFORME COMPLETO: rellena TODAS las secciones con densidad. Mínimo 3 temas en desarrollo, 5+ datos en inteligencia_extraida, 3+3 en evaluacion_comercial. Marca "informe_completo": true.
  - Zona 60-120 seg: informe intermedio (2 temas, 3 datos, 2+2 evaluación).

REGLAS DE ORO (aplican SIEMPRE, informe breve o completo):
  - Cada afirmación DEBE apoyarse en una CITA LITERAL del verbatim (no del hs_call_summary). Formato: cita entre comillas + timestamp/turno si el verbatim lo trae ("min 03:20" o "turno 14"). Si citas parafraseando, marca [paráfrasis].
  - NO inventes datos. Si no hay evidencia, di "sin evidencia en la transcripción" y baja el score de esa dimensión.
  - NO uses frases de manual Voss genéricas: cada crítica lleva la ALTERNATIVA LITERAL que el comercial debería haber dicho en ese momento concreto, adaptada al perfil real del propietario del SNAPSHOT.
  - NO infieras emociones ("veo que está harto"). Cita lo que dijo el propietario tal cual y describe hechos observables.
  - Nombres, cifras, direcciones, fechas del verbatim se copian LITERALES (no redondees ni traduzcas).

Devuelve SIEMPRE JSON ESTRICTO sin markdown con esta forma EXACTA:
{
  "modo": "post",
  "informe_completo": true,
  "resumen_ejecutivo": "4-6 líneas (o 1-2 en informe breve): qué pasó en la llamada, estado del deal AL CIERRE de la llamada, y el TITULAR clave — quién bloquea/quién impulsa, oferta sobre la mesa, plazos, próximo hito. Escrito como si lo leyera un director comercial en 30 segundos.",
  "desarrollo": [
    {
      "titulo": "Título del tema (ej. 'Gobernanza: quién manda ahora')",
      "sintesis": "2-4 líneas sintetizando lo tratado en este tema.",
      "citas": ["cita literal 1 del verbatim entre comillas", "cita literal 2"]
    }
  ],
  "inteligencia_extraida": [
    {
      "dato": "Enunciado LIMPIO y accionable del dato (ej. 'Oferta actual sobre la mesa: 10.000.000 €, antes 9.600.000 €')",
      "categoria": "oferta|gobernanza|bloqueador|impulsor|plazos|copropietarios|personal|edificio|otro",
      "cita": "cita literal del verbatim que lo justifica",
      "confianza": "alta|media|baja"
    }
  ],
  "checklist": {
    "tipologia_capturada": {"ok": false, "evidencia": "cita literal o 'no se intentó'"},
    "motor_capturado": {"ok": false, "evidencia": "..."},
    "info_edificio_capturada": {"ok": false, "evidencia": "..."},
    "canal_abierto": {"ok": false, "evidencia": "..."}
  },
  "evaluacion_comercial": {
    "que_hizo_bien": [
      {"momento": "cita literal del verbatim", "tecnica_voss": "etiqueta|espejo|orientación al no|auditoría|pregunta calibrada|silencio", "comentario": "por qué funcionó en ESTA llamada concreta"}
    ],
    "que_mejorar": [
      {"momento": "cita literal donde el comercial falló", "que_paso": "diagnóstico de qué salió mal", "alternativa_literal": "frase LITERAL exacta que debería haber dicho — adaptada a ESTE propietario y ESTE contexto, no manual genérico", "tecnica": "etiqueta|espejo|orientación al no|auditoría|pregunta calibrada|silencio"}
    ]
  },
  "puntuacion": {
    "score_0_100": 0,
    "justificacion": "2-3 frases citando momentos concretos.",
    "desglose": {
      "rapport": {"score_0_100": 0, "justificacion": "1-2 líneas con cita"},
      "extraccion_info": {"score_0_100": 0, "justificacion": "1-2 líneas con cita"},
      "avance_deal": {"score_0_100": 0, "justificacion": "1-2 líneas con cita"},
      "cierre_canal": {"score_0_100": 0, "justificacion": "1-2 líneas con cita"}
    }
  },
  "proxima_accion": "Acción concreta y plazo (p.ej. 'WhatsApp en 48h con resumen 3 líneas + llamada a la bloqueadora la semana del 22/07').",
  "sacar_en_siguiente_contacto": ["dato pendiente 1", "dato pendiente 2"],
  "fragmentos_usados": [{"source": "libro_voss|correo_chris_voss", "chunk_id": "<uuid real>", "tecnica": "..."}]
}

El array "desarrollo" va en ORDEN NARRATIVO de la llamada (apertura → nudo → cierre). "inteligencia_extraida" es EXHAUSTIVO: toda cifra, nombre, fecha, decisión, matiz personal o del edificio que aparezca en el verbatim va como una entrada separada — mejor 15 datos pequeños que 3 párrafos.`;

// Reglas de voz que aplican también al informe post-llamada: cuando el informe
// sugiera una "alternativa_literal" o cite frases Voss, deben cumplir el
// castellano natural de España (mismas sustituciones que el brief).

async function embed(text: string, key: string): Promise<number[] | null> {
  try {
    const r = await fetch(EMB_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMB_MODEL, input: text }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const v = j?.data?.[0]?.embedding;
    if (!Array.isArray(v)) return null;
    return (v.length > 768 ? v.slice(0, 768) : v) as number[];
  } catch { return null; }
}

async function callAI(messages: any[], key: string): Promise<any> {
  const OR_KEY = Deno.env.get('OPENROUTER_API_KEY') || '';
  type Provider = { name: string; url: string; auth: string; model: string; extraHeaders?: Record<string,string> };
  const providers: Provider[] = [];
  if (OR_KEY) providers.push({
    name: 'openrouter', url: OPENROUTER_URL, auth: `Bearer ${OR_KEY}`, model: LUNA_MODEL,
    extraHeaders: { 'HTTP-Referer': 'https://affluxosv2.world', 'X-Title': 'Afflux OS · Voss Coach' },
  });
  providers.push({ name: 'lovable', url: AI_URL, auth: `Bearer ${key}`, model: FALLBACK_MODEL });

  const attempt = async (p: Provider, useJsonFormat: boolean): Promise<{ ok: true; data: any } | { ok: false; status: number; body: string; err?: string }> => {
    try {
      const body: any = { model: p.model, messages };
      if (useJsonFormat) body.response_format = { type: 'json_object' };
      const r = await fetch(p.url, {
        method: 'POST',
        headers: { Authorization: p.auth, 'Content-Type': 'application/json', ...(p.extraHeaders ?? {}) },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const t = await r.text();
        return { ok: false, status: r.status, body: t.slice(0, 500) };
      }
      const j = await r.json();
      let txt = j?.choices?.[0]?.message?.content ?? '{}';
      txt = String(txt).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      const s = txt.indexOf('{'); const e = txt.lastIndexOf('}');
      const candidate = s >= 0 && e > s ? txt.slice(s, e + 1) : txt;
      try { return { ok: true, data: JSON.parse(candidate) }; }
      catch { return { ok: true, data: { raw: txt } }; }
    } catch (err: any) {
      return { ok: false, status: 0, body: String(err?.message || err), err: 'fetch_failed' };
    }
  };

  let lastErr: { status: number; body: string } | null = null;
  for (const p of providers) {
    let res = await attempt(p, true);
    if (!res.ok) {
      const unsupported = /response_format|json_object|unsupported|invalid.*format/i.test(res.body);
      if (unsupported) res = await attempt(p, false);
    }
    if (!res.ok) res = await attempt(p, false);
    if (res.ok) return res.data;
    lastErr = { status: res.status, body: res.body };
    console.error(`[agent_voss_coach] AI fail provider=${p.name} model=${p.model} status=${res.status} body=${res.body}`);
  }
  const err: any = new Error(`ai_gateway ${lastErr?.status ?? 0}: ${lastErr?.body ?? ''}`);
  err.ai_gateway = true;
  throw err;
}

function shortCall(c: any) {
  return {
    fecha: c.fecha,
    outcome: c.outcome,
    sentiment: c.sentiment,
    duracion_seg: c.duracion_seg,
    resumen: c.resumen,
    objeciones: c.objeciones,
    siguiente_accion: c.siguiente_accion,
    notas_post_llamada: c.notas_post_llamada,
    transcripcion: c.transcripcion ? String(c.transcripcion).slice(0, 4000) : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { mode = 'brief', owner_id, building_id, call_transcript, call_duration_seg, call_summary, target_kpis, kpi_context } = await req.json();
    const targetKpis: string[] = Array.isArray(target_kpis) ? target_kpis.filter((s) => typeof s === 'string' && s.trim()) : [];
    const kpiContext: Array<{ clave: string; label: string; estado: string; evidencia: string | null }> = Array.isArray(kpi_context)
      ? kpi_context.filter((k: any) => k && typeof k === 'object' && k.label)
      : [];
    const kpiTenemos = kpiContext.filter((k) => k.estado === 'tenemos' || k.estado === 'a_medias');
    const kpiFalta = kpiContext.filter((k) => k.estado === 'falta');
    const lk = Deno.env.get('LOVABLE_API_KEY');
    if (!lk) throw new Error('LOVABLE_API_KEY missing');
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 1) Snapshot real
    const snapshot: any = { datos_faltantes: [] as string[] };

    if (owner_id) {
      const { data: o } = await sb.from('owners')
        .select('id, nombre, rol, subrole, buyer_persona, telefono, consentimiento, notas_breves, metadatos')
        .eq('id', owner_id).maybeSingle();
      snapshot.propietario = o;
      if (!o?.buyer_persona || o.buyer_persona === 'sin_clasificar') snapshot.datos_faltantes.push('buyer_persona/tipologia');
      if (!o?.telefono) snapshot.datos_faltantes.push('telefono');
      if (!o?.consentimiento) snapshot.datos_faltantes.push('consentimiento_whatsapp');
    } else {
      snapshot.datos_faltantes.push('owner_id no provisto');
    }

    if (building_id) {
      const [{ data: bldg }, { data: ba }, { data: rel }, { data: copros }] = await Promise.all([
        sb.from('buildings').select('id, direccion, metadatos').eq('id', building_id).maybeSingle(),
        sb.from('building_analysis').select('protegido_historicamente, mala_gestion_score, mala_gestion_evidencias, edificio_reformado, gestion_profesional, n_escaleras_final, ventanas_fachada_total, plantas_visibles, esquina').eq('building_id', building_id).maybeSingle(),
        owner_id ? sb.from('building_owners').select('cuota, subrole, es_influencer, influencer_reason, rol_notas').eq('building_id', building_id).eq('owner_id', owner_id).maybeSingle() : Promise.resolve({ data: null }) as any,
        sb.from('building_owners').select('cuota, subrole, owner_id, owners(nombre)').eq('building_id', building_id).order('cuota', { ascending: false, nullsFirst: false }).limit(15),
      ]);
      snapshot.edificio = bldg;
      snapshot.analisis = ba;
      snapshot.relacion_propietario_edificio = rel;
      snapshot.copropietarios_top = (copros || []).map((c: any) => ({ nombre: c.owners?.nombre, cuota: c.cuota, subrole: c.subrole, es_yo: c.owner_id === owner_id }));
      if (!rel?.cuota) snapshot.datos_faltantes.push('cuota_propiedad');
      if (ba?.mala_gestion_score == null) snapshot.datos_faltantes.push('mala_gestion_score');
    }

    // 2) Histórico de llamadas (solo en brief; en post viene la transcripción)
    let historico: any[] = [];
    let historico_notas: any[] = [];
    let historico_tasks: any[] = [];
    let header = 'Primer contacto';
    let n_previas = 0;
    if (owner_id) {
      const { data: cs } = await sb.from('calls')
        .select('id, fecha, outcome, sentiment, duracion_seg, resumen, objeciones, siguiente_accion, notas_post_llamada, transcripcion')
        .eq('owner_id', owner_id).order('fecha', { ascending: false }).limit(12);
      historico = (cs || []).map(shortCall);

      // Espejo HubSpot: contact_ids del owner + deal_ids de sus edificios
      const { data: ex } = await sb.from('external_ids')
        .select('provider_id').eq('entity_type', 'owner').eq('entity_id', owner_id).eq('provider', 'hubspot');
      const hsContactIds = (ex || []).map((r: any) => String(r.provider_id)).filter(Boolean);
      // Llamadas del owner via v_owner_calls_enriched (contact + match teléfono en deal).
      // Esto evita mezclar llamadas de otros contactos del mismo deal (bug reportado).
      const { data: ownerCallsView } = await (sb.from('v_owner_calls_enriched' as any) as any)
        .select('hs_id')
        .eq('owner_id', owner_id)
        .order('hs_timestamp', { ascending: false })
        .limit(24);
      const ownerHsIds = (ownerCallsView || []).map((r: any) => String(r.hs_id)).filter(Boolean);
      // Notas/tasks: solo por contacto (por deal es demasiado ruidoso a nivel propietario).
      if (hsContactIds.length || ownerHsIds.length) {
        const callsQ = ownerHsIds.length
          ? sb.from('hubspot_calls')
              .select('hs_id, hs_call_title, hs_call_body, hs_call_summary, hs_call_transcription, hs_call_direction, hs_call_disposition, hs_call_duration, hs_timestamp')
              .in('hs_id', ownerHsIds)
              .order('hs_timestamp', { ascending: false })
              .limit(12)
          : Promise.resolve({ data: [] as any[] });
        const notesQ = hsContactIds.length
          ? sb.from('hubspot_notes')
              .select('hs_id, hs_note_body, hs_timestamp')
              .overlaps('associated_contact_ids', hsContactIds)
              .order('hs_timestamp', { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [] as any[] });
        const tasksQ = hsContactIds.length
          ? sb.from('hubspot_tasks')
              .select('hs_id, hs_task_subject, hs_task_body, hs_task_status, hs_timestamp')
              .overlaps('associated_contact_ids', hsContactIds)
              .order('hs_timestamp', { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [] as any[] });
        const [{ data: hc }, { data: hn }, { data: ht }] = await Promise.all([callsQ, notesQ, tasksQ]) as any;
        // Dedupe calls por proximidad ±120s con histórico local
        const localTs = historico.map((h: any) => +new Date(h.fecha || 0));
        for (const k of hc || []) {
          const t = +new Date(k.hs_timestamp || 0);
          if (localTs.some((lt) => Math.abs(lt - t) < 120_000)) continue;
          historico.push({
            fecha: k.hs_timestamp,
            outcome: k.hs_call_disposition || null,
            direccion: k.hs_call_direction || null,
            duracion_seg: k.hs_call_duration ? Math.round(Number(k.hs_call_duration) / 1000) : null,
            resumen: k.hs_call_body ? String(k.hs_call_body).slice(0, 600) : null,
            resumen_ia: k.hs_call_summary ? String(k.hs_call_summary).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000) : null,
            transcripcion: k.hs_call_transcription ? String(k.hs_call_transcription).slice(0, 4000) : null,
            source: 'hubspot',
          });
        }
        historico.sort((a: any, b: any) => +new Date(b.fecha || 0) - +new Date(a.fecha || 0));
        historico = historico.slice(0, 12);

        historico_notas = (hn || []).map((k: any) => ({
          fecha: k.hs_timestamp,
          texto: (k.hs_note_body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800),
        })).filter((n: any) => n.texto);
        historico_tasks = (ht || []).map((k: any) => ({
          fecha: k.hs_timestamp,
          asunto: k.hs_task_subject || null,
          status: k.hs_task_status || null,
          texto: (k.hs_task_body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
        }));
      }

      // ¿Cuántas llamadas con conversación real (no "no_contesta", con resumen/transcripción)?
      n_previas = historico.filter((h: any) => {
        const oc = (h.outcome || '').toString().toLowerCase();
        if (oc.includes('no_contesta') || oc.includes('no answer')) return false;
        const hasText = ((h.resumen || '').length + (h.transcripcion || '').length) > 30;
        return hasText;
      }).length;
      header = n_previas === 0 ? 'Primer contacto' : `Seguimiento · llamada nº ${n_previas + 1}`;
    }

    // 3) RAG Voss
    const focusText = mode === 'post'
      ? `Evaluación post-llamada proindivisario. Perfil: ${snapshot.propietario?.buyer_persona || 'sin_clasificar'} ${snapshot.relacion_propietario_edificio?.subrole || ''}. Edificio: ${snapshot.edificio?.direccion || ''}.`
      : `Llamada en frío proindivisario. Perfil: ${snapshot.propietario?.buyer_persona || 'sin_clasificar'} cuota ${snapshot.relacion_propietario_edificio?.cuota || '?'}%. Edificio: ${snapshot.edificio?.direccion || ''} mala_gestion=${snapshot.analisis?.mala_gestion_score ?? '?'}. ${historico.length ? 'Retomar histórico previo.' : 'Primer contacto.'}`;
    const vec = await embed(focusText, lk);
    let fragments: any[] = [];
    if (vec) {
      try {
        const { data: hits } = await (sb.rpc as any)('match_knowledge_chunks', {
          query_embedding: vec, match_count: 6, filter_origenes: VOSS_SOURCES,
          filter_scope_type: null, filter_scope_id: null,
        });
        fragments = (hits || []).map((h: any) => ({
          chunk_id: h.id || h.chunk_id, source: h.origen || h.source, snippet: (h.contenido || h.snippet || '').slice(0, 500),
        }));
      } catch (_) { /* fallback below */ }
    }
    if (!fragments.length) {
      const { data: kc } = await sb.from('knowledge_chunks').select('id, origen, contenido').in('origen', VOSS_SOURCES).limit(6);
      fragments = (kc || []).map((k: any) => ({ chunk_id: k.id, source: k.origen, snippet: (k.contenido || '').slice(0, 500) }));
    }

    // 3.bis) Tácticas ganadoras del playbook (sistema que aprende)
    const perfilKey = snapshot.propietario?.buyer_persona || 'sin_clasificar';
    const { data: pbRows } = await sb
      .from('call_playbook')
      .select('tactica_tipo, tactica_texto, ejemplo_literal, n_usos, n_exito, tasa_exito')
      .in('perfil_tipologia', [perfilKey, 'sin_clasificar'])
      .gte('n_usos', 1)
      .order('tasa_exito', { ascending: false })
      .order('n_usos', { ascending: false })
      .limit(8);
    const playbook = pbRows || [];

    // 4) Payload al modelo
    const userMsg = `MODO: ${mode}

CABECERA (úsala literal en historico.resumen / contexto): ${header}
NÚMERO DE LLAMADAS CON CONVERSACIÓN PREVIAS: ${n_previas}

${mode === 'brief' ? `${PARTE_FIJA}

${tipologiaBlock(snapshot?.propietario?.buyer_persona)}

` : ''}
SNAPSHOT REAL (no inventes lo que no esté aquí):
${JSON.stringify(snapshot, null, 2)}

HISTÓRICO DE LLAMADAS (${historico.length} previas):
${historico.length ? JSON.stringify(historico, null, 2) : '(sin histórico — PRIMER CONTACTO en frío)'}

NOTAS HUBSPOT DEL CONTACTO (${historico_notas.length}):
${historico_notas.length ? JSON.stringify(historico_notas, null, 2) : '(sin notas)'}

TAREAS HUBSPOT DEL CONTACTO (${historico_tasks.length}):
${historico_tasks.length ? JSON.stringify(historico_tasks, null, 2) : '(sin tareas)'}

${mode === 'post' ? `METADATOS DE LA LLAMADA:
- CALL_DURATION_SEG: ${call_duration_seg ?? 'desconocida'}
- CALL_SUMMARY_HUBSPOT (referencia — NO es la fuente de verdad): ${call_summary ? String(call_summary).slice(0, 800) : '(no disponible)'}

VERBATIM (fuente de verdad — cita literal de aquí, no del summary):
${call_transcript || '(sin transcripción provista — informe BREVE obligatorio, informe_completo=false)'}
` : ''}
${mode === 'brief' ? `TARGET_KPIS (KPIs OBJETIVO de esta llamada — enfoca el plan en conseguir ESTOS datos concretos; usa el label EXACTO en "enfoque_llamada[].kpi"):
${targetKpis.length ? targetKpis.map((k, i) => `[${i + 1}] ${k}`).join('\n') : '(vacío — plan estándar)'}

KPI_CONTEXT · LO QUE YA SABEMOS DE ESTA PERSONA (úsalo como base para el plan_llamada — cita la evidencia en "por_que"):
${kpiTenemos.length ? kpiTenemos.map((k) => `- [${k.estado}] ${k.label}${k.evidencia ? ` — evidencia: "${k.evidencia}"` : ''}`).join('\n') : '(no consta info previa consolidada — trata como primer contacto informativo)'}

KPI_CONTEXT · LO QUE NOS FALTA (a sacar en esta llamada):
${kpiFalta.length ? kpiFalta.map((k) => `- ${k.label}`).join('\n') : '(sin huecos declarados)'}
` : ''}
PLAYBOOK MEDIDO (tácticas con mejor tasa_exito para este perfil — PRIORÍZALAS y cítalas en por_que_funciona):
${playbook.length ? playbook.map((p: any, i: number) => `[${i+1}] tipo=${p.tactica_tipo} texto="${p.tactica_texto}" tasa=${p.tasa_exito} (n=${p.n_usos}/${p.n_exito})${p.ejemplo_literal ? ` ej: "${p.ejemplo_literal}"` : ''}`).join('\n') : '(playbook vacío — primera iteración, usa criterio Voss/Sandler)'}

FRAGMENTOS VOSS (cita chunk_id real en fragmentos_usados):
${fragments.map((f, i) => `[${i+1}] (${f.source}) chunk_id=${f.chunk_id}\n${f.snippet}`).join('\n\n')}

Devuelve el JSON estricto con la forma EXACTA del system.`;

    const sys = mode === 'post' ? SYSTEM_POST : (SYSTEM_BRIEF + '\n\n' + KPI_FOCUS_RULES);
    let ai: any;
    try {
      ai = await callAI([
        { role: 'system', content: sys },
        { role: 'user', content: userMsg },
      ], lk);
    } catch (aiErr: any) {
      if (aiErr?.ai_gateway) {
        console.error('[agent_voss_coach] returning minimal fallback brief:', aiErr?.message);
        const fallbackVoss: any = {
          como_enfocar: 'No se pudo generar el plan automático (error temporal del modelo). Usa el histórico y los KPIs a abordar.',
          plan_llamada: [],
          enfoque_llamada: [],
          lineas_rojas: [],
          hilo: [],
          header,
        };
        if (mode === 'brief') {
          fallbackVoss.playbook_priorizado = playbook.slice(0, 3).map((p: any) => ({
            tipo: p.tactica_tipo, tactica: p.tactica_texto, tasa_exito: p.tasa_exito, n_usos: p.n_usos,
          }));
          fallbackVoss.n_llamadas_previas = n_previas;
        }
        return new Response(JSON.stringify({
          ok: false,
          mode,
          voss: fallbackVoss,
          error: 'ai_gateway',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      throw aiErr;
    }

    if (!Array.isArray(ai.fragmentos_usados) || ai.fragmentos_usados.length === 0) {
      ai.fragmentos_usados = fragments.slice(0, 2).map((f) => ({ source: f.source, chunk_id: f.chunk_id, tecnica: 'corpus_voss' }));
    }
    if (mode === 'brief') {
      ai.playbook_priorizado = playbook.slice(0, 3).map((p: any) => ({
        tipo: p.tactica_tipo, tactica: p.tactica_texto, tasa_exito: p.tasa_exito, n_usos: p.n_usos,
      }));
      // Inyecta header SIEMPRE (no depende del modelo)
      ai.header = header;
      ai.n_llamadas_previas = n_previas;
    }

    return new Response(JSON.stringify({
      ok: true,
      mode,
      voss: ai,
      meta: {
        historico_count: historico.length,
        historico_notas_count: historico_notas.length,
        historico_tasks_count: historico_tasks.length,
        header,
        n_previas,
        fragments_count: fragments.length,
        playbook_count: playbook.length,
        datos_faltantes: snapshot.datos_faltantes,
        snapshot_keys: Object.keys(snapshot),
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});