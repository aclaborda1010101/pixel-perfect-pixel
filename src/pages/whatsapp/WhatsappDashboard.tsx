import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Loader2, QrCode, Send, Bot, Phone, Power,
  MessagesSquare, UserPlus, Activity, Target, ArrowRight,
  TrendingUp, RefreshCw, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SubView = "resumen" | "inbox" | "pipeline" | "conexion" | "bot";

const SUB_NAV: { id: SubView; label: string; icon: any }[] = [
  { id: "resumen",  label: "Resumen",  icon: Activity },
  { id: "inbox",    label: "Inbox",    icon: MessagesSquare },
  { id: "pipeline", label: "Pipeline", icon: Target },
  { id: "conexion", label: "Conexión", icon: Phone },
  { id: "bot",      label: "Bot",      icon: Bot },
];

export default function WhatsappDashboard() {
  const qc = useQueryClient();
  const [view, setView] = useState<SubView>("resumen");
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [polling, setPolling] = useState(false);

  const { data: instance } = useQuery({
    queryKey: ["wa:instance"],
    refetchInterval: polling ? 3000 : 15000,
    queryFn: async () => {
      const { data } = await (supabase.from("wa_instances" as any) as any).select("*").limit(1).maybeSingle();
      return data;
    },
  });

  const { data: conversations } = useQuery({
    queryKey: ["wa:conversations"],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data } = await (supabase.from("wa_conversations" as any) as any)
        .select("id, status, last_message_at, unread_count, ai_enabled, qualification, wa_contacts(phone, name, stage)")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(100);
      return data ?? [];
    },
  });

  const { data: messages } = useQuery({
    queryKey: ["wa:messages", selectedConv],
    enabled: !!selectedConv,
    refetchInterval: 3000,
    queryFn: async () => {
      const { data } = await (supabase.from("wa_messages" as any) as any)
        .select("id, direction, content, created_at, ai_generated, type, metadata")
        .eq("conversation_id", selectedConv)
        .order("created_at", { ascending: true })
        .limit(200);
      return data ?? [];
    },
  });
  // Realtime: avisar al comercial si una conversación pasa a handoff
  useEffect(() => {
    const ch = supabase
      .channel("wa-handoff-watch")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wa_contacts" }, (payload: any) => {
        if (payload?.new?.stage === "handoff" && payload?.old?.stage !== "handoff") {
          toast.warning(`⚠️ Requiere humano: ${payload.new.name ?? payload.new.phone}`, { duration: 10000 });
          qc.invalidateQueries({ queryKey: ["wa:conversations"] });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);


  const { data: cfg } = useQuery({
    queryKey: ["wa:cfg"],
    queryFn: async () => {
      const { data } = await (supabase.from("wa_bot_config" as any) as any).select("*").limit(1).maybeSingle();
      return data;
    },
  });

  // Métricas del dashboard
  const { data: metrics } = useQuery({
    queryKey: ["wa:metrics"],
    refetchInterval: 15000,
    queryFn: async () => {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const since7d  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();
      const [active, newLeads, sent, received, qualified] = await Promise.all([
        (supabase.from("wa_conversations" as any) as any).select("id", { count: "exact", head: true }).gte("last_message_at", since24h),
        (supabase.from("wa_contacts" as any) as any).select("id", { count: "exact", head: true }).gte("created_at", since7d),
        (supabase.from("wa_messages" as any) as any).select("id", { count: "exact", head: true }).eq("direction", "out").gte("created_at", since24h),
        (supabase.from("wa_messages" as any) as any).select("id", { count: "exact", head: true }).eq("direction", "in").gte("created_at", since24h),
        (supabase.from("wa_conversations" as any) as any).select("id", { count: "exact", head: true }).in("qualification", ["caliente","cualificado"]),
      ]);
      const sentN = sent.count ?? 0;
      const recvN = received.count ?? 0;
      const respRate = recvN > 0 ? Math.round((sentN / recvN) * 100) : 0;
      return {
        active: active.count ?? 0,
        newLeads: newLeads.count ?? 0,
        sent: sentN,
        received: recvN,
        respRate,
        qualified: qualified.count ?? 0,
      };
    },
  });

  useEffect(() => {
    if (instance?.status === "qr" || instance?.status === "connecting") setPolling(true);
    else setPolling(false);
  }, [instance?.status]);

  async function connect() {
    setPolling(true);
    const { error } = await supabase.functions.invoke("evolution_connect");
    if (error) toast.error(error.message); else toast.success("Solicitando QR…");
    qc.invalidateQueries({ queryKey: ["wa:instance"] });
  }
  async function disconnect() {
    const { error } = await supabase.functions.invoke("evolution_disconnect");
    if (error) toast.error(error.message); else toast.success("Desconectado");
    qc.invalidateQueries({ queryKey: ["wa:instance"] });
  }
  async function refreshStatus() {
    await supabase.functions.invoke("evolution_status");
    qc.invalidateQueries({ queryKey: ["wa:instance"] });
  }

  async function sendMessage() {
    if (!selectedConv || !draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    const { error } = await supabase.functions.invoke("wa_send_message", { body: { conversation_id: selectedConv, text } });
    if (error) { toast.error(error.message); setDraft(text); }
    qc.invalidateQueries({ queryKey: ["wa:messages", selectedConv] });
  }

  async function toggleAi(convId: string, current: boolean) {
    await (supabase.from("wa_conversations" as any) as any).update({ ai_enabled: !current }).eq("id", convId);
    qc.invalidateQueries({ queryKey: ["wa:conversations"] });
  }

  async function saveCfg(patch: any) {
    if (!cfg?.id) return;
    await (supabase.from("wa_bot_config" as any) as any).update(patch).eq("id", cfg.id);
    qc.invalidateQueries({ queryKey: ["wa:cfg"] });
    toast.success("Bot actualizado");
  }

  const stageCounts: Record<string, number> = useMemo(() =>
    ((conversations ?? []) as any[]).reduce((acc, c: any) => {
      const s = c.wa_contacts?.stage ?? "nuevo"; acc[s] = (acc[s] ?? 0) + 1; return acc;
    }, {} as Record<string, number>),
  [conversations]);

  const statusLabel = instance?.status === "connected"
    ? `Conectado · ${instance?.phone_number ?? "—"}`
    : instance?.status === "qr"
      ? "Esperando escaneo de QR…"
      : instance?.status === "connecting"
        ? "Conectando…"
        : "Desconectado · conecta tu número para empezar";

  const tiles = [
    { label: "Conversaciones activas 24h", value: metrics?.active ?? 0, icon: MessagesSquare, hint: "Con actividad en 24h" },
    { label: "Leads nuevos · 7 días",      value: metrics?.newLeads ?? 0, icon: UserPlus, hint: "Contactos creados" },
    { label: "Mensajes enviados · 24h",    value: metrics?.sent ?? 0, icon: Send, hint: `${metrics?.received ?? 0} recibidos` },
    { label: "Tasa de respuesta",          value: `${metrics?.respRate ?? 0}%`, icon: TrendingUp, hint: "Enviados / recibidos" },
    { label: "Cualificados en pipeline",   value: metrics?.qualified ?? 0, icon: Target, hint: "Caliente + cualificado" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="WhatsApp · Comercial"
        title="Panel de WhatsApp"
        subtitle={statusLabel}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refreshStatus}>
              {polling ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refrescar
            </Button>
            <Button variant="gold" size="sm" onClick={() => setView("conexion")}>
              <QrCode className="h-4 w-4" /> {instance?.status === "connected" ? "Gestionar conexión" : "Conectar WhatsApp"}
            </Button>
          </>
        }
      />

      {/* Sub-navegación */}
      <nav className="-mt-2 flex flex-wrap gap-1 border-b border-border-faint">
        {SUB_NAV.map((s) => {
          const active = view === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setView(s.id)}
              className={cn(
                "relative -mb-px flex items-center gap-2 px-4 py-2.5 font-mono text-[11px] uppercase tracking-eyebrow transition-colors",
                active
                  ? "border-b-2 border-gold text-foreground"
                  : "border-b-2 border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <s.icon className="h-3.5 w-3.5" />
              {s.label}
            </button>
          );
        })}
      </nav>

      {view === "resumen" && (
        <ResumenView
          tiles={tiles}
          conversations={conversations ?? []}
          instance={instance}
          onOpenInbox={(id) => { setSelectedConv(id); setView("inbox"); }}
          onConnect={() => setView("conexion")}
        />
      )}

      {view === "inbox" && (
        <InboxView
          conversations={conversations ?? []}
          messages={messages ?? []}
          selectedConv={selectedConv}
          setSelectedConv={setSelectedConv}
          draft={draft}
          setDraft={setDraft}
          sendMessage={sendMessage}
          toggleAi={toggleAi}
        />
      )}

      {view === "pipeline" && (
        <PipelineView
          conversations={conversations ?? []}
          stageCounts={stageCounts}
          onOpen={(id) => { setSelectedConv(id); setView("inbox"); }}
        />
      )}

      {view === "conexion" && (
        <ConexionView instance={instance} connect={connect} disconnect={disconnect} refreshStatus={refreshStatus} polling={polling} />
      )}

      {view === "bot" && (
        <BotView cfg={cfg} saveCfg={saveCfg} />
      )}
    </div>
  );
}

/* ─────────── Resumen (dashboard) ─────────── */
function ResumenView({ tiles, conversations, instance, onOpenInbox, onConnect }: any) {
  const recent = (conversations as any[]).slice(0, 6);
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {tiles.map((t: any) => (
          <Card key={t.label} className="min-w-0 transition-colors hover:border-gold/50">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-2">
                <Eyebrow className="truncate">{t.label}</Eyebrow>
                <t.icon className="h-4 w-4 text-muted-foreground/60" />
              </div>
              <div className="mt-3">
                <MetricValue size="xl">{t.value}</MetricValue>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-1">
              <Eyebrow>Inbox · Recientes</Eyebrow>
              <CardTitle>Últimas conversaciones</CardTitle>
            </div>
            <Button variant="outline" size="sm" onClick={() => onOpenInbox(recent[0]?.id ?? null)}>
              Ver inbox <ArrowRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border-faint">
              {recent.length === 0 && (
                <li className="px-5 py-8 text-sm text-muted-foreground">Sin conversaciones todavía.</li>
              )}
              {recent.map((c: any) => (
                <li
                  key={c.id}
                  className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-1/40"
                  onClick={() => onOpenInbox(c.id)}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {c.wa_contacts?.name ?? c.wa_contacts?.phone ?? "Contacto"}
                      </span>
                      {c.ai_enabled && <Bot className="h-3 w-3 text-gold" />}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                      {c.wa_contacts?.stage ?? "nuevo"} · {c.last_message_at ? new Date(c.last_message_at).toLocaleString("es") : "—"}
                    </div>
                  </div>
                  {c.unread_count > 0 && (
                    <Badge variant="default" className="bg-gold text-background">{c.unread_count}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Eyebrow>Instancia · Estado</Eyebrow>
            <CardTitle>Conexión Evolution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">Estado</span>
              <Badge variant={instance?.status === "connected" ? "default" : "outline"} className={instance?.status === "connected" ? "bg-success text-background" : ""}>
                {instance?.status ?? "disconnected"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">Número</span>
              <span className="font-mono text-xs text-foreground">{instance?.phone_number ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">Instancia</span>
              <span className="font-mono text-xs text-foreground">{instance?.instance_name ?? "—"}</span>
            </div>
            <Button variant="gold" size="sm" className="w-full" onClick={onConnect}>
              <QrCode className="h-4 w-4" /> {instance?.status === "connected" ? "Gestionar" : "Conectar"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/* ─────────── Inbox ─────────── */
function InboxView({ conversations, messages, selectedConv, setSelectedConv, draft, setDraft, sendMessage, toggleAi }: any) {
  const current = (conversations as any[]).find((c: any) => c.id === selectedConv);
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-12 lg:col-span-4">
        <CardHeader>
          <Eyebrow>Conversaciones</Eyebrow>
          <CardTitle className="text-lg">{conversations.length} · activas</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[64vh] overflow-y-auto p-0">
          <ul className="divide-y divide-border-faint">
            {conversations.length === 0 && (
              <li className="px-5 py-8 text-sm text-muted-foreground">Sin conversaciones aún.</li>
            )}
            {conversations.map((c: any) => (
              <li
                key={c.id}
                onClick={() => setSelectedConv(c.id)}
                className={cn(
                  "cursor-pointer px-5 py-3 transition-colors hover:bg-surface-1/40",
                  selectedConv === c.id && "bg-surface-1/60 border-l-2 border-gold",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {c.wa_contacts?.name ?? c.wa_contacts?.phone}
                  </span>
                  {c.ai_enabled && <Bot className="h-3 w-3 text-gold" />}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                  {c.wa_contacts?.stage ?? "nuevo"} · {c.last_message_at ? new Date(c.last_message_at).toLocaleString("es") : "—"}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="col-span-12 flex max-h-[64vh] flex-col lg:col-span-8">
        <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border-faint">
          <div className="min-w-0 space-y-0.5">
            <Eyebrow>Conversación</Eyebrow>
            <CardTitle className="truncate text-base">
              {current ? (current.wa_contacts?.name ?? current.wa_contacts?.phone) : "Selecciona una conversación"}
            </CardTitle>
          </div>
          {current && (
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
              Bot
              <Switch
                checked={current.ai_enabled ?? true}
                onCheckedChange={() => toggleAi(current.id, current.ai_enabled)}
              />
            </div>
          )}
        </CardHeader>
        <CardContent className="flex flex-1 flex-col overflow-hidden p-0">
          <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
            {!current && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Selecciona una conversación de la izquierda
              </div>
            )}
            {(messages as any[]).map((m: any) => (
              <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[75%] rounded-[6px] border px-3 py-2 text-sm",
                  m.direction === "out"
                    ? "border-gold/30 bg-gold/10 text-foreground"
                    : "border-border-faint bg-surface-1/60 text-foreground",
                )}>
                  {m.content}
                  <div className="mt-1 flex items-center gap-2 font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
                    {new Date(m.created_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
                    {m.ai_generated && <span className="text-gold">· bot</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {current && (
            <div className="flex gap-2 border-t border-border-faint p-3">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}
                placeholder="Escribe un mensaje…"
              />
              <Button onClick={sendMessage} variant="gold"><Send className="h-4 w-4" /></Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────── Pipeline ─────────── */
function PipelineView({ conversations, stageCounts, onOpen }: any) {
  const stages = ["nuevo", "conversando", "cualificado", "caliente", "cerrado"];
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
      {stages.map((s) => (
        <Card key={s} className="min-w-0">
          <CardHeader className="pb-3">
            <Eyebrow>{s}</Eyebrow>
            <CardTitle><MetricValue size="lg">{stageCounts[s] ?? 0}</MetricValue></CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0">
            {(conversations as any[])
              .filter((c: any) => (c.wa_contacts?.stage ?? "nuevo") === s)
              .slice(0, 12)
              .map((c: any) => (
                <div
                  key={c.id}
                  onClick={() => onOpen(c.id)}
                  className="cursor-pointer rounded-[4px] border border-border-faint bg-surface-1/30 p-2.5 text-xs transition-colors hover:border-gold/50 hover:bg-surface-1/60"
                >
                  <div className="truncate font-medium text-foreground">
                    {c.wa_contacts?.name ?? c.wa_contacts?.phone}
                  </div>
                  <div className="mt-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
                    {c.last_message_at ? new Date(c.last_message_at).toLocaleDateString("es") : "—"}
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ─────────── Conexión ─────────── */
function ConexionView({ instance, connect, disconnect, refreshStatus, polling }: any) {
  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <Eyebrow>Instancia · {instance?.instance_name ?? "—"}</Eyebrow>
          <CardTitle className="flex items-center gap-2">
            Estado
            <Badge variant={instance?.status === "connected" ? "default" : "outline"} className={instance?.status === "connected" ? "bg-success text-background" : ""}>
              {instance?.status ?? "disconnected"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">Número</span>
              <span className="font-mono text-xs text-foreground">{instance?.phone_number ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">Última actualización</span>
              <span className="font-mono text-xs text-foreground">{instance?.updated_at ? new Date(instance.updated_at).toLocaleString("es") : "—"}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={connect} variant="gold" size="sm"><QrCode className="h-4 w-4" /> Conectar / refrescar QR</Button>
            <Button onClick={refreshStatus} variant="outline" size="sm">
              {polling ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Estado
            </Button>
            {instance?.status === "connected" && (
              <Button onClick={disconnect} variant="destructive" size="sm"><Power className="h-4 w-4" /> Desconectar</Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Eyebrow>Vinculación</Eyebrow>
          <CardTitle>Código QR</CardTitle>
        </CardHeader>
        <CardContent>
          {instance?.status === "connected" ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-success/40 bg-success/10 text-success">
                <Phone className="h-7 w-7" />
              </div>
              <p className="text-sm text-foreground">Conectado al número <span className="font-mono">{instance?.phone_number ?? "—"}</span></p>
            </div>
          ) : instance?.qr_base64 ? (
            <div className="flex flex-col items-center gap-3">
              <img src={instance.qr_base64} alt="QR WhatsApp" className="h-56 w-56 rounded-[6px] border border-border-faint bg-white p-2" />
              <p className="text-center text-xs text-muted-foreground">
                WhatsApp → Dispositivos vinculados → Vincular un dispositivo
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border-faint bg-surface-1/40 text-muted-foreground">
                <QrCode className="h-7 w-7" />
              </div>
              <p className="text-sm text-muted-foreground">Pulsa "Conectar" para generar el QR</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────── Bot ─────────── */
function BotView({ cfg, saveCfg }: any) {
  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader>
        <Eyebrow><Bot className="mr-1 inline h-3 w-3" /> Configuración del bot</Eyebrow>
        <CardTitle>Persona y comportamiento</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <label className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">Persona</label>
          <Textarea defaultValue={cfg?.persona ?? ""} rows={5} onBlur={(e) => saveCfg({ persona: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">Delay min (s)</label>
            <Input type="number" defaultValue={cfg?.reply_delay_min ?? 4} onBlur={(e) => saveCfg({ reply_delay_min: Number(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <label className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">Delay max (s)</label>
            <Input type="number" defaultValue={cfg?.reply_delay_max ?? 22} onBlur={(e) => saveCfg({ reply_delay_max: Number(e.target.value) })} />
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-[6px] border border-border-faint bg-surface-1/30 p-3">
          <Switch defaultChecked={cfg?.is_active ?? true} onCheckedChange={(v) => saveCfg({ is_active: v })} />
          <span className="text-sm text-foreground">Bot activo (responde automáticamente)</span>
        </div>
      </CardContent>
    </Card>
  );
}