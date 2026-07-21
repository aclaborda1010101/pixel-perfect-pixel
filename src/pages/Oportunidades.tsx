import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import { PageHeader } from "@/components/common/PageHeader";
import { FichaLead } from "@/pages/whatsapp/WhatsappDashboard";
import { Loader2, UserCircle, MapPin, MessagesSquare } from "lucide-react";

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

export default function Oportunidades() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [cfg, setCfg] = useState<ZoneConfig>(DEFAULT_CFG);
  const [tab, setTab] = useState<"todos" | "sin_asignar" | "jesus" | "david">("todos");
  const [selected, setSelected] = useState<Row | null>(null);
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // 1) config zonal
      const { data: setting } = await supabase.from("app_settings" as any).select("value")
        .eq("key", "oportunidades_zone_assignments").maybeSingle();
      const zcfg = (setting as any)?.value ?? DEFAULT_CFG;
      setCfg(zcfg);

      // 2) conversaciones candidatas a oportunidad
      const sb: any = supabase;
      const { data: convs } = await sb.from("wa_conversations")
        .select("id, contact_id, summary, qualification, last_message_at, wa_contacts(phone, name, stage)")
        .order("last_message_at", { ascending: false })
        .limit(200);

      const list: Row[] = (convs as any[] ?? [])
        .filter((c) => c.wa_contacts)
        .map((c) => {
          const z = guessZone(c.qualification, c.wa_contacts?.name, c.summary, zcfg);
          return {
            conversation_id: c.id,
            contact_id: c.contact_id,
            phone: c.wa_contacts?.phone ?? "",
            name: c.wa_contacts?.name ?? null,
            stage: c.wa_contacts?.stage ?? "conversando",
            summary: c.summary ?? null,
            qualification: c.qualification ?? null,
            last_message_at: c.last_message_at,
            assigned_email: z.email,
            assigned_name: z.name,
          };
        });
      setRows(list);
      setLoading(false);
    })();
  }, []);

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

  const filtered = useMemo(() => {
    if (tab === "todos") return rows;
    if (tab === "sin_asignar") return rows.filter((r) => r.assigned_name === "Sin asignar");
    return rows.filter((r) => r.assigned_name.toLowerCase() === tab);
  }, [rows, tab]);

  const counts = useMemo(() => ({
    todos: rows.length,
    sin_asignar: rows.filter((r) => r.assigned_name === "Sin asignar").length,
    jesus: rows.filter((r) => r.assigned_name === "Jesús").length,
    david: rows.filter((r) => r.assigned_name === "David").length,
  }), [rows]);

  return (
    <div className="space-y-6">
      <PageHeader title="Oportunidades" subtitle="Leads cualificados por el bot con ficha de datos extraídos" />

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="todos">Todos <Badge variant="secondary" className="ml-2">{counts.todos}</Badge></TabsTrigger>
          <TabsTrigger value="sin_asignar">Sin asignar <Badge variant="secondary" className="ml-2">{counts.sin_asignar}</Badge></TabsTrigger>
          <TabsTrigger value="jesus">Jesús <Badge variant="secondary" className="ml-2">{counts.jesus}</Badge></TabsTrigger>
          <TabsTrigger value="david">David <Badge variant="secondary" className="ml-2">{counts.david}</Badge></TabsTrigger>
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
                  <button
                    key={r.conversation_id}
                    onClick={() => setSelected(r)}
                    className={`mb-2 w-full rounded-[6px] border p-3 text-left transition hover:border-gold ${
                      selected?.conversation_id === r.conversation_id ? "border-gold bg-gold/5" : "border-border-faint"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <UserCircle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{r.name || r.phone}</span>
                      </div>
                      <Badge variant="outline" className="text-[10px]">{r.assigned_name}</Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{r.phone}</span>
                      <span>·</span>
                      <span className="capitalize">{r.stage}</span>
                      {r.qualification?.codigo_postal && (
                        <><span>·</span><span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{r.qualification.codigo_postal}</span></>
                      )}
                    </div>
                    {r.summary && (
                      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.summary}</div>
                    )}
                  </button>
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
    </div>
  );
}