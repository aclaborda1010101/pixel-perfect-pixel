import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { ArrowRight, TrendingUp, TrendingDown, Minus, Sparkles, AlertTriangle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Productividad — rediseñada para coaching real de Jesús y David.
 *
 * Fuentes:
 *  - `calls` (2.7k+): comercial_email/nombre, fecha, duracion_seg, hs_call_summary.
 *  - `call_sessions`: puntuacion (0-100) y `voss_post` con `momentos_flojos` y
 *    `que_hizo_bien` — sólo llamadas ya analizadas.
 */

type Call = {
  id: string;
  metadatos: any;
  fecha: string;
  duracion_seg: number | null;
  outcome: string | null;
  comercial_email: string | null;
  comercial_nombre: string | null;
  owner_id: string | null;
};
type Session = {
  id: string;
  hubspot_call_id: string | null;
  puntuacion: number | null;
  voss_post: any;
  cerrada_at: string | null;
  iniciada_at: string | null;
  owner_id: string | null;
  building_id: string | null;
};

const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
type RangeKey = keyof typeof RANGES;

function fmtPct(n: number) { return `${Math.round(n)}%`; }
function comercialKey(email?: string | null) {
  if (!email) return "otros";
  const e = email.toLowerCase();
  if (e.includes("jesus") || e.includes("jesús") || e.startsWith("jesus")) return "jesus";
  if (e.includes("david") || e.includes("casero")) return "david";
  return "otros";
}
function labelForKey(k: string) {
  return k === "jesus" ? "Jesús" : k === "david" ? "David" : "Otros";
}
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString();
}

// Agrupa strings similares por primeras 4-5 palabras (rudimentario pero útil)
function normalizePattern(s: string): string {
  return s.toLowerCase().replace(/[^a-záéíóúñ\s]/gi, "").split(/\s+/).slice(0, 6).join(" ");
}

function extractPatterns(sessions: Session[], field: "momentos_flojos" | "que_hizo_bien") {
  const buckets = new Map<string, { count: number; example: { text: string; hsId: string | null } }>();
  for (const s of sessions) {
    const arr = (s.voss_post?.[field] ?? []) as any[];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const text: string = (
        field === "momentos_flojos"
          ? item?.que_paso ?? item?.mejora_voss ?? item?.tecnica
          : item?.comentario ?? item?.tecnica_voss
      ) as string;
      if (!text || typeof text !== "string") continue;
      const key = normalizePattern(text);
      if (key.length < 8) continue;
      const b = buckets.get(key) ?? { count: 0, example: { text: text.slice(0, 240), hsId: s.hubspot_call_id } };
      b.count += 1;
      buckets.set(key, b);
    }
  }
  return Array.from(buckets.entries())
    .map(([k, v]) => ({ pattern: k, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function Kpi({ label, value, delta, hint }: { label: string; value: string; delta?: number; hint?: string }) {
  return (
    <div className="rounded-md border border-border-faint bg-surface-1/40 p-3">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-xl tabular-nums text-foreground">{value}</span>
        {delta != null && (
          <span className={cn(
            "flex items-center gap-0.5 font-mono text-[11px]",
            delta > 1 ? "text-emerald-400" : delta < -1 ? "text-destructive" : "text-muted-foreground",
          )}>
            {delta > 1 ? <TrendingUp className="h-3 w-3" /> : delta < -1 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {Math.abs(Math.round(delta))}
          </span>
        )}
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default function Productividad() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [calls, setCalls] = useState<Call[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [prevCalls, setPrevCalls] = useState<Call[]>([]);
  const [prevSessions, setPrevSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const days = RANGES[range];
      const since = daysAgo(days);
      const prevSince = daysAgo(days * 2);
      const [c1, s1, c0, s0] = await Promise.all([
        supabase.from("calls").select("id,metadatos,fecha,duracion_seg,outcome,comercial_email,comercial_nombre,owner_id")
          .gte("fecha", since).order("fecha", { ascending: false }).limit(5000),
        supabase.from("call_sessions").select("id,hubspot_call_id,puntuacion,voss_post,cerrada_at,iniciada_at,owner_id,building_id")
          .gte("iniciada_at", since).not("puntuacion", "is", null).limit(2000),
        supabase.from("calls").select("id,metadatos,fecha,duracion_seg,outcome,comercial_email,comercial_nombre,owner_id")
          .gte("fecha", prevSince).lt("fecha", since).limit(5000),
        supabase.from("call_sessions").select("id,hubspot_call_id,puntuacion,voss_post,cerrada_at,iniciada_at,owner_id,building_id")
          .gte("iniciada_at", prevSince).lt("iniciada_at", since).not("puntuacion", "is", null).limit(2000),
      ]);
      if (cancelled) return;
      setCalls((c1.data ?? []) as unknown as Call[]);
      setSessions((s1.data ?? []) as Session[]);
      setPrevCalls((c0.data ?? []) as unknown as Call[]);
      setPrevSessions((s0.data ?? []) as Session[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [range]);

  // Empareja sessions con calls por hubspot_call_id (guardado en metadatos)
  const sessionComercial = useMemo(() => {
    const byHs = new Map<string, string>();
    const hsId = (c: Call) => (c.metadatos?.hubspot_call_id ?? c.metadatos?.hs_id ?? null) as string | null;
    for (const c of calls) { const h = hsId(c); if (h) byHs.set(h, comercialKey(c.comercial_email)); }
    for (const c of prevCalls) { const h = hsId(c); if (h && !byHs.has(h)) byHs.set(h, comercialKey(c.comercial_email)); }
    return byHs;
  }, [calls, prevCalls]);

  // Stats por comercial
  function statsFor(key: string, cs: Call[], ss: Session[]) {
    const mine = cs.filter((c) => comercialKey(c.comercial_email) === key);
    const conectadas = mine.filter((c) => (c.duracion_seg ?? 0) >= 30);
    const mySess = ss.filter((s) => s.hubspot_call_id && sessionComercial.get(s.hubspot_call_id) === key);
    const notas = mySess.map((s) => Number(s.puntuacion)).filter((n) => Number.isFinite(n));
    const notaMedia = notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : 0;
    return {
      intentos: mine.length,
      conectadas: conectadas.length,
      pctConexion: mine.length ? (conectadas.length / mine.length) * 100 : 0,
      analizadas: mySess.length,
      notaMedia,
      pendientesAnalisis: conectadas.filter((c) => !ss.some((s) => s.hubspot_call_id === c.hubspot_call_id)).length,
      sessions: mySess,
    };
  }

  const jesus = useMemo(() => statsFor("jesus", calls, sessions), [calls, sessions, sessionComercial]);
  const david = useMemo(() => statsFor("david", calls, sessions), [calls, sessions, sessionComercial]);
  const jesusPrev = useMemo(() => statsFor("jesus", prevCalls, prevSessions), [prevCalls, prevSessions, sessionComercial]);
  const davidPrev = useMemo(() => statsFor("david", prevCalls, prevSessions), [prevCalls, prevSessions, sessionComercial]);

  const totales = useMemo(() => ({
    llamadas: calls.length,
    conectadas: calls.filter((c) => (c.duracion_seg ?? 0) >= 30).length,
    analizadas: sessions.length,
  }), [calls, sessions]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        eyebrow="Productividad"
        title="Coaching comercial"
        subtitle="Cómo van Jesús y David esta semana · qué mejorar · qué hacen bien"
      />

      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Rango</span>
        <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
          <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Últimos 7 días</SelectItem>
            <SelectItem value="30d">Últimos 30 días</SelectItem>
            <SelectItem value="90d">Últimos 90 días</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-xs text-muted-foreground">
          {totales.llamadas.toLocaleString()} llamadas · {totales.conectadas.toLocaleString()} conectadas · {totales.analizadas.toLocaleString()} analizadas
        </div>
      </div>

      {/* Foto semanal — una tarjeta por comercial */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(["jesus", "david"] as const).map((k) => {
          const s = k === "jesus" ? jesus : david;
          const prev = k === "jesus" ? jesusPrev : davidPrev;
          const deltaNota = s.notaMedia - prev.notaMedia;
          const deltaConexion = s.pctConexion - prev.pctConexion;
          return (
            <Card key={k}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  {labelForKey(k)}
                  <Badge variant="outline" className="text-[10px]">{s.intentos} llamadas</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Kpi label="Intentos" value={String(s.intentos)} />
                <Kpi label="Conectadas" value={String(s.conectadas)} hint={fmtPct(s.pctConexion) + " conexión"} delta={deltaConexion} />
                <Kpi label="Nota media" value={s.notaMedia ? s.notaMedia.toFixed(0) : "—"} hint={`${s.analizadas} analizadas`} delta={deltaNota} />
                <Kpi label="Pendientes" value={String(s.pendientesAnalisis)} hint="Conectadas sin analizar" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="jesus" className="space-y-4">
        <TabsList>
          <TabsTrigger value="jesus">Jesús · detalle</TabsTrigger>
          <TabsTrigger value="david">David · detalle</TabsTrigger>
          <TabsTrigger value="comparativa">Comparativa</TabsTrigger>
        </TabsList>

        {(["jesus", "david"] as const).map((k) => {
          const s = k === "jesus" ? jesus : david;
          const mejoras = extractPatterns(s.sessions, "momentos_flojos");
          const fortalezas = extractPatterns(s.sessions, "que_hizo_bien");
          return (
            <TabsContent key={k} value={k} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <AlertTriangle className="h-4 w-4 text-amber-400" /> Qué mejorar (patrones repetidos)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {mejoras.length === 0 && (
                      <p className="text-xs text-muted-foreground">Sin llamadas analizadas suficientes en este rango.</p>
                    )}
                    {mejoras.map((m, i) => (
                      <div key={i} className="rounded-md border border-border-faint p-2.5">
                        <div className="flex items-center justify-between">
                          <Eyebrow>#{i + 1} · {m.count} veces</Eyebrow>
                          {m.example.hsId && (
                            <Link to={`/comercial/llamada/${m.example.hsId}`} className="text-[10px] text-primary hover:underline flex items-center gap-1">
                              Ver ejemplo <ExternalLink className="h-2.5 w-2.5" />
                            </Link>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-foreground leading-relaxed">{m.example.text}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Sparkles className="h-4 w-4 text-emerald-400" /> Qué hace bien
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {fortalezas.length === 0 && (
                      <p className="text-xs text-muted-foreground">Sin fortalezas detectadas aún.</p>
                    )}
                    {fortalezas.map((f, i) => (
                      <div key={i} className="rounded-md border border-border-faint p-2.5">
                        <div className="flex items-center justify-between">
                          <Eyebrow>#{i + 1} · {f.count} veces</Eyebrow>
                          {f.example.hsId && (
                            <Link to={`/comercial/llamada/${f.example.hsId}`} className="text-[10px] text-primary hover:underline flex items-center gap-1">
                              Ver ejemplo <ExternalLink className="h-2.5 w-2.5" />
                            </Link>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-foreground leading-relaxed">{f.example.text}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              {/* Últimas llamadas analizadas */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Últimas llamadas analizadas</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {s.sessions.slice(0, 12).map((sess) => (
                      <Link
                        key={sess.id}
                        to={`/comercial/llamada/${sess.hubspot_call_id ?? sess.id}`}
                        className="flex items-center justify-between rounded-md border border-border-faint px-3 py-2 text-xs hover:bg-surface-1/60"
                      >
                        <span className="text-muted-foreground">{sess.iniciada_at ? new Date(sess.iniciada_at).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="tabular-nums">Nota {Math.round(Number(sess.puntuacion))}</Badge>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        </div>
                      </Link>
                    ))}
                    {s.sessions.length === 0 && (
                      <p className="text-xs text-muted-foreground">Sin llamadas analizadas.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}

        <TabsContent value="comparativa" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Comparativa Jesús vs David</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-faint text-muted-foreground">
                    <th className="py-2 text-left font-normal">Métrica</th>
                    <th className="py-2 text-right font-normal">Jesús</th>
                    <th className="py-2 text-right font-normal">David</th>
                    <th className="py-2 text-right font-normal">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Llamadas totales", j: jesus.intentos, d: david.intentos, fmt: (n: number) => String(n) },
                    { label: "% Conexión", j: jesus.pctConexion, d: david.pctConexion, fmt: fmtPct },
                    { label: "Analizadas", j: jesus.analizadas, d: david.analizadas, fmt: (n: number) => String(n) },
                    { label: "Nota media", j: jesus.notaMedia, d: david.notaMedia, fmt: (n: number) => n.toFixed(0) },
                    { label: "Pendientes de análisis", j: jesus.pendientesAnalisis, d: david.pendientesAnalisis, fmt: (n: number) => String(n) },
                  ].map((row) => (
                    <tr key={row.label} className="border-b border-border-faint/50">
                      <td className="py-2 text-foreground">{row.label}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{row.fmt(row.j)}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{row.fmt(row.d)}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">{row.fmt(row.j - row.d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Comparativa de coaching, no de ranking. Foco en identificar en qué se puede ayudar a cada uno.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {loading && <p className="text-xs text-muted-foreground">Cargando…</p>}
    </div>
  );
}
