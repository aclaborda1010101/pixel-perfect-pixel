import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Loader2, QrCode, Send, Bot, Phone, Power,
  MessagesSquare, UserPlus, Activity, Target, ArrowRight,
  TrendingUp, RefreshCw, AlertTriangle, History, Search, FileText, Check, X as XIcon, Sparkles,
  Mic, Image as ImageIcon, FileType2, Building2, Users, IdCard, Briefcase, Home,
  ShieldCheck, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SubView = "resumen" | "inbox" | "historico" | "conexion" | "bot";

/* Roles según enums internos (owner_role / owner_subrole) */
const ROL_OPTIONS: { value: string; label: string }[] = [
  { value: "particular",            label: "Particular" },
  { value: "heredero",              label: "Heredero" },
  { value: "inversor_pasivo",       label: "Inversor pasivo" },
  { value: "operador_profesional",  label: "Operador profesional" },
  { value: "institucional",         label: "Institucional" },
  { value: "desconocido",           label: "Desconocido" },
];
const SUBROL_OPTIONS: { value: string; label: string }[] = [
  { value: "ninguno",                label: "Ninguno" },
  { value: "heredero_operador",      label: "Heredero · operador" },
  { value: "heredero_residente",     label: "Heredero · residente" },
  { value: "heredero_ausente",       label: "Heredero · ausente" },
  { value: "heredero_conflictivo",   label: "Heredero · conflictivo" },
  { value: "arrendador",             label: "Arrendador" },
  { value: "usufructuario",          label: "Usufructuario" },
  { value: "nudo_propietario",       label: "Nudo propietario" },
  { value: "apoderado",              label: "Apoderado" },
];
function rolLabel(v?: string | null) {
  if (!v) return null;
  return (ROL_OPTIONS.find((o) => o.value === v)?.label) ?? v;
}
function subrolLabel(v?: string | null) {
  if (!v || v === "ninguno") return null;
  return (SUBROL_OPTIONS.find((o) => o.value === v)?.label) ?? v;
}

function MessageBody({ m }: { m: any }) {
  const media = m?.metadata?.media;
  const kind = media?.kind ?? (m.type !== "text" ? m.type : null);
  if (!kind) {
    return <div className="whitespace-pre-line">{m.content}</div>;
  }
  const status = media?.processing;
  const Icon = kind === "audio" ? Mic : kind === "image" ? ImageIcon : FileType2;
  const label =
    kind === "audio" ? "Audio" :
    kind === "image" ? "Imagen" :
    kind === "document" ? (media?.filename ?? "Documento") :
    kind;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
        {status === "pending" && <span className="text-gold">· procesando…</span>}
        {status === "failed" && <span className="text-destructive">· error</span>}
        {status === "done" && <span className="text-success">· procesado</span>}
      </div>
      <div className="whitespace-pre-line text-[13px] leading-snug">
        {m.content || <span className="italic text-muted-foreground/70">Sin contenido aún</span>}
      </div>
    </div>
  );
}

const SUB_NAV: { id: SubView; label: string; icon: any }[] = [
  { id: "resumen",  label: "Resumen",  icon: Activity },
  { id: "inbox",    label: "Inbox",    icon: MessagesSquare },
  { id: "historico",label: "Histórico",icon: History },
  { id: "conexion", label: "Conexión", icon: Phone },
  { id: "bot",      label: "Bot",      icon: Bot },
];

/* ─────────── Kill switch global (cabecera) ───────────
   Control prominente para PARAR todas las respuestas automáticas al instante.
   Verde = activo · Rojo = detenido. Apagarlo pide confirmación. */
function KillSwitchControl({ active, onToggle }: { active: boolean; onToggle: (next: boolean) => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <div className={cn(
      "flex items-center gap-2 rounded-[6px] border px-3 py-1.5",
      active ? "border-success/40 bg-success/10" : "border-destructive/50 bg-destructive/10",
    )}>
      <span className={cn(
        "flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-eyebrow",
        active ? "text-success" : "text-destructive",
      )}>
        {active ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
        {active ? "Bot activo" : "🛑 Bot detenido"}
      </span>
      <Switch
        checked={active}
        onCheckedChange={(v) => { if (v) onToggle(true); else setConfirmOpen(true); }}
        aria-label="Kill switch global del bot"
      />
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>🛑 ¿Parar el bot (kill switch)?</AlertDialogTitle>
            <AlertDialogDescription>
              Esto detiene AL INSTANTE todas las respuestas automáticas y los seguimientos.
              Los mensajes entrantes se seguirán registrando, pero el bot no contestará a nadie
              hasta que lo reactives. Úsalo si Meta marca o bloquea el número.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onToggle(false)}
            >
              Sí, parar el bot
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

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
        .select("id, contact_id, status, last_message_at, unread_count, ai_enabled, qualification, summary, summary_updated_at, handoff_reason, created_at, rol_owner, subrol_owner, rol_source, rol_confianza, wa_contacts(id, phone, name, stage, lead_id, metadata)")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(500);
      return data ?? [];
    },
  });

  const { data: messages } = useQuery({
    queryKey: ["wa:messages", selectedConv],
    enabled: !!selectedConv,
    refetchInterval: 3000,
    queryFn: async () => {
      const { data } = await (supabase.from("wa_messages" as any) as any)
        .select("id, direction, content, created_at, ai_generated, type, metadata, sender_type, agent_user_id")
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
      const [active, newLeads, sent, received, qualified, outRows, inRows] = await Promise.all([
        (supabase.from("wa_conversations" as any) as any).select("id", { count: "exact", head: true }).gte("last_message_at", since24h),
        (supabase.from("wa_contacts" as any) as any).select("id", { count: "exact", head: true }).gte("created_at", since7d),
        (supabase.from("wa_messages" as any) as any).select("id", { count: "exact", head: true }).eq("direction", "out").gte("created_at", since24h),
        (supabase.from("wa_messages" as any) as any).select("id", { count: "exact", head: true }).eq("direction", "in").gte("created_at", since24h),
        (supabase.from("wa_conversations" as any) as any).select("id", { count: "exact", head: true }).in("qualification", ["caliente","cualificado"]),
        (supabase.from("wa_messages" as any) as any).select("conversation_id").eq("direction", "out").gte("created_at", since24h).limit(2000),
        (supabase.from("wa_messages" as any) as any).select("conversation_id").eq("direction", "in").gte("created_at", since24h).limit(2000),
      ]);
      const sentN = sent.count ?? 0;
      const recvN = received.count ?? 0;
      // Nueva tasa: % conversaciones contactadas en 24h que han respondido (acotado 0..100)
      const outConvs = new Set(((outRows as any).data ?? []).map((r: any) => r.conversation_id));
      const inConvs  = new Set(((inRows  as any).data ?? []).map((r: any) => r.conversation_id));
      let replied = 0;
      outConvs.forEach((id) => { if (inConvs.has(id)) replied++; });
      const respRate = outConvs.size > 0 ? Math.round((replied / outConvs.size) * 100) : 0;
      const respHint = `${replied} / ${outConvs.size} contactadas`;
      return {
        active: active.count ?? 0,
        newLeads: newLeads.count ?? 0,
        sent: sentN,
        received: recvN,
        respRate,
        respHint,
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
    const next = !current;
    // Al reactivar el bot, limpiamos también el handoff_reason y devolvemos al contacto
    // a "conversando" si estaba en "handoff", para que wa_ai_reply vuelva a contestar.
    await (supabase.from("wa_conversations" as any) as any)
      .update(next ? { ai_enabled: true, handoff_reason: null } : { ai_enabled: false })
      .eq("id", convId);
    if (next) {
      const conv = (conversations ?? []).find((c: any) => c.id === convId);
      const contactId = conv?.contact_id ?? conv?.wa_contacts?.id;
      if (conv?.wa_contacts?.stage === "handoff" && contactId) {
        await (supabase.from("wa_contacts" as any) as any)
          .update({ stage: "conversando" })
          .eq("id", contactId);
      }
    }
    qc.invalidateQueries({ queryKey: ["wa:conversations"] });
  }

  async function regenerateSummary(convId: string) {
    const t = toast.loading("Regenerando resumen…");
    const { error } = await supabase.functions.invoke("wa_summarize", { body: { conversation_id: convId, force: true } });
    toast.dismiss(t);
    if (error) toast.error(error.message); else toast.success("Resumen actualizado");
    qc.invalidateQueries({ queryKey: ["wa:conversations"] });
  }

  async function setRol(convId: string, patch: { rol_owner?: string | null; subrol_owner?: string | null }) {
    const update: any = { ...patch, rol_source: "manual" };
    await (supabase.from("wa_conversations" as any) as any).update(update).eq("id", convId);
    qc.invalidateQueries({ queryKey: ["wa:conversations"] });
    toast.success("Rol actualizado");
  }

  async function saveCfg(patch: any) {
    if (!cfg?.id) return;
    await (supabase.from("wa_bot_config" as any) as any).update(patch).eq("id", cfg.id);
    qc.invalidateQueries({ queryKey: ["wa:cfg"] });
    toast.success("Bot actualizado");
  }

  // KILL SWITCH global: enciende/apaga TODAS las respuestas automáticas (wa_bot_config.is_active).
  // Upsert si no existe fila de config.
  const botActive = (cfg as any)?.is_active !== false;
  async function setBotActive(next: boolean) {
    if ((cfg as any)?.id) {
      await (supabase.from("wa_bot_config" as any) as any).update({ is_active: next }).eq("id", (cfg as any).id);
    } else {
      await (supabase.from("wa_bot_config" as any) as any).insert({ is_active: next });
    }
    qc.invalidateQueries({ queryKey: ["wa:cfg"] });
    if (next) toast.success("Bot ACTIVADO · responde automáticamente");
    else toast.warning("🛑 Bot DETENIDO · no se enviará ningún mensaje automático");
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
    { label: "Tasa de respuesta",          value: `${metrics?.respRate ?? 0}%`, icon: TrendingUp, hint: metrics?.respHint ?? "Han respondido / contactadas" },
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
            <KillSwitchControl active={botActive} onToggle={setBotActive} />
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
          regenerateSummary={regenerateSummary}
          setRol={setRol}
        />
      )}

      {view === "historico" && (
        <HistoricoView
          conversations={conversations ?? []}
          messages={messages ?? []}
          selectedConv={selectedConv}
          setSelectedConv={setSelectedConv}
          regenerateSummary={regenerateSummary}
          toggleAi={toggleAi}
          setRol={setRol}
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
                      {(subrolLabel(c.subrol_owner) || rolLabel(c.rol_owner)) && (
                        <span className="rounded-full border border-gold/40 bg-gold/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-gold/90">
                          {subrolLabel(c.subrol_owner) ?? rolLabel(c.rol_owner)}
                        </span>
                      )}
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
function InboxView({ conversations, messages, selectedConv, setSelectedConv, draft, setDraft, sendMessage, toggleAi, regenerateSummary, setRol }: any) {
  const current = (conversations as any[]).find((c: any) => c.id === selectedConv);
  const isHandoff = current?.wa_contacts?.stage === "handoff";
  const qual = (current?.qualification ?? {}) as Record<string, any>;
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-12 lg:col-span-3">
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
                  <div className="flex shrink-0 items-center gap-1">
                    {c.wa_contacts?.stage === "handoff" && (
                      <Badge variant="destructive" className="px-1.5 py-0 text-[9px] uppercase">
                        <AlertTriangle className="mr-0.5 h-2.5 w-2.5" /> humano
                      </Badge>
                    )}
                    {c.ai_enabled && c.wa_contacts?.stage !== "handoff" && <Bot className="h-3 w-3 text-gold" />}
                  </div>
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                  {c.wa_contacts?.stage ?? "nuevo"} · {c.last_message_at ? new Date(c.last_message_at).toLocaleString("es") : "—"}
                </div>
                {(subrolLabel(c.subrol_owner) || rolLabel(c.rol_owner)) && (
                  <div className="mt-1">
                    <span className="inline-block rounded-full border border-gold/40 bg-gold/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-gold/90">
                      {subrolLabel(c.subrol_owner) ?? rolLabel(c.rol_owner)}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="col-span-12 flex max-h-[64vh] flex-col lg:col-span-6">
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
          {isHandoff && (
            <div className="flex items-start gap-2 border-b border-destructive/40 bg-destructive/10 px-5 py-3 text-sm text-destructive-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
              <div>
                <div className="font-semibold text-destructive">⚠️ Requiere humano</div>
                <div className="text-xs text-muted-foreground">
                  El bot se ha pausado automáticamente. Retoma la conversación manualmente; cuando termines, puedes reactivar el bot con el toggle superior.
                </div>
              </div>
            </div>
          )}
          <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
            {!current && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Selecciona una conversación de la izquierda
              </div>
            )}
            {(messages as any[]).map((m: any) => {
              if (m.type === "system") {
                return (
                  <div key={m.id} className="my-2 flex justify-center">
                    <div className="max-w-[85%] rounded-[6px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">
                      {m.content}
                    </div>
                  </div>
                );
              }
              return (
                <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[75%] rounded-[6px] border px-3 py-2 text-sm",
                    m.direction === "out"
                      ? "border-gold/30 bg-gold/10 text-foreground"
                      : "border-border-faint bg-surface-1/60 text-foreground",
                  )}>
                    <MessageBody m={m} />
                    <div className="mt-1 flex items-center gap-2 font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
                      {new Date(m.created_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
                      {m.ai_generated && <span className="text-gold">· bot</span>}
                    </div>
                  </div>
                </div>
              );
            })}
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

      {/* Panel lateral derecho con cualificación en vivo */}
      <Card className="col-span-12 lg:col-span-3">
        <CardHeader>
          <Eyebrow>Ficha del lead</Eyebrow>
          <CardTitle className="text-base">Datos en vivo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!current && (
            <p className="text-xs text-muted-foreground">Selecciona una conversación para ver la ficha.</p>
          )}
          {current && (
            <LeadCard current={current} qual={qual} regenerateSummary={regenerateSummary} setRol={setRol} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────── Ficha del lead (panel derecho del Inbox) ─────────── */
function LeadCard({ current, qual, regenerateSummary, setRol }: any) {
  const stage = current.wa_contacts?.stage ?? "nuevo";
  const contactId = current.wa_contacts?.id ?? current.contact_id;
  const phone = current.wa_contacts?.phone ?? "";
  const phoneLast9 = String(phone).replace(/\D/g, "").slice(-9);
  const ownerId = current.wa_contacts?.lead_id ?? null;

  // Memoria cross-channel: con quién más ha hablado este propietario.
  const { data: priorTouches } = useQuery({
    queryKey: ["wa:prior-touches", contactId, ownerId, phoneLast9],
    enabled: !!contactId,
    queryFn: async () => {
      const out: { when: string; channel: string; who: string; preview?: string }[] = [];
      // 1) Mensajes WhatsApp de agentes humanos del propio equipo.
      const { data: hum } = await (supabase.from("wa_messages" as any) as any)
        .select("created_at, content, agent_user_id")
        .eq("contact_id", contactId)
        .eq("sender_type", "human_agent")
        .order("created_at", { ascending: false })
        .limit(5);
      const ids = Array.from(new Set((hum ?? []).map((m: any) => m.agent_user_id).filter(Boolean)));
      const names: Record<string, string> = {};
      if (ids.length) {
        const { data: profs } = await (supabase.from("profiles" as any) as any)
          .select("id, full_name, email").in("id", ids);
        for (const p of profs ?? []) names[(p as any).id] = (p as any).full_name || (p as any).email || "agente";
      }
      for (const m of hum ?? []) {
        out.push({
          when: new Date((m as any).created_at).toLocaleDateString("es-ES"),
          channel: "WhatsApp",
          who: names[(m as any).agent_user_id] ?? "agente",
          preview: String((m as any).content ?? "").slice(0, 90),
        });
      }
      // 2) Llamadas internas (vía owner_id).
      if (ownerId) {
        try {
          const { data: calls } = await (supabase.from("calls" as any) as any)
            .select("fecha, comercial_nombre, outcome")
            .eq("owner_id", ownerId)
            .order("fecha", { ascending: false })
            .limit(5);
          for (const c of calls ?? []) {
            out.push({
              when: new Date((c as any).fecha).toLocaleDateString("es-ES"),
              channel: "Llamada",
              who: (c as any).comercial_nombre ?? "—",
              preview: (c as any).outcome ?? undefined,
            });
          }
        } catch { /* tabla opcional */ }
      }
      // 3) Llamadas HubSpot por teléfono.
      if (phoneLast9) {
        try {
          const { data: hsCalls } = await (supabase.from("hubspot_calls" as any) as any)
            .select("hs_timestamp, hs_call_direction, hs_call_disposition")
            .or(`hs_call_to_number.ilike.%${phoneLast9},hs_call_from_number.ilike.%${phoneLast9}`)
            .order("hs_timestamp", { ascending: false })
            .limit(5);
          for (const c of hsCalls ?? []) {
            out.push({
              when: new Date((c as any).hs_timestamp).toLocaleDateString("es-ES"),
              channel: `HubSpot ${(c as any).hs_call_direction ?? ""}`.trim(),
              who: (c as any).hs_call_disposition ?? "—",
            });
          }
        } catch { /* opcional */ }
      }
      return out
        .sort((a, b) => (a.when < b.when ? 1 : -1))
        .slice(0, 6);
    },
  });

  const stageColor =
    stage === "handoff" ? "border-destructive/40 bg-destructive/10 text-destructive" :
    stage === "caliente" || stage === "cualificado" ? "border-gold/40 bg-gold/10 text-gold" :
    "border-border-faint bg-surface-1/40 text-foreground";

  const SiNo = ({ v }: { v: any }) => {
    if (v === "si" || v === true)  return <span className="text-success">✅ Sí</span>;
    if (v === "no" || v === false) return <span className="text-destructive">⚠ No</span>;
    if (v == null || v === "")     return <span className="italic text-muted-foreground/60">—</span>;
    return <span className="text-foreground">{String(v)}</span>;
  };
  const Text = ({ v }: { v: any }) => {
    const has = v != null && v !== "";
    return <span className={cn(has ? "text-foreground" : "italic text-muted-foreground/60")}>{has ? String(v) : "—"}</span>;
  };

  const SectionHeader = ({ icon: Icon, label }: any) => (
    <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
      <Icon className="h-3 w-3" /> {label}
    </div>
  );
  const Row = ({ label, children }: any) => (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-right text-xs">{children}</span>
    </div>
  );

  const pendientes: string[] = [];
  if (!qual.nombre_apellidos)        pendientes.push("Nombre y apellidos");
  if (qual.gestiona_edificio == null) pendientes.push("Gestiona el edificio");
  if (qual.vive_en_edificio == null) pendientes.push("Vive en el edificio");
  if (!qual.relacion_copropietarios) pendientes.push("Vínculo con la propiedad");
  if (qual.tiene_cuadro_rentas == null) pendientes.push("Cuadro de rentas");

  return (
    <>
      {/* AVISO IDENTIDAD DUDOSA */}
      {qual.identidad_dudosa === true && (
        <section className="rounded-[6px] border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-200">
          ⚠️ Identidad por confirmar: el nombre que da no coincide con el del registro.
        </section>
      )}

      {/* FICHA DEL LEAD · resumen normalizado (lo que el bot ha extraído) */}
      <FichaLead qual={qual} current={current} />

      {/* IDENTIDAD */}
      <section className="rounded-[6px] border border-border-faint bg-surface-1/30 p-3">
        <SectionHeader icon={IdCard} label="Identidad" />
        <div className="text-sm font-medium text-foreground">
          {qual.nombre_apellidos || current.wa_contacts?.name || current.wa_contacts?.phone || "—"}
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{current.wa_contacts?.phone ?? "—"}</div>
        <div className="mt-2 flex items-center gap-2">
          <span className={cn("rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow", stageColor)}>
            {stage}
          </span>
          {qual.categoria && (
            <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-gold">
              Cat. {String(qual.categoria).toUpperCase()}
            </span>
          )}
          {qual.perfil_copropietario && qual.perfil_copropietario !== "indefinido" && (
            <span className="rounded-full border border-border-faint bg-surface-1/40 px-2 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-foreground/80">
              {({
                gestor_cansado: "Gestor cansado",
                desplazado: "Desplazado",
                controlador: "Controlador",
                dominante: "Dominante",
                mediador_protector: "Mediador protector",
                inquilino_ocupante: "Inquilino/ocupante",
                informado: "Informado",
              } as Record<string, string>)[qual.perfil_copropietario] ?? qual.perfil_copropietario}
            </span>
          )}
          {current.rol_source === "ia" && (
            <span className="rounded-full border border-gold/30 bg-gold/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-gold/80">
              <Sparkles className="mr-0.5 inline h-2.5 w-2.5" /> IA{current.rol_confianza ? ` · ${Math.round(current.rol_confianza * 100)}%` : ""}
            </span>
          )}
          {current.rol_source === "manual" && (
            <span className="rounded-full border border-border-faint bg-surface-1/40 px-2 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
              Manual
            </span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2">
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Rol</div>
            <Select value={current.rol_owner ?? ""} onValueChange={(v) => setRol(current.id, { rol_owner: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sin clasificar" /></SelectTrigger>
              <SelectContent>
                {ROL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Subrol</div>
            <Select value={current.subrol_owner ?? ""} onValueChange={(v) => setRol(current.id, { subrol_owner: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {SUBROL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* INMUEBLE */}
      {(qual.direccion_inmueble || qual.tipo_inmueble || qual.codigo_postal) && (
        <section className="rounded-[6px] border border-border-faint bg-surface-1/30 p-3">
          <SectionHeader icon={Home} label="Inmueble" />
          {qual.direccion_inmueble && <Row label="Dirección"><Text v={qual.direccion_inmueble} /></Row>}
          {qual.codigo_postal && <Row label="CP"><Text v={qual.codigo_postal} /></Row>}
          {qual.tipo_inmueble && <Row label="Tipo"><Text v={qual.tipo_inmueble} /></Row>}
        </section>
      )}

      {/* CONTACTOS PREVIOS (memoria cross-channel) */}
      {(priorTouches?.length ?? 0) > 0 && (
        <section className="rounded-[6px] border border-border-faint bg-surface-1/30 p-3">
          <SectionHeader icon={History} label="Ya contactado por" />
          <ul className="space-y-1.5">
            {priorTouches!.map((t, i) => (
              <li key={i} className="text-[11px] leading-snug">
                <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">{t.when}</span>
                <span className="mx-1 text-muted-foreground">·</span>
                <span className="text-foreground">{t.channel}</span>
                <span className="mx-1 text-muted-foreground">·</span>
                <span className="text-foreground/80">{t.who}</span>
                {t.preview && (
                  <div className="truncate text-[10.5px] text-muted-foreground/80">{t.preview}</div>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] italic text-muted-foreground/70">
            El bot también recibe este contexto y evita repetir preguntas o saludos.
          </p>
        </section>
      )}

      {/* VÍNCULO CON LA PROPIEDAD */}
      <section className="rounded-[6px] border border-border-faint bg-surface-1/30 p-3">
        <SectionHeader icon={Users} label="Vínculo con la propiedad" />
        <Row label="Gestiona el edificio"><SiNo v={qual.gestiona_edificio} /></Row>
        <Row label="Vive en el edificio"><SiNo v={qual.vive_en_edificio} /></Row>
        <Row label="Relación familiar"><Text v={qual.relacion_copropietarios} /></Row>
      </section>

      {/* MOTIVACIÓN P0–P3 */}
      {(qual.p0_complejidad || qual.p1_oferta_previa || qual.p2_motivo || qual.p3_sensible) && (
        <section className="rounded-[6px] border border-border-faint bg-surface-1/30 p-3">
          <SectionHeader icon={Sparkles} label="Motivación (P0–P3)" />
          {qual.p0_complejidad && (
            <div className="mb-2 rounded-md border border-gold/40 bg-gold/10 p-2">
              <div className="font-mono text-[9px] uppercase tracking-eyebrow text-gold">P0 · Complejidad</div>
              <div className="mt-0.5 text-xs text-foreground">{String(qual.p0_complejidad)}</div>
            </div>
          )}
          {qual.p1_oferta_previa && <Row label="P1 · Oferta previa"><SiNo v={qual.p1_oferta_previa} /></Row>}
          {qual.p2_motivo && <Row label="P2 · Motivo"><Text v={qual.p2_motivo} /></Row>}
          {qual.p3_sensible && <Row label="P3 · Sensible"><Text v={qual.p3_sensible} /></Row>}
        </section>
      )}

      {/* IDENTIFICADO EN BD */}
      <IdentificadoEnBD contact={current.wa_contacts} />

      {/* DATOS COMERCIALES */}
      <section className="rounded-[6px] border border-border-faint bg-surface-1/30 p-3">
        <SectionHeader icon={Briefcase} label="Datos comerciales" />
        <Row label="Cuadro de rentas / vencimientos"><SiNo v={qual.tiene_cuadro_rentas} /></Row>
        <Row label="Último mensaje">
          <span className="font-mono text-[10px] text-muted-foreground">
            {current.last_message_at ? new Date(current.last_message_at).toLocaleString("es") : "—"}
          </span>
        </Row>
      </section>

      {/* RESUMEN IA */}
      <section className="rounded-[6px] border border-border-faint bg-surface-1/30 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
            <FileText className="h-3 w-3" /> Resumen IA · próximo paso
          </div>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => regenerateSummary(current.id)}>
            <Sparkles className="h-3 w-3" /> Regenerar
          </Button>
        </div>
        <div className="whitespace-pre-line text-xs text-foreground/90">
          {current.summary
            ? current.summary
            : <span className="italic text-muted-foreground/70">Aún no hay resumen. Se genera tras propuestas de llamada, handoff o ≥6 mensajes nuevos.</span>}
        </div>
        {current.summary_updated_at && (
          <div className="mt-1 font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
            Actualizado: {new Date(current.summary_updated_at).toLocaleString("es")}
          </div>
        )}
      </section>

      {pendientes.length > 0 && (
        <details className="rounded-[6px] border border-dashed border-border-faint bg-surface-1/20 p-3">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
            Campos pendientes · {pendientes.length}
          </summary>
          <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
            {pendientes.map((p) => <li key={p}>· {p}</li>)}
          </ul>
        </details>
      )}
    </>
  );
}

/* ─────────── Histórico ─────────── */
const STAGES_ALL = ["todos", "nuevo", "conversando", "cualificado", "caliente", "handoff", "cerrado"];
const QUAL_FIELDS_HIST: { key: string; label: string }[] = [
  { key: "nombre_apellidos",         label: "Nombre y apellidos" },
  { key: "gestiona_edificio",        label: "Gestiona el edificio" },
  { key: "tiene_cuadro_rentas",      label: "Cuadro de rentas / vencimientos" },
  { key: "vive_en_edificio",         label: "Vive en el edificio" },
  { key: "relacion_copropietarios",  label: "Relación con copropietarios" },
];

function HistoricoView({ conversations, messages, selectedConv, setSelectedConv, regenerateSummary, toggleAi, setRol }: any) {
  const [stageFilter, setStageFilter] = useState<string>("todos");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (conversations as any[]).filter((c) => {
      const stage = c.wa_contacts?.stage ?? "nuevo";
      if (stageFilter !== "todos" && stage !== stageFilter) return false;
      if (!term) return true;
      const hay = `${c.wa_contacts?.name ?? ""} ${c.wa_contacts?.phone ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [conversations, stageFilter, q]);

  const current = (conversations as any[]).find((c: any) => c.id === selectedConv);

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Lista + filtros */}
      <Card className="col-span-12 lg:col-span-5">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Eyebrow>Histórico</Eyebrow>
              <CardTitle className="text-base">{filtered.length} · conversaciones</CardTitle>
            </div>
          </div>
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o teléfono…" className="pl-8" />
            </div>
            <div className="flex flex-wrap gap-1">
              {STAGES_ALL.map((s) => (
                <button
                  key={s}
                  onClick={() => setStageFilter(s)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-eyebrow transition-colors",
                    stageFilter === s
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-border-faint text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="max-h-[60vh] overflow-y-auto p-0">
          <ul className="divide-y divide-border-faint">
            {filtered.length === 0 && (
              <li className="px-5 py-8 text-sm text-muted-foreground">Sin resultados.</li>
            )}
            {filtered.map((c: any) => {
              const stage = c.wa_contacts?.stage ?? "nuevo";
              const snippet = (c.summary ?? "").split("\n").slice(0, 2).join(" ").slice(0, 140);
              return (
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
                      {c.wa_contacts?.name ?? c.wa_contacts?.phone ?? "—"}
                    </span>
                    <Badge
                      variant={stage === "handoff" ? "destructive" : "outline"}
                      className="px-1.5 py-0 text-[9px] uppercase"
                    >
                      {stage === "handoff" && <AlertTriangle className="mr-0.5 h-2.5 w-2.5" />}
                      {stage}
                    </Badge>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                    <span>{c.wa_contacts?.phone ?? "—"}</span>
                    <span>·</span>
                    <span>{c.last_message_at ? new Date(c.last_message_at).toLocaleString("es") : "—"}</span>
                  </div>
                  {snippet && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{snippet}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* Ficha */}
      <div className="col-span-12 space-y-4 lg:col-span-7">
        {!current && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Selecciona una conversación para ver el histórico completo.
            </CardContent>
          </Card>
        )}
        {current && (
          <ConversationDetail
            conv={current}
            messages={messages}
            regenerateSummary={regenerateSummary}
            toggleAi={toggleAi}
            setRol={setRol}
          />
        )}
      </div>
    </div>
  );
}

function ConversationDetail({ conv, messages, regenerateSummary, toggleAi, setRol }: any) {
  const isHandoff = conv.wa_contacts?.stage === "handoff";
  const qual = (conv.qualification ?? {}) as Record<string, any>;
  const stage = conv.wa_contacts?.stage ?? "nuevo";
  const stageColor =
    stage === "handoff" ? "border-destructive/40 bg-destructive/10 text-destructive" :
    stage === "caliente" || stage === "cualificado" ? "border-gold/40 bg-gold/10 text-gold" :
    "border-border-faint bg-surface-1/40 text-foreground";
  return (
    <>
      {/* Cabecera de la ficha */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <Eyebrow>Ficha del lead</Eyebrow>
            <CardTitle className="truncate text-lg">
              {qual.nombre_apellidos || conv.wa_contacts?.name || conv.wa_contacts?.phone || "—"}
            </CardTitle>
            <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
              {conv.wa_contacts?.phone ?? "—"}
              {conv.created_at && <> · abierta {new Date(conv.created_at).toLocaleDateString("es")}</>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className={cn("rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow", stageColor)}>
                {stage}
              </span>
              {(subrolLabel(conv.subrol_owner) || rolLabel(conv.rol_owner)) && (
                <span className="rounded-full border border-gold/40 bg-gold/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-gold/90">
                  {subrolLabel(conv.subrol_owner) ?? rolLabel(conv.rol_owner)}
                </span>
              )}
              {conv.rol_source === "ia" && (
                <span className="rounded-full border border-gold/30 bg-gold/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-gold/80">
                  <Sparkles className="mr-0.5 inline h-2.5 w-2.5" /> IA{conv.rol_confianza ? ` · ${Math.round(conv.rol_confianza * 100)}%` : ""}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
            Bot
            <Switch checked={conv.ai_enabled ?? true} onCheckedChange={() => toggleAi(conv.id, conv.ai_enabled)} />
          </div>
        </CardHeader>
        {isHandoff && (
          <CardContent className="pt-0">
            <div className="flex items-start gap-2 rounded-[6px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
              <div>
                <div className="font-semibold text-destructive">⚠️ Requiere humano</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {conv.handoff_reason ?? "El bot se ha pausado automáticamente. Retoma la conversación manualmente."}
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 2 columnas: datos del lead | resumen + hilo */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* IZQUIERDA: ficha de datos del lead */}
        <Card className="lg:col-span-5">
          <CardHeader>
            <Eyebrow>Datos del lead</Eyebrow>
            <CardTitle className="text-base">Identidad y vínculo con la propiedad</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <LeadCard
              current={conv}
              qual={qual}
              regenerateSummary={() => {}}
              setRol={setRol}
            />
          </CardContent>
        </Card>

        {/* DERECHA: resumen IA + hilo de mensajes */}
        <div className="space-y-4 lg:col-span-7">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <Eyebrow><FileText className="mr-1 inline h-3 w-3" /> Resumen IA</Eyebrow>
                <CardTitle className="text-base">Qué sabemos de este lead</CardTitle>
              </div>
              <Button size="sm" variant="outline" onClick={() => regenerateSummary(conv.id)}>
                <Sparkles className="h-3.5 w-3.5" /> Regenerar
              </Button>
            </CardHeader>
            <CardContent>
              {conv.summary ? (
                <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{conv.summary}</p>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  Todavía no hay resumen. Se genera cuando el bot propone llamada, salta el handoff, o se acumulan ≥6 mensajes nuevos.
                </p>
              )}
              {conv.summary_updated_at && (
                <div className="mt-2 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                  Actualizado: {new Date(conv.summary_updated_at).toLocaleString("es")}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Eyebrow>Hilo de mensajes</Eyebrow>
              <CardTitle className="text-base">Conversación ({(messages as any[]).length})</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[60vh] space-y-2 overflow-y-auto">
              {(messages as any[]).length === 0 && (
                <p className="text-sm text-muted-foreground">Sin mensajes aún.</p>
              )}
              {(messages as any[]).map((m: any) => {
                if (m.type === "system") {
                  return (
                    <div key={m.id} className="my-2 flex justify-center">
                      <div className="max-w-[85%] rounded-[6px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">
                        {m.content}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[78%] rounded-[6px] border px-3 py-2 text-sm",
                      m.direction === "out"
                        ? "border-gold/30 bg-gold/10 text-foreground"
                        : "border-border-faint bg-surface-1/60 text-foreground",
                    )}>
                      <MessageBody m={m} />
                      <div className="mt-1 flex items-center gap-2 font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
                        {new Date(m.created_at).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}
                        {m.ai_generated && <span className="text-gold">· bot</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
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
function IdentificadoEnBD({ contact }: { contact: any }) {
  const leadId: string | null = contact?.lead_id ?? null;
  const md = contact?.metadata ?? {};
  const status: string | undefined = md?.match_status;
  const ownerNombre: string | null = md?.matched_owner_nombre ?? null;
  const buildings: Array<{ building_id: string; direccion: string | null; cuota?: number | null }> =
    Array.isArray(md?.matched_buildings) ? md.matched_buildings : [];

  if (!leadId && status !== "ambiguous") return null;

  return (
    <section className="rounded-[6px] border border-gold/30 bg-gold/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <IdCard className="h-3 w-3 text-gold" />
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-gold/80">
          Identificado en BD
        </span>
      </div>
      {leadId ? (
        <>
          <Link
            to={`/propietarios/${leadId}`}
            className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
          >
            {ownerNombre ?? "Propietario"}
          </Link>
          {buildings.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                Edificios ({buildings.length})
              </div>
              <ul className="space-y-0.5">
                {buildings.slice(0, 5).map((b) => (
                  <li key={b.building_id} className="text-xs">
                    <Link
                      to={`/comercial/edificios/${b.building_id}`}
                      className="flex items-center gap-1 text-foreground/90 hover:text-gold"
                    >
                      <Building2 className="h-3 w-3" />
                      <span className="truncate">{b.direccion ?? b.building_id}</span>
                      {b.cuota != null && (
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                          {Math.round(Number(b.cuota))}%
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
                {buildings.length > 5 && (
                  <li className="text-[10px] text-muted-foreground">
                    +{buildings.length - 5} más
                  </li>
                )}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className="text-xs text-muted-foreground">
          Varios propietarios con este teléfono — revisar manualmente.
        </div>
      )}
    </section>
  );
}
