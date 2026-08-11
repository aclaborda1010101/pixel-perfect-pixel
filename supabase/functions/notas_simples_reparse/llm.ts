// Proveedores LLM del reparseo (P0.7).
//
// PRIMARY: Lovable AI Gateway + Gemini estable. VERIFICADO empíricamente contra
// el gateway con una nota simple real (12 páginas, 1,04 MB): el bloque
// {type:"file", file:{filename, file_data:"data:application/pdf;base64,..."}}
// se acepta y el modelo responde sobre el documento. Por eso NO se manda nunca
// un PDF dentro de image_url ni hace falta rasterizar páginas.
//
// Se eliminó openai/gpt-5.6-luna (modelo inválido en el gateway). El fallback
// es otro modelo documental realmente soportado del mismo gateway.

export const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const PRIMARY_MODEL = "google/gemini-3.6-flash";
export const FALLBACK_MODEL = "google/gemini-2.5-flash";

export type LlmProvider = { name: string; url: string; model: string; auth: string };

export type LlmResult<T> = { data: T | null; error?: string; model?: string };

/** 429 y 5xx son transitorios; cualquier 4xx de input NO se reintenta. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export function buildProviders(lovableKey: string | null | undefined): LlmProvider[] {
  const k = (lovableKey ?? "").trim();
  if (!k) return [];
  return [
    { name: "lovable", url: GATEWAY_URL, model: PRIMARY_MODEL, auth: `Bearer ${k}` },
    { name: "lovable", url: GATEWAY_URL, model: FALLBACK_MODEL, auth: `Bearer ${k}` },
  ];
}

export function schemaHint(needTitulares: boolean): string {
  return needTitulares
    ? `{ "direccion": "...", "ref_catastral": "...", "finca_numero": "...", "registro": "...", "titulares": [{ "nombre": "...", "cif_dni": "...", "porcentaje": 0-100, "rol": "pleno|usufructo|nuda_propiedad", "rol_literal": "texto literal del derecho", "evidencia": { "cita": "frase literal del documento donde constan nombre, derecho y porcentaje", "pagina": 1, "ruta": "sección" } }] }`
    : `{ "direccion": "...", "ref_catastral": "...", "finca_numero": "...", "registro": "..." }`;
}

/** Reglas de EVIDENCIA OBLIGATORIA por titular (idénticas en texto y documento). */
export const REGLAS_EVIDENCIA = [
  'Cada titular EXIGE los cuatro datos probados en la MISMA cita literal: nombre, tipo de derecho, porcentaje y la frase textual del documento, más la página.',
  'Si no puedes probar los cuatro en una cita real, NO devuelvas ese titular (mejor ninguno que uno inventado).',
  'Nunca uses "pleno" por defecto: el derecho sale del literal del documento.',
  '"gananciales" es un RÉGIMEN económico, no un derecho: indica el derecho real (pleno dominio, usufructo o nuda propiedad) y deja el régimen en rol_literal.',
  'Un mismo titular con pleno dominio, nuda propiedad o usufructo se devuelve en FILAS SEPARADAS, una por derecho.',
  'Los porcentajes van en 0-100. La dirección es la de la FINCA, nunca la del titular.',
].join("\n- ");

export function buildDocumentMessages(args: {
  base64: string;
  filename: string;
  needTitulares: boolean;
  pageCount?: number | null;
}) {
  const paginas = args.pageCount ? ` El documento tiene ${args.pageCount} páginas: revísalas todas e indica la página real en "evidencia.pagina".` : "";
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Extrae de esta NOTA SIMPLE del Registro de la Propiedad español los datos y devuelve SOLO JSON:\n${schemaHint(args.needTitulares)}\n\nReglas:\n- ${REGLAS_EVIDENCIA}${paginas}`,
        },
        {
          type: "file",
          file: { filename: args.filename, file_data: `data:application/pdf;base64,${args.base64}` },
        },
      ],
    },
  ];
}

export type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<any> }>;

/**
 * Llamada con reintento SELECTIVO: 429/5xx se reintentan con backoff; un 400 de
 * input pasa al siguiente modelo sin reintentar el mismo cuerpo a ciegas.
 */
export async function callChat(args: {
  providers: LlmProvider[];
  messages: unknown[];
  fetchImpl: FetchLike;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  parse?: (txt: string) => unknown;
}): Promise<LlmResult<any>> {
  if (!args.providers.length) return { data: null, error: "sin_proveedor_ia_configurado" };
  const maxRetries = args.maxRetries ?? 2;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const errores: string[] = [];

  for (const p of args.providers) {
    for (let intento = 0; intento <= maxRetries; intento++) {
      try {
        const r = await args.fetchImpl(p.url, {
          method: "POST",
          headers: { Authorization: p.auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: p.model,
            messages: args.messages,
            response_format: { type: "json_object" },
            temperature: 0,
            max_tokens: 4000,
          }),
        });
        if (!r.ok) {
          const detalle = (await r.text()).slice(0, 300);
          errores.push(`${p.name}/${p.model} HTTP ${r.status}: ${detalle}`);
          if (isRetryableStatus(r.status) && intento < maxRetries) {
            await sleep(500 * Math.pow(2, intento));
            continue;
          }
          break; // 4xx de input: siguiente modelo, sin reintento ciego.
        }
        const j = await r.json();
        let txt = j?.choices?.[0]?.message?.content ?? "{}";
        txt = String(txt).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
        const parsed = args.parse ? args.parse(txt) : JSON.parse(txt);
        return { data: parsed, model: `${p.name}/${p.model}` };
      } catch (e) {
        errores.push(`${p.name}/${p.model} excepción: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
        if (intento < maxRetries) {
          await sleep(500 * Math.pow(2, intento));
          continue;
        }
        break;
      }
    }
  }
  return { data: null, error: errores.join(" | ").slice(0, 500) };
}
