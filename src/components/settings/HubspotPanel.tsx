import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import { supabase } from "@/integrations/supabase/client";
import { Activity, RefreshCw, Building2, Users, AlertCircle, CheckCircle2 } from "lucide-react";

type PingResult = {
  ok: boolean;
  latency_ms?: number;
  portal_id?: number | null;
  time_zone?: string | null;
  currency?: string | null;
  error?: string;
};

type SyncState = {
  entity: string;
  cursor: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  total_synced: number;
  last_error: string | null;
  last_full_sync_at: string | null;
};

type SyncLog = {
  id: string;
  entity: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  pages_fetched: number;
  records_upserted: number;
  records_failed: number;
  error_message: string | null;
};

type Health = {
  ok: boolean;
  states?: SyncState[];
  recent_logs?: SyncLog[];
  counts?: {
    buildings_total: number;
    buildings_from_hubspot: number;
    owners_total: number;
    owners_from_hubspot: number;
  };
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function StatusDot({ status }: { status: string | null | undefined }) {
  const cls =
    status === "ok" ? "bg-success" :
    status === "running" ? "bg-info animate-pulse" :
    status === "error" ? "bg-destructive" :
    "bg-muted-foreground/40";
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
}

export function HubspotPanel() {
  const [ping, setPing] = useState<PingResult | null>(null);
  const [pinging, setPinging] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  async function loadHealth() {
    const { data } = await supabase.functions.invoke("hubspot_sync_health");
    setHealth(data as Health);
  }

  async function doPing() {
    setPinging(true);
    try {
      const { data } = await supabase.functions.invoke("hubspot_ping");
      setPing(data as PingResult);
    } finally {
      setPinging(false);
    }
  }

  async function syncAll() {
    setRunning("all");
    try {
      await supabase.functions.invoke("hubspot_sync_deals", { body: {} });
      await supabase.functions.invoke("hubspot_sync_contacts", { body: {} });
      await loadHealth();
    } finally {
      setRunning(null);
    }
  }

  useEffect(() => { loadHealth(); }, []);

  const dealsState = health?.states?.find((s) => s.entity === "deals");
  const contactsState = health?.states?.find((s) => s.entity === "contacts");

  return (
    <Card className="md:col-span-2">
      <CardHeader className="space-y-2">
        <Eyebrow><Activity className="mr-1 inline h-3 w-3" /> Conexión HubSpot</Eyebrow>
        <CardTitle>Sincronización con HubSpot</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Ping */}
        <div className="rounded-md border border-border-faint p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              {ping?.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> :
                ping ? <AlertCircle className="h-4 w-4 text-destructive" /> :
                <Activity className="h-4 w-4 text-muted-foreground" />}
              <div className="text-sm font-medium text-foreground">Estado del portal</div>
            </div>
            <Button size="sm" variant="outline" onClick={doPing} disabled={pinging}>
              <RefreshCw className={`mr-1 h-3 w-3 ${pinging ? "animate-spin" : ""}`} />
              {pinging ? "Comprobando…" : "Hacer ping"}
            </Button>
          </div>
          {ping ? (
            ping.ok ? (
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div><Eyebrow>Portal ID</Eyebrow><div className="font-mono text-foreground">{ping.portal_id ?? "—"}</div></div>
                <div><Eyebrow>Latencia</Eyebrow><div className="font-mono text-foreground">{ping.latency_ms} ms</div></div>
                <div><Eyebrow>Zona horaria</Eyebrow><div className="font-mono text-foreground">{ping.time_zone ?? "—"}</div></div>
                <div><Eyebrow>Moneda</Eyebrow><div className="font-mono text-foreground">{ping.currency ?? "—"}</div></div>
              </div>
            ) : (
              <div className="text-sm text-destructive">{ping.error}</div>
            )
          ) : (
            <div className="text-sm text-muted-foreground">Pulsa “Hacer ping” para validar credenciales.</div>
          )}
        </div>

        {/* Counts */}
        {health?.counts && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-md border border-border-faint p-3">
              <Eyebrow><Building2 className="mr-1 inline h-3 w-3" /> Edificios totales</Eyebrow>
              <div className="font-mono text-2xl text-foreground">{health.counts.buildings_total}</div>
            </div>
            <div className="rounded-md border border-border-faint p-3">
              <Eyebrow>Edificios desde HubSpot</Eyebrow>
              <div className="font-mono text-2xl text-foreground">{health.counts.buildings_from_hubspot}</div>
            </div>
            <div className="rounded-md border border-border-faint p-3">
              <Eyebrow><Users className="mr-1 inline h-3 w-3" /> Propietarios totales</Eyebrow>
              <div className="font-mono text-2xl text-foreground">{health.counts.owners_total}</div>
            </div>
            <div className="rounded-md border border-border-faint p-3">
              <Eyebrow>Propietarios desde HubSpot</Eyebrow>
              <div className="font-mono text-2xl text-foreground">{health.counts.owners_from_hubspot}</div>
            </div>
          </div>
        )}

        {/* Sync único */}
        <div className="flex flex-col items-start gap-2 rounded-md border border-border-faint p-4">
          <div className="text-sm font-medium text-foreground">Sincronizar con HubSpot</div>
          <p className="text-xs text-muted-foreground">
            Trae deals (→ edificios) y contacts (→ propietarios) en orden. Último deals: {fmt(dealsState?.last_run_at ?? null)} · contacts: {fmt(contactsState?.last_run_at ?? null)}.
          </p>
          <Button size="sm" variant="gold" onClick={syncAll} disabled={!!running}>
            <RefreshCw className={`mr-1 h-3 w-3 ${running ? "animate-spin" : ""}`} />
            {running ? "Sincronizando…" : "Sincronizar ahora"}
          </Button>
        </div>

        {/* Logs */}
        {health?.recent_logs && health.recent_logs.length > 0 && (
          <div className="rounded-md border border-border-faint">
            <div className="border-b border-border-faint px-3 py-2">
              <Eyebrow>Historial reciente</Eyebrow>
            </div>
            <div className="divide-y divide-border-faint text-sm">
              {health.recent_logs.map((log) => (
                <div key={log.id} className="grid grid-cols-12 gap-2 px-3 py-2">
                  <div className="col-span-3 font-mono text-[11px] text-muted-foreground">{fmt(log.started_at)}</div>
                  <div className="col-span-2"><Badge variant="outline">{log.entity}</Badge></div>
                  <div className="col-span-2 flex items-center gap-1.5"><StatusDot status={log.status} /><span className="font-mono text-[11px] uppercase tracking-eyebrow">{log.status}</span></div>
                  <div className="col-span-2 font-mono text-[11px] text-foreground">↑ {log.records_upserted}</div>
                  <div className="col-span-1 font-mono text-[11px] text-muted-foreground">{log.pages_fetched}p</div>
                  <div className="col-span-2 font-mono text-[11px] text-destructive truncate" title={log.error_message ?? ""}>{log.error_message ?? ""}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

