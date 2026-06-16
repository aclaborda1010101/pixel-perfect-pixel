import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, QrCode, Send, Bot, Phone, Power } from "lucide-react";

export default function WhatsappDashboard() {
  const qc = useQueryClient();
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
        .select("id, direction, content, created_at, ai_generated")
        .eq("conversation_id", selectedConv)
        .order("created_at", { ascending: true })
        .limit(200);
      return data ?? [];
    },
  });

  const { data: cfg } = useQuery({
    queryKey: ["wa:cfg"],
    queryFn: async () => {
      const { data } = await (supabase.from("wa_bot_config" as any) as any).select("*").limit(1).maybeSingle();
      return data;
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

  const stageCounts: Record<string, number> = ((conversations ?? []) as any[]).reduce((acc, c: any) => {
    const s = c.wa_contacts?.stage ?? "nuevo"; acc[s] = (acc[s] ?? 0) + 1; return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="WhatsApp · Bot"
        title="Panel de WhatsApp"
        subtitle={instance?.status === "connected" ? `Conectado · ${instance?.phone_number ?? "—"}` : "Conecta tu número para empezar a recibir leads"}
      />

      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="connection">Conexión</TabsTrigger>
          <TabsTrigger value="bot">Bot</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="mt-4">
          <div className="grid grid-cols-12 gap-4">
            <Card className="col-span-4 max-h-[70vh] overflow-y-auto">
              <CardHeader><CardTitle className="text-sm">Conversaciones · {conversations?.length ?? 0}</CardTitle></CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border-faint">
                  {(conversations ?? []).map((c: any) => (
                    <li key={c.id}
                        className={`cursor-pointer px-4 py-3 hover:bg-surface-1 ${selectedConv === c.id ? "bg-surface-1" : ""}`}
                        onClick={() => setSelectedConv(c.id)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{c.wa_contacts?.name ?? c.wa_contacts?.phone}</span>
                        {c.ai_enabled && <Bot className="h-3.5 w-3.5 text-gold" />}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                        {c.wa_contacts?.stage ?? "nuevo"} · {c.last_message_at ? new Date(c.last_message_at).toLocaleString("es") : "—"}
                      </div>
                    </li>
                  ))}
                  {(conversations ?? []).length === 0 && (
                    <li className="px-4 py-6 text-sm text-muted-foreground">Sin conversaciones aún.</li>
                  )}
                </ul>
              </CardContent>
            </Card>

            <Card className="col-span-8 flex max-h-[70vh] flex-col">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-sm">
                  {selectedConv ? (conversations as any)?.find((c: any) => c.id === selectedConv)?.wa_contacts?.name ?? (conversations as any)?.find((c: any) => c.id === selectedConv)?.wa_contacts?.phone : "Selecciona una conversación"}
                </CardTitle>
                {selectedConv && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Bot</span>
                    <Switch
                      checked={(conversations as any)?.find((c: any) => c.id === selectedConv)?.ai_enabled ?? true}
                      onCheckedChange={() => {
                        const cur = (conversations as any)?.find((c: any) => c.id === selectedConv);
                        if (cur) toggleAi(cur.id, cur.ai_enabled);
                      }}
                    />
                  </div>
                )}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col overflow-hidden p-0">
                <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
                  {(messages ?? []).map((m: any) => (
                    <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-[6px] px-3 py-2 text-sm ${m.direction === "out" ? "bg-gold/15 text-foreground" : "bg-surface-1 text-foreground"}`}>
                        {m.content}
                        {m.ai_generated && <span className="ml-1 text-[9px] uppercase text-gold">· bot</span>}
                      </div>
                    </div>
                  ))}
                </div>
                {selectedConv && (
                  <div className="flex gap-2 border-t border-border-faint p-3">
                    <Input value={draft} onChange={(e) => setDraft(e.target.value)}
                           onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}
                           placeholder="Escribe un mensaje…" />
                    <Button onClick={sendMessage} variant="gold"><Send className="h-4 w-4" /></Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="pipeline" className="mt-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {["nuevo","conversando","cualificado","caliente","cerrado"].map((s) => (
              <Card key={s}>
                <CardHeader><Eyebrow>{s}</Eyebrow><CardTitle className="text-lg">{stageCounts[s] ?? 0}</CardTitle></CardHeader>
                <CardContent className="space-y-2 p-3">
                  {(conversations ?? []).filter((c: any) => (c.wa_contacts?.stage ?? "nuevo") === s).slice(0, 10).map((c: any) => (
                    <div key={c.id} className="cursor-pointer rounded border border-border-faint p-2 text-xs hover:bg-surface-1"
                         onClick={() => setSelectedConv(c.id)}>
                      <div className="truncate font-medium">{c.wa_contacts?.name ?? c.wa_contacts?.phone}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="connection" className="mt-4">
          <Card className="max-w-xl">
            <CardHeader>
              <Eyebrow><Phone className="mr-1 inline h-3 w-3" /> Instancia · {instance?.instance_name ?? "—"}</Eyebrow>
              <CardTitle>Estado: <Badge variant={instance?.status === "connected" ? "default" : "outline"}>{instance?.status ?? "disconnected"}</Badge></CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {instance?.qr_base64 && instance?.status !== "connected" && (
                <div className="flex flex-col items-center gap-2">
                  <img src={instance.qr_base64} alt="QR WhatsApp" className="h-64 w-64 rounded border border-border-faint bg-white p-2" />
                  <p className="text-center text-xs text-muted-foreground">Abre WhatsApp → Dispositivos vinculados → Vincular un dispositivo</p>
                </div>
              )}
              {instance?.status === "connected" && (
                <p className="text-sm text-emerald-500">✓ Conectado al número {instance?.phone_number ?? "—"}</p>
              )}
              <div className="flex gap-2">
                <Button onClick={connect} variant="gold"><QrCode className="mr-1 h-4 w-4" /> Conectar / Refrescar QR</Button>
                <Button onClick={refreshStatus} variant="outline">{polling && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Estado</Button>
                {instance?.status === "connected" && (
                  <Button onClick={disconnect} variant="destructive"><Power className="mr-1 h-4 w-4" /> Desconectar</Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bot" className="mt-4">
          <Card className="max-w-3xl">
            <CardHeader>
              <Eyebrow><Bot className="mr-1 inline h-3 w-3" /> Configuración del bot</Eyebrow>
              <CardTitle>Persona y comportamiento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Persona</label>
                <Textarea defaultValue={cfg?.persona ?? ""} rows={5} onBlur={(e) => saveCfg({ persona: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Delay min (s)</label>
                  <Input type="number" defaultValue={cfg?.reply_delay_min ?? 4} onBlur={(e) => saveCfg({ reply_delay_min: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Delay max (s)</label>
                  <Input type="number" defaultValue={cfg?.reply_delay_max ?? 22} onBlur={(e) => saveCfg({ reply_delay_max: Number(e.target.value) })} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch defaultChecked={cfg?.is_active ?? true} onCheckedChange={(v) => saveCfg({ is_active: v })} />
                <span className="text-sm">Bot activo (responde automáticamente)</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}