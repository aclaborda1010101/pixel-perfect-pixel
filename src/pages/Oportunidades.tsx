import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import { PageHeader } from "@/components/common/PageHeader";
import { FichaLead } from "@/pages/whatsapp/WhatsappDashboard";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, UserCircle, MapPin, MessagesSquare, Trash2, RotateCcw } from "lucide-react";

type Zone = { email: string; name: string; terms: string[] };
type ZoneConfig = { default_owner_email: string; zones: Zone[] };
type Row = {
  conversation_id: string;
  contact_id: string;
  phone: string;
  name: string | null;
  stage: string;
  summary: string | null;
  qualification: Record<string, any> | null;
  last_message_at: string | null;
  assigned_email: string | null;
  assigned_name: string;
  assignment_source: "manual" | "auto";
  discarded_at: string | null;
};

function guessZone(qual: Record<string, any> | null, name: string | null, summary: string | null, cfg: ZoneConfig): { email: string; name: string } {
  const hay = [
    qual?.direccion_inmueble, qual?.codigo_postal, qual?.zona, name, summary,
  ].filter(Boolean).join(" ").toLowerCase();
  for (const z of cfg.zones) {
    if (z.terms.some((t) => t && hay.includes(String(t).toLowerCase()))) {
      return { email: z.email, name: z.name };
    }
  }
  return { email: cfg.default_owner_email, name: "Sin asignar" };
}

const DEFAULT_CFG: ZoneConfig = {
  default_owner_email: "jesus.anzola@afflux.es",
  zones: [
    { email: "david.casero@afflux.es", name: "David", terms: ["vallecas", "carabanchel", "chamberí", "chamberi"] },
    { email: "jesus.anzola@afflux.es", name: "Jesús", terms: ["salamanca", "centro"] },
  ],
};

const ZONE_PEOPLE: { email: string; name: string }[] = [
  { email: "jesus.anzola@afflux.es", name: "Jesús" },
  { email: "david.casero@afflux.es", name: "David" },
];

function nameForEmail(email: string | null, cfg: ZoneConfig): string {
  if (!email) return "Sin asignar";
  const z = cfg.zones.find((x) => x.email === email);
  if (z) return z.name;
  const p = ZONE_PEOPLE.find((x) => x.email === email);
  return p?.name ?? email.split("@")[0];
}

export default function Oportunidades() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [cfg, setCfg] = useState<ZoneConfig>(DEFAULT_CFG);
  const [tab, setTab] = useState<"todos" | "sin_asignar" | "jesus" | "david" | "descartadas">("todos");
  const [selected, setSelected] = useState<Row | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState<Row | null>(null);

  async function load() {
    setLoading(true);
    const sb: any = supabase;
    const { data: setting } = await sb.from("app_settings").select("value")
      .eq("key", "oportunidades_zone_assignments").maybeSingle();
    const zcfg: ZoneConfig = setting?.value ?? DEFAULT_CFG;
    setCfg(zcfg);

    const { data: convs, error } = await sb.from("wa_conversations")
      .select("id, contact_id, summary, qualification, last_message_at, assigned_email, assigned_name, assignment_source, discarded_at, wa_contacts(phone, name, stage)")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) { toast.error(`No se pudieron cargar los leads: ${error.message}`); setLoading(false); return; }

    const list: Row[] = (convs as any[] ?? []).map((c) => {
      const manual = !!c.assigned_email && c.assignment_source === "manual";
      const auto = manual
        ? { email: c.assigned_email as string, name: c.assigned_name ?? nameForEmail(c.assigned_email, zcfg) }
        : guessZone(c.qualification, c.wa_contacts?.name, c.summary, zcfg);
      return {
        conversation_id: c.id,
        contact_id: c.contact_id,
        phone: c.wa_contacts?.phone ?? "",
        name: c.wa_contacts?.name ?? null,
        stage: c.wa_contacts?.stage ?? "conversando",
        summary: c.summary ?? null,
        qualification: c.qualification ?? null,
        last_message_at: c.last_message_at,
        assigned_email: auto.email ?? null,
        assigned_name: auto.name,
        assignment_source: manual ? "manual" : "auto",
        discarded_at: c.discarded_at ?? null,
      };
    });
    setRows(list);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function assignTo(row: Row, person: { email: string; name: string } | null) {
    const sb: any = supabase;
    const payload = person
      ? { assigned_email: person.email, assigned_name: person.name, assignment_source: "manual", assigned_at: new Date().toISOString() }
      : { assigned_email: null, assigned_name: null, assignment_source: null, assigned_at: null };
    const { error } = await sb.from("wa_conversations").update(payload).eq("id", row.conversation_id);
    if (error) { toast.error(error.message); return; }
    toast.success(person ? `Asignado a ${person.name}` : "Asignación borrada");
    await load();
  }

  async function discard(row: Row) {
    const sb: any = supabase;
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await sb.from("wa_conversations").update({
      discarded_at: new Date().toISOString(),
      discarded_by: userData.user?.id ?? null,
    }).eq("id", row.conversation_id);
    if (error) { toast.error(error.message); return; }
    toast.success("Lead descartado (histórico conservado)");
    if (selected?.conversation_id === row.conversation_id) setSelected(null);
    await load();
  }

  async function restore(row: Row) {
    const sb: any = supabase;
    const { error } = await sb.from("wa_conversations").update({
      discarded_at: null, discarded_by: null, discard_reason: null,
    }).eq("id", row.conversation_id);
    if (error) { toast.error(error.message); return; }
    toast.success("Lead restaurado");
    await load();
  }

  useEffect(() => {
    (async () => {
      if (!selected) { setMessages([]); return; }
      const { data } = await supabase.from("wa_messages" as any)
        .select("id, direction, content, created_at, sender_type, type")
        .eq("conversation_id", selected.conversation_id)
        .order("created_at", { ascending: false }).limit(200);
      setMessages(((data as any[]) ?? []).reverse());
    })();
  }, [selected]);

  const active = useMemo(() => rows.filter((r) => !r.discarded_at), [rows]);
  const discarded = useMemo(() => rows.filter((r) => !!r.discarded_at), [rows]);
  const filtered = useMemo(() => {
    if (tab === "descartadas") return discarded;
    if (tab === "todos") return active;
    if (tab === "sin_asignar") return active.filter((r) => r.assigned_name === "Sin asignar");
    if (tab === "jesus") return active.filter((r) => r.assigned_name === "Jesús");
    if (tab === "david") return active.filter((r) => r.assigned_name === "David");
    return active;
  }, [rows, tab, active, discarded]);

  const counts = useMemo(() => ({
    todos: active.length,
    sin_asignar: active.filter((r) => r.assigned_name === "Sin asignar").length,
    jesus: active.filter((r) => r.assigned_name === "Jesús").length,
    david: active.filter((r) => r.assigned_name === "David").length,
    descartadas: discarded.length,
  }), [active, discarded]);

  return (
    <div className="space-y-6">
      <PageHeader title="Oportunidades" subtitle="Leads cualificados por el bot con ficha de datos extraídos" />

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="todos">Todos <Badge variant="secondary" className="ml-2">{counts.todos}</Badge></TabsTrigger>
          <TabsTrigger value="sin_asignar">Sin asignar <Badge variant="secondary" className="ml-2">{counts.sin_asignar}</Badge></TabsTrigger>
          <TabsTrigger value="jesus">Jesús <Badge variant="secondary" className="ml-2">{counts.jesus}</Badge></TabsTrigger>
          <TabsTrigger value="david">David <Badge variant="secondary" className="ml-2">{counts.david}</Badge></TabsTrigger>
          <TabsTrigger value="descartadas">Descartadas <Badge variant="secondary" className="ml-2">{counts.descartadas}</Badge></TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <Card>
              <CardHeader className="pb-2">
                <Eyebrow>Leads</Eyebrow>
                <CardTitle className="text-base">
                  {loading ? <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />cargando…</> : `${filtered.length} lead(s)`}
                </CardTitle>
              </CardHeader>
              <CardContent className="max-h-[70vh] overflow-y-auto p-2">
                {filtered.map((r) => (
                  <div
                    key={r.conversation_id}
                    className={`mb-2 rounded-[6px] border p-3 transition hover:border-gold ${
                      selected?.conversation_id === r.conversation_id ? "border-gold bg-gold/5" : "border-border-faint"
                    }`}
                  >
                    <button onClick={() => setSelected(r)} className="w-full text-left">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <UserCircle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">{r.name || r.phone}</span>
                        </div>
                        <Badge variant={r.assignment_source === "manual" ? "default" : "outline"} className="text-[10px]">
                          {r.assigned_name}{r.assignment_source === "manual" ? " · manual" : ""}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{r.phone || "sin teléfono"}</span>
                        <span>·</span>
                        <span className="capitalize">{r.stage}</span>
                        {r.qualification?.codigo_postal && (
                          <><span>·</span><span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{r.qualification.codigo_postal}</span></>
                        )}
                      </div>
                      {r.summary ? (
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.summary}</div>
                      ) : (
                        <div className="mt-1 text-xs italic text-muted-foreground/70">Sin cualificar aún</div>
                      )}
                    </button>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {r.discarded_at ? (
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => restore(r)}>
                          <RotateCcw className="mr-1 h-3 w-3" /> Restaurar
                        </Button>
                      ) : (
                        <>
                          {ZONE_PEOPLE.map((p) => (
                            <Button
                              key={p.email} size="sm"
                              variant={r.assigned_email === p.email ? "default" : "outline"}
                              className="h-7 text-[11px]"
                              onClick={(e) => { e.stopPropagation(); assignTo(r, p); }}
                            >
                              {r.assigned_email === p.email ? `✓ ${p.name}` : p.name}
                            </Button>
                          ))}
                          {r.assignment_source === "manual" && (
                            <Button size="sm" variant="ghost" className="h-7 text-[11px]"
                              onClick={(e) => { e.stopPropagation(); assignTo(r, null); }}>
                              Quitar
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="ml-auto h-7 text-[11px] text-destructive hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setConfirmDiscard(r); }}>
                            <Trash2 className="mr-1 h-3 w-3" /> Descartar
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {filtered.length === 0 && !loading && (
                  <div className="p-6 text-center text-sm text-muted-foreground">Sin leads en esta pestaña.</div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-3">
              {selected ? (
                <>
                  <Card>
                    <CardHeader>
                      <Eyebrow>Ficha del lead</Eyebrow>
                      <CardTitle className="flex items-center justify-between text-base">
                        <span>{selected.name || selected.phone}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{selected.assigned_name}</Badge>
                          <Button asChild size="sm" variant="ghost">
                            <a href={`/whatsapp?c=${selected.conversation_id}`}>
                              <MessagesSquare className="mr-1 h-3.5 w-3.5" /> Abrir chat
                            </a>
                          </Button>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <FichaLead
                        qual={selected.qualification ?? {}}
                        current={{ wa_contacts: { stage: selected.stage } }}
                        messages={messages}
                      />
                      {selected.summary && (
                        <div className="mt-3 rounded-[6px] border border-border-faint bg-muted/30 p-3">
                          <div className="mb-1 text-[10px] font-mono uppercase tracking-eyebrow text-muted-foreground">Resumen del bot</div>
                          <div className="whitespace-pre-wrap text-sm">{selected.summary}</div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardContent className="p-10 text-center text-sm text-muted-foreground">
                    Selecciona un lead para ver su ficha.
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!confirmDiscard} onOpenChange={(o) => !o && setConfirmDiscard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar este lead?</AlertDialogTitle>
            <AlertDialogDescription>
              Desaparecerá de Oportunidades, pero la conversación y sus mensajes se conservan en WhatsApp.
              Puedes recuperarlo desde la pestaña "Descartadas".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmDiscard) discard(confirmDiscard); setConfirmDiscard(null); }}>
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}