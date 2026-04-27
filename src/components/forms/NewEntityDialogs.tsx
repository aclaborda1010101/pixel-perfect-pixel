import { useState, type ReactNode } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const OWNER_ROLES = ["particular","heredero","inversor_pasivo","operador_profesional","institucional","desconocido"] as const;
export const OWNER_SUBROLES = ["ninguno","heredero_operador","heredero_residente","heredero_ausente","heredero_conflictivo","arrendador","usufructuario","nudo_propietario","apoderado"] as const;
const ASSET_TYPES = ["vivienda","local","edificio","suelo","oficina","industrial","otro"] as const;
const ASSET_STATES = ["prospecto","en_estudio","listo_para_matching","en_negociacion","cerrado","descartado"] as const;
const BUILDING_STATES = ["identificado","contactado","en_estudio","descartado"] as const;

export const SUBROLE_LABEL: Record<string, string> = {
  ninguno: "—",
  heredero_operador: "Heredero · operador",
  heredero_residente: "Heredero · residente",
  heredero_ausente: "Heredero · ausente",
  heredero_conflictivo: "Heredero · conflictivo",
  arrendador: "Arrendador",
  usufructuario: "Usufructuario",
  nudo_propietario: "Nudo propietario",
  apoderado: "Apoderado",
};

function Shell({
  trigger, title, open, setOpen, children, onSubmit, submitting,
}: {
  trigger: ReactNode; title: string; open: boolean; setOpen: (v: boolean) => void;
  children: ReactNode; onSubmit: () => void; submitting: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={onSubmit} disabled={submitting}>{submitting ? "Guardando…" : "Crear"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultTrigger(label: string) {
  return <Button size="sm"><Plus className="mr-1 h-3 w-3" /> {label}</Button>;
}

/* ========== OWNER ========== */
export function NewOwnerDialog({ onCreated, trigger }: { onCreated?: (id: string) => void; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(false);
  const [f, setF] = useState({ nombre: "", email: "", telefono: "", rol: "desconocido", subrole: "ninguno", consentimiento: false, notas_breves: "" });

  const submit = async () => {
    if (!f.nombre.trim()) return toast.error("El nombre es obligatorio");
    setS(true);
    const { data, error } = await supabase.from("owners").insert({
      nombre: f.nombre.trim(),
      email: f.email || null,
      telefono: f.telefono || null,
      rol: f.rol as any,
      subrole: f.subrole as any,
      consentimiento: f.consentimiento,
      notas_breves: f.notas_breves || null,
    }).select("id").single();
    setS(false);
    if (error) return toast.error(error.message);
    toast.success("Propietario creado");
    setOpen(false);
    setF({ nombre: "", email: "", telefono: "", rol: "desconocido", subrole: "ninguno", consentimiento: false, notas_breves: "" });
    onCreated?.(data!.id);
  };

  return (
    <Shell trigger={trigger ?? defaultTrigger("Nuevo propietario")} title="Nuevo propietario" open={open} setOpen={setOpen} onSubmit={submit} submitting={s}>
      <div><Label>Nombre *</Label><Input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} autoFocus /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Email</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><Label>Teléfono</Label><Input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Rol</Label>
          <Select value={f.rol} onValueChange={(v) => setF({ ...f, rol: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{OWNER_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Sub-rol</Label>
          <Select value={f.subrole} onValueChange={(v) => setF({ ...f, subrole: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{OWNER_SUBROLES.map((r) => <SelectItem key={r} value={r}>{SUBROLE_LABEL[r]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div><Label>Notas breves</Label><Textarea rows={2} value={f.notas_breves} onChange={(e) => setF({ ...f, notas_breves: e.target.value })} /></div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={f.consentimiento} onCheckedChange={(v) => setF({ ...f, consentimiento: !!v })} />
        Consentimiento de contacto
      </label>
    </Shell>
  );
}

/* ========== BUILDING ========== */
export function NewBuildingDialog({ onCreated, trigger }: { onCreated?: (id: string) => void; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(false);
  const [f, setF] = useState({ direccion: "", ciudad: "", codigo_postal: "", division_horizontal: false, numero_propietarios: "", estado: "identificado", notas: "" });

  const submit = async () => {
    if (!f.direccion.trim() || !f.ciudad.trim()) return toast.error("Dirección y ciudad son obligatorios");
    setS(true);
    const { data, error } = await supabase.from("buildings").insert({
      direccion: f.direccion.trim(),
      ciudad: f.ciudad.trim(),
      codigo_postal: f.codigo_postal || null,
      division_horizontal: f.division_horizontal,
      numero_propietarios: f.numero_propietarios ? Number(f.numero_propietarios) : null,
      estado: f.estado as any,
      notas: f.notas || null,
    }).select("id").single();
    setS(false);
    if (error) return toast.error(error.message);
    toast.success("Edificio creado");
    setOpen(false);
    setF({ direccion: "", ciudad: "", codigo_postal: "", division_horizontal: false, numero_propietarios: "", estado: "identificado", notas: "" });
    onCreated?.(data!.id);
  };

  return (
    <Shell trigger={trigger ?? defaultTrigger("Nuevo edificio")} title="Nuevo edificio" open={open} setOpen={setOpen} onSubmit={submit} submitting={s}>
      <div><Label>Dirección *</Label><Input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} autoFocus /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Ciudad *</Label><Input value={f.ciudad} onChange={(e) => setF({ ...f, ciudad: e.target.value })} /></div>
        <div><Label>Código postal</Label><Input value={f.codigo_postal} onChange={(e) => setF({ ...f, codigo_postal: e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Nº propietarios (estimado)</Label><Input type="number" value={f.numero_propietarios} onChange={(e) => setF({ ...f, numero_propietarios: e.target.value })} /></div>
        <div>
          <Label>Estado</Label>
          <Select value={f.estado} onValueChange={(v) => setF({ ...f, estado: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{BUILDING_STATES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={f.division_horizontal} onCheckedChange={(v) => setF({ ...f, division_horizontal: !!v })} />
        División horizontal
      </label>
      <div><Label>Notas</Label><Textarea rows={2} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></div>
    </Shell>
  );
}

/* ========== INVESTOR ========== */
export function NewInvestorDialog({ onCreated, trigger }: { onCreated?: (id: string) => void; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(false);
  const [f, setF] = useState({ nombre: "", email: "", telefono: "", ticket_min: "", ticket_max: "", ciudades: "", tipos_activo: [] as string[], consentimiento: false, notas: "" });

  const toggleTipo = (t: string) =>
    setF((p) => ({ ...p, tipos_activo: p.tipos_activo.includes(t) ? p.tipos_activo.filter((x) => x !== t) : [...p.tipos_activo, t] }));

  const submit = async () => {
    if (!f.nombre.trim()) return toast.error("El nombre es obligatorio");
    setS(true);
    const { data, error } = await supabase.from("investors").insert({
      nombre: f.nombre.trim(),
      email: f.email || null,
      telefono: f.telefono || null,
      ticket_min: f.ticket_min ? Number(f.ticket_min) : null,
      ticket_max: f.ticket_max ? Number(f.ticket_max) : null,
      ciudades: f.ciudades.split(",").map((s) => s.trim()).filter(Boolean),
      tipos_activo: f.tipos_activo as any,
      consentimiento: f.consentimiento,
      notas: f.notas || null,
    }).select("id").single();
    setS(false);
    if (error) return toast.error(error.message);
    toast.success("Inversor creado");
    setOpen(false);
    setF({ nombre: "", email: "", telefono: "", ticket_min: "", ticket_max: "", ciudades: "", tipos_activo: [], consentimiento: false, notas: "" });
    onCreated?.(data!.id);
  };

  return (
    <Shell trigger={trigger ?? defaultTrigger("Nuevo inversor")} title="Nuevo inversor" open={open} setOpen={setOpen} onSubmit={submit} submitting={s}>
      <div><Label>Nombre *</Label><Input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} autoFocus /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Email</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><Label>Teléfono</Label><Input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Ticket mín (€)</Label><Input type="number" value={f.ticket_min} onChange={(e) => setF({ ...f, ticket_min: e.target.value })} /></div>
        <div><Label>Ticket máx (€)</Label><Input type="number" value={f.ticket_max} onChange={(e) => setF({ ...f, ticket_max: e.target.value })} /></div>
      </div>
      <div><Label>Ciudades (coma)</Label><Input placeholder="Madrid, Barcelona" value={f.ciudades} onChange={(e) => setF({ ...f, ciudades: e.target.value })} /></div>
      <div>
        <Label>Tipos de activo</Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {ASSET_TYPES.map((t) => (
            <button key={t} type="button" onClick={() => toggleTipo(t)}
              className={`rounded border px-2 py-0.5 text-xs ${f.tipos_activo.includes(t) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent/30"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={f.consentimiento} onCheckedChange={(v) => setF({ ...f, consentimiento: !!v })} />
        Consentimiento
      </label>
      <div><Label>Notas</Label><Textarea rows={2} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></div>
    </Shell>
  );
}

/* ========== ASSET ========== */
export function NewAssetDialog({ onCreated, trigger, defaultBuildingId }: { onCreated?: (id: string) => void; trigger?: ReactNode; defaultBuildingId?: string }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(false);
  const [buildings, setBuildings] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [f, setF] = useState({ tipo: "vivienda", ubicacion: "", ciudad: "", superficie_m2: "", building_id: defaultBuildingId ?? "", owner_id: "", estado: "prospecto", descripcion: "" });

  const loadOpts = async () => {
    const [b, o] = await Promise.all([
      supabase.from("buildings").select("id, direccion, ciudad").order("updated_at", { ascending: false }).limit(100),
      supabase.from("owners").select("id, nombre").order("updated_at", { ascending: false }).limit(200),
    ]);
    setBuildings(b.data ?? []); setOwners(o.data ?? []);
  };

  const submit = async () => {
    if (!f.ubicacion.trim()) return toast.error("La ubicación es obligatoria");
    setS(true);
    const { data, error } = await supabase.from("assets").insert({
      tipo: f.tipo as any,
      ubicacion: f.ubicacion.trim(),
      ciudad: f.ciudad || null,
      superficie_m2: f.superficie_m2 ? Number(f.superficie_m2) : null,
      building_id: f.building_id || null,
      owner_id: f.owner_id || null,
      estado: f.estado as any,
      descripcion: f.descripcion || null,
    }).select("id").single();
    setS(false);
    if (error) return toast.error(error.message);
    toast.success("Activo creado");
    setOpen(false);
    setF({ tipo: "vivienda", ubicacion: "", ciudad: "", superficie_m2: "", building_id: defaultBuildingId ?? "", owner_id: "", estado: "prospecto", descripcion: "" });
    onCreated?.(data!.id);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) loadOpts(); }}>
      <DialogTrigger asChild>{trigger ?? defaultTrigger("Nuevo activo")}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nuevo activo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Tipo</Label>
              <Select value={f.tipo} onValueChange={(v) => setF({ ...f, tipo: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ASSET_TYPES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Estado</Label>
              <Select value={f.estado} onValueChange={(v) => setF({ ...f, estado: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ASSET_STATES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Ubicación *</Label><Input value={f.ubicacion} onChange={(e) => setF({ ...f, ubicacion: e.target.value })} autoFocus /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Ciudad</Label><Input value={f.ciudad} onChange={(e) => setF({ ...f, ciudad: e.target.value })} /></div>
            <div><Label>Superficie (m²)</Label><Input type="number" value={f.superficie_m2} onChange={(e) => setF({ ...f, superficie_m2: e.target.value })} /></div>
          </div>
          <div>
            <Label>Edificio</Label>
            <Select value={f.building_id || "__none__"} onValueChange={(v) => setF({ ...f, building_id: v === "__none__" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Sin edificio" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— sin edificio —</SelectItem>
                {buildings.map((b) => <SelectItem key={b.id} value={b.id}>{b.direccion} ({b.ciudad})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Propietario principal</Label>
            <Select value={f.owner_id || "__none__"} onValueChange={(v) => setF({ ...f, owner_id: v === "__none__" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Sin propietario" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— sin propietario —</SelectItem>
                {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Descripción</Label><Textarea rows={2} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={s}>{s ? "Guardando…" : "Crear"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ========== ADD OWNER TO BUILDING ========== */
export function AddOwnerToBuildingDialog({ buildingId, existingOwnerIds, onAdded }: { buildingId: string; existingOwnerIds: string[]; onAdded?: () => void }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(false);
  const [owners, setOwners] = useState<any[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [subrole, setSubrole] = useState("ninguno");
  const [cuota, setCuota] = useState("");
  const [notas, setNotas] = useState("");

  const load = async () => {
    const { data } = await supabase.from("owners").select("id, nombre, rol").order("nombre");
    setOwners((data ?? []).filter((o) => !existingOwnerIds.includes(o.id)));
  };

  const submit = async () => {
    if (!ownerId) return toast.error("Selecciona un propietario");
    setS(true);
    const { error } = await supabase.from("building_owners").insert({
      building_id: buildingId, owner_id: ownerId,
      subrole: subrole as any,
      cuota: cuota ? Number(cuota) : null,
      rol_notas: notas || null,
    });
    setS(false);
    if (error) return toast.error(error.message);
    toast.success("Propietario añadido");
    setOpen(false); setOwnerId(""); setSubrole("ninguno"); setCuota(""); setNotas("");
    onAdded?.();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) load(); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="mr-1 h-3 w-3" /> Añadir propietario</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Añadir propietario al edificio</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Propietario</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger><SelectValue placeholder="Selecciona…" /></SelectTrigger>
              <SelectContent>
                {owners.length === 0 && <div className="p-3 text-xs text-muted-foreground">No hay propietarios disponibles. Crea uno primero.</div>}
                {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.nombre} <span className="text-xs text-muted-foreground">({o.rol})</span></SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Sub-rol en el edificio</Label>
              <Select value={subrole} onValueChange={setSubrole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{OWNER_SUBROLES.map((r) => <SelectItem key={r} value={r}>{SUBROLE_LABEL[r]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Cuota (%)</Label><Input type="number" value={cuota} onChange={(e) => setCuota(e.target.value)} /></div>
          </div>
          <div><Label>Notas</Label><Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={s}>{s ? "Guardando…" : "Añadir"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}