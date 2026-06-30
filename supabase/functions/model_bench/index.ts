// Banco de pruebas interno: compara modelos vía OpenRouter (latencia + tokens + transcript).
// Temporal, para decidir el modelo del bot. Llamar con la anon key (verify_jwt por defecto).
// POST { list:true }  -> lista modelos sonnet/gemini disponibles + si la API key está presente.
// POST { models:[...], system:"...", turns:["...","..."] } -> ejecuta la conversación por modelo.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getKey(): { key: string | undefined; names: string[] } {
  const candidates = ["OPENROUTER_API_KEY", "OPENROUTER_KEY", "OPEN_ROUTER_API_KEY", "OPENROUTER"];
  const present = candidates.filter((n) => !!Deno.env.get(n));
  const key = present.length ? Deno.env.get(present[0]) : undefined;
  return { key, names: present };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const { key, names } = getKey();
  const J = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o, null, 2), { status, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({} as any));

    if (!key) return J({ error: "Sin API key de OpenRouter en el entorno", env_names_present: names }, 400);

    if (body.list) {
      const r = await fetch("https://openrouter.ai/api/v1/models", { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) return J({ error: `models ${r.status}: ${(await r.text()).slice(0, 300)}` }, 502);
      const j = await r.json();
      const ids = (j?.data ?? []).map((m: any) => m.id).filter((id: string) => /sonnet|gemini/i.test(id));
      return J({ env_key_present: true, env_names_present: names, models: ids.sort() });
    }

    const models: string[] = Array.isArray(body.models) ? body.models : [];
    const system: string = String(body.system ?? "");
    const turns: string[] = Array.isArray(body.turns) ? body.turns : [];
    if (!models.length || !turns.length) return J({ error: "Faltan models[] o turns[]" }, 400);

    const results: any[] = [];
    for (const model of models) {
      const messages: any[] = system ? [{ role: "system", content: system }] : [];
      const transcript: any[] = [];
      let ok = true, err = "", pTok = 0, cTok = 0;
      const tStart = Date.now();
      const perTurnMs: number[] = [];
      for (const turn of turns) {
        messages.push({ role: "user", content: turn });
        const t0 = Date.now();
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 400 }),
        });
        const ms = Date.now() - t0;
        perTurnMs.push(ms);
        if (!r.ok) { ok = false; err = `${r.status}: ${(await r.text()).slice(0, 250)}`; break; }
        const j = await r.json();
        const reply = String(j?.choices?.[0]?.message?.content ?? "");
        pTok += Number(j?.usage?.prompt_tokens ?? 0);
        cTok += Number(j?.usage?.completion_tokens ?? 0);
        messages.push({ role: "assistant", content: reply });
        transcript.push({ u: turn, b: reply, ms });
      }
      const done = perTurnMs.length;
      results.push({
        model, ok, err,
        turns_done: done,
        total_ms: Date.now() - tStart,
        avg_ms_per_turn: done ? Math.round(perTurnMs.reduce((a, b) => a + b, 0) / done) : 0,
        p50_ms: done ? [...perTurnMs].sort((a, b) => a - b)[Math.floor(done / 2)] : 0,
        max_ms: done ? Math.max(...perTurnMs) : 0,
        prompt_tokens: pTok, completion_tokens: cTok,
        transcript,
      });
    }
    return J({ env_key_present: true, results });
  } catch (e: any) {
    return J({ error: e?.message ?? String(e) }, 500);
  }
});
