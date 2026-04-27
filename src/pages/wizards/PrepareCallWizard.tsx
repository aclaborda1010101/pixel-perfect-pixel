import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Check, PhoneOutgoing } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Stepper } from "@/components/common/Stepper";
import { Eyebrow } from "@/components/common/Eyebrow";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { PreCallBrief } from "@/components/agents/PreCallBrief";
import { toast } from "sonner";
import { SUBROLE_LABEL } from "@/components/forms/NewEntityDialogs";

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
  const [buildingOwners, setBuildingOwners] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("assets").select("id, tipo, ubicacion, ciudad, owner_id, building_id").limit(50)
      .then(({ data }) => setAssets(data ?? []));
    supabase.from("owners").select("id, nombre, email, telefono, rol").limit(50)
      .then(({ data }) => setOwners(data ?? []));
  }, []);

  useEffect(() => {
    if (!pickedAsset?.building_id) { setBuildingOwners([]); return; }
    supabase.from("building_owners")
      .select("owner_id, cuota, subrole, owners:owner_id(id, nombre, rol, email, telefono)")
      .eq("building_id", pickedAsset.building_id)
      .then(({ data }) => setBuildingOwners(data ?? []));
  }, [pickedAsset]);

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
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> {t.common.back}
      </Link>
      <PageHeader
        eyebrow="Wizard · Preparar llamada"
        title={t.wizard.prepareTitle}
        subtitle={t.wizard[STEPS[step]]}
      />

      <Stepper steps={STEPS.map((s) => t.wizard[s])} current={step} />

      <Card>
        <CardContent className="space-y-4 p-6">
          {step === 0 && (
            <>
              <Input placeholder={t.wizard.pickAsset} value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Eyebrow className="mb-1.5">Activos</Eyebrow>
                  <ul className="max-h-64 divide-y divide-border-faint overflow-auto rounded-[6px] border border-border-faint">
                    {filteredAssets.map((a) => (
                      <li key={a.id}>
                        <button onClick={() => { setPickedAsset(a); setPickedOwner(null); }}
                          className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-1/40 ${pickedAsset?.id === a.id ? "bg-surface-1/60 border-l-2 border-gold" : ""}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-foreground">{a.tipo} · {a.ubicacion}</span>
                            {pickedAsset?.id === a.id && <Check className="h-3 w-3 text-gold" />}
                          </div>
                          <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{a.ciudad ?? "—"}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <Eyebrow className="mb-1.5">Propietarios</Eyebrow>
                  <ul className="max-h-64 divide-y divide-border-faint overflow-auto rounded-[6px] border border-border-faint">
                    {filteredOwners.map((o) => (
                      <li key={o.id}>
                        <button onClick={() => { setPickedOwner(o); setPickedAsset(null); }}
                          className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-1/40 ${pickedOwner?.id === o.id ? "bg-surface-1/60 border-l-2 border-gold" : ""}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-foreground">{o.nombre}</span>
                            <Badge variant="outline">{o.rol}</Badge>
                          </div>
                          <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{o.email ?? o.telefono ?? "—"}</div>
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
              {pickedAsset && buildingOwners.length > 0 ? (
                <div className="space-y-2">
                  <Eyebrow>Propietarios del edificio ({buildingOwners.length}) · elige con quién hablas</Eyebrow>
                  <ul className="divide-y divide-border-faint rounded-[6px] border border-border-faint">
                    {buildingOwners.map((r: any) => {
                      const isPicked = pickedOwner?.id === r.owner_id;
                      return (
                        <li key={r.owner_id}>
                          <button onClick={() => setPickedOwner(r.owners)}
                            className={`w-full px-3 py-2 text-left transition-colors hover:bg-surface-1/40 ${isPicked ? "bg-surface-1/60 border-l-2 border-gold" : ""}`}>
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-sm font-medium text-foreground">{r.owners?.nombre}</div>
                                <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{r.owners?.email ?? r.owners?.telefono ?? "—"}</div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {r.cuota != null && <Badge variant="gold">{r.cuota}%</Badge>}
                                <Badge variant="outline">{SUBROLE_LABEL[r.subrole] ?? r.subrole}</Badge>
                                {r.owners?.rol && <Badge variant="info">{r.owners.rol}</Badge>}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : owner ? (
                <div className="rounded-[6px] border border-border-faint bg-surface-1/30 p-4">
                  <Eyebrow>Propietario seleccionado</Eyebrow>
                  <div className="mt-1 font-editorial text-lg tracking-notarial text-foreground">{owner.nombre}</div>
                  <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{owner.email ?? owner.telefono ?? "—"}</div>
                  <Badge variant="info" className="mt-2">{owner.rol}</Badge>
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
              <div className="rounded-[6px] border border-gold/40 bg-gold-soft/30 p-4 text-sm text-foreground">
                Estás a punto de iniciar una llamada con <b>{owner.nombre}</b>.
                Se creará un registro en Llamadas en estado <i>por analizar</i>; cuando termines podrás
                pegar la transcripción y obtener el resumen IA.
              </div>
              <Button onClick={startCall} disabled={creating} variant="gold" className="w-full">
                <PhoneOutgoing className="h-4 w-4" />
                {creating ? t.wizard.processing : t.wizard.callMarkedStarted}
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border-faint pt-4">
            <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              <ArrowLeft className="h-3 w-3" /> {t.common.prev}
            </Button>
            {step < STEPS.length - 1 && (
              <Button variant="gold" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
                {t.common.next} <ArrowRight className="h-3 w-3" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
