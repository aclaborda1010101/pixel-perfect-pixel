// eval-escaleras-v7.5
// Estrategia: parte de v7.2-gemini (prod, precision 100%, recall 30%).
// Añade DOS señales sobre el FXCC (mismo VLM, prompt enfocado a texto):
//   (a) OCR de la leyenda / rotulación: cuenta menciones explícitas
//       "ESCALERA" / "CAJA DE ESCALERA" / numeración E1, E2... en el plano.
//   (b) Portales en planta baja (núcleos de acceso residencial).
// Reglas estrictas (nunca degradan):
//   - base = v7.2-gemini.pred_n (puede ser NR).
//   - si base >= 2  → se RESPETA tal cual (no perder precision).
//   - si base == 1:
//        * señales coinciden en >=2 con conf_a>=0.7 Y conf_b>=0.7  → pred = 2
//        * solo UNA señal indica >=2 con conf>=0.6                  → needs_review
//        * resto                                                    → pred = 1 (sin cambio)
//   - si base == NR (y no es "sin FXCC"):
//        * ambas señales >=2 con conf>=0.8                          → pred = 2
//        * cualquier otra cosa                                       → NR (sin inventar)
//   - errores "sin FXCC"                                            → NR + flag needs_review_humano.
// Lotes con auto-reinvocación. No usa imagescript (evita CPU timeout v7.4).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PROMPT_SIGNALS = `Eres un experto leyendo planos catastrales (FXCC) de Madrid.
Te paso TODAS las páginas del FXCC de un único edificio residencial.

Tu tarea es EXTRAER SOLO DOS SEÑALES, sin contar cajas tú mismo. Lee el TEXTO
impreso (rótulos, leyenda, etiquetas) y los SÍMBOLOS de núcleo vertical.

SEÑAL A — OCR de la leyenda / rotulación:
- Cuenta cuántas etiquetas DISTINTAS del tipo "ESCALERA", "ESC.", "CAJA DE
  ESCALERA", "NÚCLEO", "E1/E2/E3...", "ESC.A/ESC.B/..." aparecen rotuladas
  como núcleos verticales SEPARADOS en cualquier planta. Si la leyenda
  enumera N escaleras, n_etiquetas_escalera = N. Si solo hay un rótulo
  genérico, n_etiquetas_escalera = 1. Si no hay rótulo legible, = null.

SEÑAL B — Portales en planta baja:
- Identifica la planta baja ("PB", "P. BAJA", "BAJA"). Cuenta SOLO portales
  residenciales (acceso de calle a viviendas; ignora locales, garaje,
  trasteros, salidas de emergencia). n_portales_pb = entero. Si PB no es
  legible, = null.

REGLAS DURAS:
- Prohibido inventar. Si dudas → null y baja la confianza.
- "Confianza" debe reflejar evidencia explícita en el plano (texto leído o
  símbolos distinguibles). 0.0 = sin evidencia; 1.0 = inequívoco.

Devuelve EXACTAMENTE este JSON:
{
  "n_etiquetas_escalera": number | null,
  "leyenda_textual": string,
  "confianza_a": number,
  "n_portales_pb": number | null,
  "pb_legible": boolean,
  "confianza_b": number,
  "razon": string
}`;

async function callVlm(apiKey: string, urls: string[]): Promise<any> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [{ role: "user", content: [
        { type: "text", text: PROMPT_SIGNALS },
        ...urls.map(u => ({ type: "image_url", image_url: { url: u } })),
      ]}],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`gw ${r.status}`);
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
}

type BaseRow = { pred_n: number | null; needs_review: boolean; error: string | null };

function decide(base: BaseRow, sig: any): { pred_n: number | null; needs_review: boolean; razon: string } {
  // sin FXCC → NR humano (problema de datos)
  if (base.error && /sin FXCC/i.test(base.error)) {
    return { pred_n: null, needs_review: true, razon: "sin FXCC → needs_review_humano (datos)" };
  }
  const nA = sig?.n_etiquetas_escalera == null ? null : Math.round(Number(sig.n_etiquetas_escalera));
  const nB = sig?.n_portales_pb == null ? null : Math.round(Number(sig.n_portales_pb));
  const cA = Math.max(0, Math.min(1, Number(sig?.confianza_a ?? 0)));
  const cB = Math.max(0, Math.min(1, Number(sig?.confianza_b ?? 0)));
  const aSays2 = nA != null && nA >= 2;
  const bSays2 = nB != null && nB >= 2;

  // base >= 2 → respetar (no degradar)
  if (base.pred_n != null && base.pred_n >= 2) {
    return { pred_n: base.pred_n, needs_review: false, razon: "respeta v7.2-gemini (base>=2)" };
  }
  // base == 1
  if (base.pred_n === 1) {
    if (aSays2 && bSays2 && cA >= 0.7 && cB >= 0.7) {
      return { pred_n: 2, needs_review: false, razon: "upgrade 1→2 (señales A+B>=2, conf>=0.7)" };
    }
    if ((aSays2 && cA >= 0.6) !== (bSays2 && cB >= 0.6) && (aSays2 || bSays2)) {
      return { pred_n: null, needs_review: true, razon: "una sola señal sugiere 2 → NR" };
    }
    return { pred_n: 1, needs_review: false, razon: "respeta v7.2-gemini (base=1)" };
  }
  // base == NR
  if (base.needs_review) {
    if (aSays2 && bSays2 && cA >= 0.8 && cB >= 0.8) {
      return { pred_n: 2, needs_review: false, razon: "NR→2 (señales fuertes A+B)" };
    }
    return { pred_n: null, needs_review: true, razon: "respeta NR v7.2-gemini" };
  }
  // fallback: respeta base
  return { pred_n: base.pred_n, needs_review: false, razon: "fallback respeta base" };
}

async function evalOne(sb: any, apiKey: string, set_name: string, building_id: string, gt: number) {
  const { data: baseRow } = await sb.from("escaleras_eval_results")
    .select("pred_n, needs_review, error, evidencia")
    .eq("set_name", set_name).eq("version", "v7.2-gemini").eq("building_id", building_id).maybeSingle();
  if (!baseRow) {
    return { building_id, set_name, version: "v7.5", gt, error: "sin base v7.2-gemini", needs_review: true };
  }
  const base: BaseRow = { pred_n: baseRow.pred_n, needs_review: !!baseRow.needs_review, error: baseRow.error };

  // Sin FXCC: NR humano, sin gastar VLM.
  if (base.error && /sin FXCC/i.test(base.error)) {
    return {
      building_id, set_name, version: "v7.5", gt,
      pred_n: null, pred_segundas: null, needs_review: true, confidence: 0,
      evidencia: { base, needs_review_humano: true, motivo: "sin FXCC (datos)" },
    };
  }

  const { data: cat } = await sb.from("catastro_data")
    .select("fxcc_pages_urls, plantas_pages_urls").eq("building_id", building_id).maybeSingle();
  const pages: string[] = Array.isArray(cat?.fxcc_pages_urls) && cat!.fxcc_pages_urls.length
    ? cat!.fxcc_pages_urls : (Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : []);
  if (!pages.length) {
    return {
      building_id, set_name, version: "v7.5", gt,
      pred_n: null, pred_segundas: null, needs_review: true, confidence: 0,
      evidencia: { base, needs_review_humano: true, motivo: "sin FXCC (datos)" }, error: "sin FXCC",
    };
  }

  let sig: any = null, lastErr: string | null = null;
  for (let a = 0; a < 2 && !sig; a++) {
    try { sig = await callVlm(apiKey, pages); }
    catch (e) { lastErr = (e as Error).message; await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!sig) {
    // Sin señales → respeta base.
    return {
      building_id, set_name, version: "v7.5", gt,
      pred_n: base.pred_n, pred_segundas: base.pred_n == null ? null : base.pred_n >= 2,
      needs_review: base.needs_review, confidence: 0,
      evidencia: { base, signals_error: lastErr },
    };
  }

  const d = decide(base, sig);
  const conf = Math.min(Number(sig.confianza_a ?? 0), Number(sig.confianza_b ?? 0));
  return {
    building_id, set_name, version: "v7.5", gt,
    pred_n: d.pred_n, pred_segundas: d.pred_n == null ? null : d.pred_n >= 2,
    needs_review: d.needs_review, confidence: Math.max(0, Math.min(1, conf)),
    evidencia: { base, signals: sig, decision: d.razon, modelo: "google/gemini-2.5-pro" },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({}));
  const set_name: string = body.set_name ?? "ctrl_10x10_v1";
  const onlyIds: string[] | null = Array.isArray(body.building_ids) && body.building_ids.length ? body.building_ids : null;
  const batchSize: number = Math.max(1, Math.min(6, Number(body.batch_size ?? 3)));
  const force: boolean = body.force === true;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let q = sb.from("escaleras_control_set").select("building_id, gt").eq("set_name", set_name);
  if (onlyIds) q = q.in("building_id", onlyIds);
  const { data: rows, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  let items = rows ?? [];

  if (!force && items.length) {
    const { data: done } = await sb.from("escaleras_eval_results")
      .select("building_id, pred_n, needs_review, error")
      .eq("set_name", set_name).eq("version", "v7.5")
      .in("building_id", items.map((i: any) => i.building_id));
    const ok = new Set((done ?? [])
      .filter((r: any) => r.pred_n != null || r.needs_review === true)
      .map((r: any) => r.building_id));
    items = items.filter((i: any) => !ok.has(i.building_id));
  }

  const batch = items.slice(0, batchSize);
  const remaining = items.slice(batchSize).map((i: any) => i.building_id);

  const run = async () => {
    for (const it of batch) {
      try {
        const r = await evalOne(sb, apiKey, set_name, it.building_id, it.gt);
        await sb.from("escaleras_eval_results").upsert({
          set_name: r.set_name, version: r.version, building_id: r.building_id, gt: r.gt,
          pred_n: r.pred_n ?? null, pred_segundas: r.pred_segundas ?? null,
          needs_review: r.needs_review ?? false, confidence: r.confidence ?? null,
          evidencia: r.evidencia ?? null, error: r.error ?? null,
        }, { onConflict: "set_name,version,building_id" });
      } catch (e) { console.warn("v7.5 err", it.building_id, (e as Error).message); }
      await new Promise(r => setTimeout(r, 400));
    }
    console.log("eval-escaleras-v7.5 batch done", batch.length, "remaining", remaining.length);
    if (remaining.length) {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eval-escaleras-v7-5`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          },
          body: JSON.stringify({ set_name, building_ids: remaining, batch_size: batchSize, force }),
        });
      } catch (e) { console.warn("v7.5 auto-reinvoke failed", (e as Error).message); }
    }
  };
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, async: true, batch: batch.length, remaining: remaining.length }), {
    status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});