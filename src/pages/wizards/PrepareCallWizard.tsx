import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { PreCallBrief } from "@/components/agents/PreCallBrief";
import { toast } from "sonner";

const STEPS = ["step1AssetOrOwner", "step2Owner", "step3Brief", "step4Start"] as const;

export default function PrepareCallWizard() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [q, setQ] = useState("");
  const [assets, setAssets] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [pickedAsset, setPickedAsset] = useState<any>(null);
  const [pickedOwner, setPickedOwner] = useState<any>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    supabase.from("assets").select("id, tipo, ubicacion, ciudad, owner_id").limit(50)
      .then(({ data }) => setAssets(data ?? []));
    supabase.from("owners").select("id, nombre, email, telefono, rol").limit(50)
      .then(({ data }) => setOwners(data ?? []));
  }, []);

  const filteredAssets = useMemo(
    () => assets.filter((a) => [a.tipo, a.ubicacion, a.ciudad].some((f) => (f ?? "").toLowerCase().includes(q.toLowerCase()))),
    [assets, q]);
  const filteredOwners = useMemo(
    () => owners.filter((o) => [o.nombre, o.email, o.telefono].some((f) => (f ?? "").toLowerCase().includes(q.toLowerCase()))),
    [owners, q]);

  const ownerForAsset = useMemo(
    () => owners.find((o) => o.id === pickedAsset?.owner_id) ?? null,
    [owners, pickedAsset]);

  const startCall = async () => {
    if (!pickedOwner) return;
    setCreating(true);
    const { data, error } = await supabase.from("calls").insert({
      owner_id: pickedOwner.id, direccion: "saliente", fecha: new Date().toISOString(),
    }).select().single();
    setCreating(false);
    if (error || !data) { toast.error(error?.message ?? "Error"); return; }
    toast.success(t.wizard.callMarkedStarted);
    nav(`/llamadas/${data.id}`);
  };

  const canNext = (step === 0 && (pickedAsset || pickedOwner)) || step > 0;
  const owner = pickedOwner ?? ownerForAsset;

  return (
    <div className="space-y-4">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> {t.common.back}
      </Link>
      <PageHeader
        title={t.wizard.prepareTitle}
        subtitle={`${t.common.step} ${step + 1} ${t.common.of} ${STEPS.length} · ${t.wizard[STEPS[step]]}`}
      />
      <Card>
        <CardContent className="space-y-4 p-6">
          {step === 0 && (
            <>
              <Input placeholder={t.wizard.pickAsset} value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs uppercase text-muted-foreground">Activos</div>
                  <ul className="max-h-64 divide-y divide-border overflow-auto rounded border border-border">
                    {filteredAssets.map((a) => (
                      <li key={a.id}>
                        <button onClick={() => { setPickedAsset(a); setPickedOwner(null); }}
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-accent/30 ${pickedAsset?.id === a.id ? "bg-accent/30" : ""}`}>
                          <div className="flex items-center justify-between">
                            <span>{a.tipo} · {a.ubicacion}</span>
                            {pickedAsset?.id === a.id && <Check className="h-3 w-3 text-primary" />}
                          </div>
                          <div className="text-xs text-muted-foreground">{a.ciudad ?? "—"}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="mb-1 text-xs uppercase text-muted-foreground">Propietarios</div>
                  <ul className="max-h-64 divide-y divide-border overflow-auto rounded border border-border">
                    {filteredOwners.map((o) => (
                      <li key={o.id}>
                        <button onClick={() => { setPickedOwner(o); setPickedAsset(null); }}
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-accent/30 ${pickedOwner?.id === o.id ? "bg-accent/30" : ""}`}>
                          <div className="flex items-center justify-between">
                            <span>{o.nombre}</span>
                            <Badge variant="outline" className="text-[10px]">{o.rol}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">{o.email ?? o.telefono ?? "—"}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}

          {step === 1 && (
            <div>
              {owner ? (
                <div className="rounded border border-border p-4">
                  <div className="text-base font-semibold">{owner.nombre}</div>
                  <div className="text-sm text-muted-foreground">{owner.email ?? owner.telefono ?? "—"}</div>
                  <Badge variant="outline" className="mt-2">{owner.rol}</Badge>
                  {pickedAsset && (
                    <div className="mt-3 text-xs text-muted-foreground">
                      Activo: {pickedAsset.tipo} · {pickedAsset.ubicacion}
                    </div>
                  )}
                </div>
              ) : <div className="text-sm text-muted-foreground">{t.wizard.noOwnersForAsset}</div>}
            </div>
          )}

          {step === 2 && owner && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t.wizard.reusePreCall}</p>
              <PreCallBrief ownerId={owner.id} />
            </div>
          )}

          {step === 3 && owner && (
            <div className="space-y-4">
              <div className="rounded border border-border p-4 text-sm">
                Estás a punto de iniciar una llamada con <b>{owner.nombre}</b>.
                Se creará un registro en Llamadas en estado <i>por analizar</i>; cuando termines podrás
                pegar la transcripción y obtener el resumen IA.
              </div>
              <Button onClick={startCall} disabled={creating} className="w-full">
                {creating ? t.wizard.processing : `📞 ${t.wizard.callMarkedStarted}`}
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-4">
            <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              <ArrowLeft className="mr-2 h-3 w-3" /> {t.common.prev}
            </Button>
            {step < STEPS.length - 1 && (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
                {t.common.next} <ArrowRight className="ml-2 h-3 w-3" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
