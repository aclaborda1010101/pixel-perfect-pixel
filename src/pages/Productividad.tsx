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
import { useAuth } from "@/hooks/useAuth";
import { useCurrentRole } from "@/hooks/useCurrentRole";

/**
 * Productividad — coaching personal por comercial.
 *
 * Fuentes:
 *  - `hubspot_calls` (hs_owner_id, hs_call_duration ms, hs_call_disposition).
 *  - `hubspot_owners` (hs_owner_id ↔ email/full_name).
 *  - `call_sessions` (puntuación 0-100 + voss_post) — enlazadas por
 *    hubspot_call_id o, en retroactivas, por `comercial_email` denormalizado.
 *
 * Vista: cada usuario ve SÓLO lo suyo. Admin puede cambiar de comercial.
 */

type HsCall = {
  hs_id: string;
  hs_owner_id: string | null;
  hs_timestamp: string | null;
  hs_call_duration: number | null;
  hs_call_disposition: string | null;
};
// Dispositions "conectadas" (llamada contestada)
const CONNECTED_DISPOSITIONS = new Set([
  "f240bbac-87c9-4f6e-bf70-924b57d47db7",
  "55428849-9fbc-4038-92d6-7c4f2b850974",
  "371c7887-c871-4c38-b0e7-77bafc4de124",
  "ea9e4795-50e0-4c7b-8b97-3c0bb743dbf7",
]);
// Umbral de "conectada" por duración cuando no hay disposition.
const CONNECTED_MS = 30_000;
type Session = {
  id: string;
  hubspot_call_id: string | null;
  puntuacion: number | null;
  voss_post: any;
  cerrada_at: string | null;
  iniciada_at: string | null;
  owner_id: string | null;
  building_id: string | null;
  comercial_email?: string | null;
  retroactiva?: boolean | null;
};
type OwnerRow = { hs_owner_id: string; email: string | null; full_name: string | null };

const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
type RangeKey = keyof typeof RANGES;

function fmtPct(n: number) { return `${Math.round(n)}%`; }
function fmtDur(ms: number) {
  const s = Math.round((ms || 0) / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
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
  const { user } = useAuth();
  const { isAdmin } = useCurrentRole();
  const [range, setRange] = useState<RangeKey>("30d");
  const [owners, setOwners] = useState<OwnerRow[]>([]);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [hsCalls, setHsCalls] = useState<HsCall[]>([]);
  const [prevHsCalls, setPrevHsCalls] = useState<HsCall[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [prevSessions, setPrevSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  // Owners (comerciales conocidos)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("hubspot_owners")
        .select("hs_owner_id,email,full_name")
        .eq("archived", false)
        .order("full_name");
      setOwners((data ?? []) as OwnerRow[]);
    })();
  }, []);

  // Comercial a mostrar: por defecto el logueado; admin puede cambiar
  const currentOwner = useMemo<OwnerRow | null>(() => {
    if (!owners.length) return null;
    if (isAdmin && selectedOwnerId) {
      return owners.find((o) => o.hs_owner_id === selectedOwnerId) ?? null;
    }
    const email = user?.email?.toLowerCase();
    if (!email) return isAdmin ? owners[0] : null;
    const match = owners.find((o) => (o.email ?? "").toLowerCase() === email);
    // Admin sin match cae al primero; no-admin sin match no ve nada.
    return match ?? (isAdmin ? owners[0] : null);
  }, [owners, selectedOwnerId, isAdmin, user?.email]);

  useEffect(() => {
    if (!currentOwner) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const days = RANGES[range];
      const since = daysAgo(days);
      const prevSince = daysAgo(days * 2);
      const email = (currentOwner.email ?? "").toLowerCase();
      const [c1, c0, s1, s0] = await Promise.all([
        supabase.from("hubspot_calls" as any)
          .select("hs_id,hs_owner_id,hs_timestamp,hs_call_duration,hs_call_disposition")
          .eq("hs_owner_id", currentOwner.hs_owner_id)
          .gte("hs_timestamp", since)
          .order("hs_timestamp", { ascending: false })
          .limit(5000),
        supabase.from("hubspot_calls" as any)
          .select("hs_id,hs_owner_id,hs_timestamp,hs_call_duration,hs_call_disposition")
          .eq("hs_owner_id", currentOwner.hs_owner_id)
          .gte("hs_timestamp", prevSince).lt("hs_timestamp", since)
          .limit(5000),
        (supabase.from("call_sessions") as any)
          .select("id,hubspot_call_id,puntuacion,voss_post,cerrada_at,iniciada_at,owner_id,building_id,comercial_email,retroactiva")
          .eq("comercial_email", email)
          .gte("iniciada_at", since).not("puntuacion", "is", null).limit(2000),
        (supabase.from("call_sessions") as any)
          .select("id,hubspot_call_id,puntuacion,voss_post,cerrada_at,iniciada_at,owner_id,building_id,comercial_email,retroactiva")
          .eq("comercial_email", email)
          .gte("iniciada_at", prevSince).lt("iniciada_at", since).not("puntuacion", "is", null).limit(2000),
      ]);
      if (cancelled) return;
      setHsCalls(((c1 as any).data ?? []) as HsCall[]);
      setPrevHsCalls(((c0 as any).data ?? []) as HsCall[]);
      setSessions(((s1 as any).data ?? []) as Session[]);
      setPrevSessions(((s0 as any).data ?? []) as Session[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [range, currentOwner?.hs_owner_id]);

  function statsFor(cs: HsCall[], ss: Session[]) {
    const isConnected = (c: HsCall) =>
      (c.hs_call_disposition && CONNECTED_DISPOSITIONS.has(c.hs_call_disposition)) ||
      (c.hs_call_duration ?? 0) >= CONNECTED_MS;
    const conectadas = cs.filter(isConnected);
    const totalDur = conectadas.reduce((a, c) => a + (c.hs_call_duration ?? 0), 0);
    const notas = ss.map((s) => Number(s.puntuacion)).filter((n) => Number.isFinite(n));
    const notaMedia = notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : 0;
    const hsSet = new Set(ss.map((s) => s.hubspot_call_id).filter(Boolean) as string[]);
    const pendientes = conectadas.filter((c) => !hsSet.has(c.hs_id)).length;
    return {
      intentos: cs.length,
      conectadas: conectadas.length,
      pctConexion: cs.length ? (conectadas.length / cs.length) * 100 : 0,
      duracionMediaMs: conectadas.length ? totalDur / conectadas.length : 0,
      analizadas: ss.length,
      notaMedia,
      pendientesAnalisis: pendientes,
      sessions: ss.slice().sort((a, b) => (b.iniciada_at ?? "").localeCompare(a.iniciada_at ?? "")),
    };
  }

  const me = useMemo(() => statsFor(hsCalls, sessions), [hsCalls, sessions]);
  const mePrev = useMemo(() => statsFor(prevHsCalls, prevSessions), [prevHsCalls, prevSessions]);
  const mejoras = useMemo(() => extractPatterns(me.sessions, "momentos_flojos"), [me.sessions]);
  const fortalezas = useMemo(() => extractPatterns(me.sessions, "que_hizo_bien"), [me.sessions]);
  const deltaNota = me.notaMedia - mePrev.notaMedia;
  const deltaConexion = me.pctConexion - mePrev.pctConexion;
  const rangeLabel = range === "7d" ? "últimos 7 días" : range === "30d" ? "últimos 30 días" : "últimos 90 días";

  const ownerLabel = currentOwner?.full_name ?? currentOwner?.email ?? "—";
  if (!currentOwner && !loading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader eyebrow="Productividad" title="Coaching comercial" />
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Tu usuario no está vinculado a un comercial de HubSpot. Pide a un administrador que lo mapee.
        </CardContent></Card>
      </div>
    );
  }
  return (
    <div className="space-y-6 p-6">
      <PageHeader
        eyebrow="Productividad"
        title={`Coaching · ${ownerLabel}`}
        subtitle={`Actividad y análisis de llamadas · ${rangeLabel}`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Rango</span>
        <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
          <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Últimos 7 días</SelectItem>
            <SelectItem value="30d">Últimos 30 días</SelectItem>
            <SelectItem value="90d">Últimos 90 días</SelectItem>
          </SelectContent>
        </Select>
        {isAdmin && owners.length > 0 && (
          <>
            <span className="ml-4 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Comercial</span>
            <Select value={currentOwner?.hs_owner_id ?? ""} onValueChange={(v) => setSelectedOwnerId(v)}>
              <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {owners.map((o) => (
                  <SelectItem key={o.hs_owner_id} value={o.hs_owner_id}>{o.full_name ?? o.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            Foto del período <Badge variant="outline" className="text-[10px]">{me.intentos} llamadas</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Kpi label="Intentos" value={String(me.intentos)} />
          <Kpi label="Conectadas" value={String(me.conectadas)} hint={fmtPct(me.pctConexion) + " conexión"} delta={deltaConexion} />
          <Kpi label="Duración media" value={me.duracionMediaMs ? fmtDur(me.duracionMediaMs) : "—"} hint="por llamada conectada" />
          <Kpi label="Nota media" value={me.notaMedia ? me.notaMedia.toFixed(0) : "—"} hint={`${me.analizadas} analizadas`} delta={deltaNota} />
          <Kpi label="Pendientes" value={String(me.pendientesAnalisis)} hint="Conectadas sin analizar" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-400" /> Qué mejorar (patrones repetidos)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {mejoras.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {me.analizadas === 0
                  ? "Aún no hay llamadas auditadas en este rango. La auditoría retroactiva las irá completando."
                  : "No se detectan patrones repetidos todavía."}
              </p>
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
              <p className="text-xs text-muted-foreground">
                {me.analizadas === 0
                  ? "Aún no hay auditorías con fortalezas identificadas."
                  : "Sin patrones de fortaleza detectados aún."}
              </p>
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Últimas llamadas analizadas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {me.sessions.slice(0, 20).map((sess) => (
              <Link
                key={sess.id}
                to={`/comercial/llamada/${sess.hubspot_call_id ?? sess.id}`}
                className="flex items-center justify-between rounded-md border border-border-faint px-3 py-2 text-xs hover:bg-surface-1/60"
              >
                <span className="text-muted-foreground">
                  {sess.iniciada_at ? new Date(sess.iniciada_at).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                </span>
                <div className="flex items-center gap-2">
                  {sess.retroactiva && <Badge variant="outline" className="text-[10px]">Retro</Badge>}
                  <Badge variant="outline" className="tabular-nums">Nota {Math.round(Number(sess.puntuacion))}</Badge>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                </div>
              </Link>
            ))}
            {me.sessions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {loading ? "Cargando…" : "Aún no hay llamadas auditadas en este rango."}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
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
