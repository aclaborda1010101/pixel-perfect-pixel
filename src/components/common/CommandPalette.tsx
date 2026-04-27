import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import {
  Home, PhoneCall, PhoneOutgoing, Boxes, Users, Building2, Briefcase,
  GitMerge, MessageSquareDot, ShieldCheck, Settings as SettingsIcon, Sparkles, Upload,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { NewOwnerDialog, NewBuildingDialog, NewInvestorDialog, NewAssetDialog } from "@/components/forms/NewEntityDialogs";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

type Hit = { kind: "owner" | "asset" | "call"; id: string; label: string; sub?: string };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q || q.length < 2) { setHits([]); return; }
    let active = true;
    (async () => {
      const [owners, assets, calls] = await Promise.all([
        supabase.from("owners").select("id, nombre, email, telefono").or(`nombre.ilike.%${q}%,email.ilike.%${q}%,telefono.ilike.%${q}%`).limit(5),
        supabase.from("assets").select("id, tipo, ubicacion, ciudad").or(`ubicacion.ilike.%${q}%,ciudad.ilike.%${q}%,tipo.ilike.%${q}%`).limit(5),
        supabase.from("calls").select("id, resumen, fecha").ilike("resumen", `%${q}%`).limit(5),
      ]);
      if (!active) return;
      const out: Hit[] = [
        ...((owners.data ?? []).map((o: any) => ({ kind: "owner" as const, id: o.id, label: o.nombre, sub: o.email ?? o.telefono ?? "" }))),
        ...((assets.data ?? []).map((a: any) => ({ kind: "asset" as const, id: a.id, label: `${a.tipo} · ${a.ubicacion}`, sub: a.ciudad ?? "" }))),
        ...((calls.data ?? []).map((c: any) => ({ kind: "call" as const, id: c.id, label: c.resumen?.slice(0, 60) ?? "Llamada", sub: new Date(c.fecha).toLocaleDateString() }))),
      ];
      setHits(out);
    })();
    return () => { active = false; };
  }, [query]);

  const go = (path: string) => { setOpen(false); setQuery(""); navigate(path); };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Buscar o navegar… (escribe nombre, activo, llamada)" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>Sin resultados</CommandEmpty>

        {hits.length > 0 && (
          <>
            <CommandGroup heading="Resultados">
              {hits.map((h) => {
                const Icon = h.kind === "owner" ? Users : h.kind === "asset" ? Boxes : PhoneCall;
                const path = h.kind === "owner" ? `/propietarios/${h.id}` : h.kind === "asset" ? `/activos/${h.id}` : `/llamadas/${h.id}`;
                return (
                  <CommandItem key={`${h.kind}-${h.id}`} value={`${h.kind}-${h.label}-${h.id}`} onSelect={() => go(path)}>
                    <Icon className="mr-2 h-4 w-4" />
                    <span className="flex-1">{h.label}</span>
                    {h.sub && <span className="text-xs text-muted-foreground">{h.sub}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Acciones">
          <CommandItem onSelect={() => go("/preparar-llamada")}>
            <PhoneOutgoing className="mr-2 h-4 w-4" /> Preparar llamada
            <CommandShortcut>⌘P</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/analizar-llamada")}>
            <Upload className="mr-2 h-4 w-4" /> Analizar llamada
            <CommandShortcut>⌘A</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/propietarios")}>
            <Plus className="mr-2 h-4 w-4" /> Nuevo propietario (en /propietarios)
          </CommandItem>
          <CommandItem onSelect={() => go("/edificios")}>
            <Plus className="mr-2 h-4 w-4" /> Nuevo edificio (en /edificios)
          </CommandItem>
          <CommandItem onSelect={() => go("/inversores")}>
            <Plus className="mr-2 h-4 w-4" /> Nuevo inversor (en /inversores)
          </CommandItem>
          <CommandItem onSelect={() => go("/activos")}>
            <Plus className="mr-2 h-4 w-4" /> Nuevo activo (en /activos)
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Navegar">
          <CommandItem onSelect={() => go("/")}><Home className="mr-2 h-4 w-4" /> Inicio</CommandItem>
          <CommandItem onSelect={() => go("/llamadas")}><PhoneCall className="mr-2 h-4 w-4" /> Llamadas</CommandItem>
          <CommandItem onSelect={() => go("/activos")}><Boxes className="mr-2 h-4 w-4" /> Activos</CommandItem>
          <CommandItem onSelect={() => go("/propietarios")}><Users className="mr-2 h-4 w-4" /> Propietarios</CommandItem>
          <CommandItem onSelect={() => go("/edificios")}><Building2 className="mr-2 h-4 w-4" /> Edificios</CommandItem>
          <CommandItem onSelect={() => go("/inversores")}><Briefcase className="mr-2 h-4 w-4" /> Inversores</CommandItem>
          <CommandItem onSelect={() => go("/matching")}><GitMerge className="mr-2 h-4 w-4" /> Matching</CommandItem>
          <CommandItem onSelect={() => go("/cadencias")}><MessageSquareDot className="mr-2 h-4 w-4" /> Cadencias</CommandItem>
          <CommandItem onSelect={() => go("/compliance")}><ShieldCheck className="mr-2 h-4 w-4" /> Compliance</CommandItem>
          <CommandItem onSelect={() => go("/ajustes")}><SettingsIcon className="mr-2 h-4 w-4" /> Ajustes</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export function CommandPaletteHint() {
  return (
    <kbd className="hidden h-7 select-none items-center gap-1 rounded border border-border bg-muted px-2 text-[10px] font-medium text-muted-foreground sm:inline-flex">
      <Sparkles className="h-3 w-3" /> ⌘ K
    </kbd>
  );
}