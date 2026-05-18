import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { MapPinned, Search, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Profile = { id: string; email: string | null; full_name: string | null };
type Building = { id: string; direccion: string; ciudad: string | null };

export function BuildingAssignmentsPanel() {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyAssigned, setOnlyAssigned] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Comerciales (users con rol comercial_zona) + cualquier user
  const { data: users } = useQuery({
    queryKey: ["settings:assignments:users"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id,email,full_name").order("email"),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      const roleByUser = new Map<string, string>();
      (roles ?? []).forEach((r: any) => roleByUser.set(r.user_id, r.role));
      const all = (profiles ?? []) as Profile[];
      const comerciales = all.filter((p) => roleByUser.get(p.id) === "comercial_zona");
      return { all, comerciales, roleByUser };
    },
  });

  const { data: buildings } = useQuery({
    queryKey: ["settings:assignments:buildings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("buildings")
        .select("id,direccion,ciudad")
        .order("ciudad")
        .order("direccion")
        .limit(2000);
      return (data ?? []) as Building[];
    },
  });

  const { data: assignments } = useQuery({
    queryKey: ["settings:assignments:byUser", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await (supabase.from("building_assignments" as any) as any)
        .select("building_id")
        .eq("user_id", userId);
      return (data ?? []).map((r: any) => r.building_id as string);
    },
  });

  // sync seleccionados al cambiar de user
  useEffect(() => {
    if (!userId) return;
    const set = new Set<string>(assignments ?? []);
    setSelected(new Set(set));
    setInitial(new Set(set));
  }, [userId, assignments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = buildings ?? [];
    if (q) {
      list = list.filter(
        (b) =>
          b.direccion?.toLowerCase().includes(q) ||
          (b.ciudad ?? "").toLowerCase().includes(q),
      );
    }
    if (onlyAssigned) list = list.filter((b) => selected.has(b.id));
    return list.slice(0, 500);
  }, [buildings, search, onlyAssigned, selected]);

  const dirty = useMemo(() => {
    if (selected.size !== initial.size) return true;
    for (const id of selected) if (!initial.has(id)) return true;
    return false;
  }, [selected, initial]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!userId) return;
    setSaving(true);
    try {
      const toAdd = [...selected].filter((id) => !initial.has(id));
      const toRemove = [...initial].filter((id) => !selected.has(id));

      if (toRemove.length) {
        const { error } = await (supabase.from("building_assignments" as any) as any)
          .delete()
          .eq("user_id", userId)
          .in("building_id", toRemove);
        if (error) throw error;
      }
      if (toAdd.length) {
        const rows = toAdd.map((building_id) => ({ user_id: userId, building_id }));
        const { error } = await (supabase.from("building_assignments" as any) as any).insert(rows);
        if (error) throw error;
      }
      toast.success(`Asignaciones guardadas: +${toAdd.length} / -${toRemove.length}`);
      setInitial(new Set(selected));
      await qc.invalidateQueries({ queryKey: ["settings:assignments:byUser", userId] });
      await qc.invalidateQueries({ queryKey: ["comercial:dashboard"] });
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudieron guardar las asignaciones");
    } finally {
      setSaving(false);
    }
  }

  const candidates = (users?.comerciales?.length ? users.comerciales : users?.all) ?? [];
  const currentUser = candidates.find((u) => u.id === userId) ?? null;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <Eyebrow><MapPinned className="mr-1 inline h-3 w-3" /> Edificios por zona</Eyebrow>
        <CardTitle>Asignación de edificios a comerciales</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Selección de comercial */}
        <div className="flex flex-wrap items-center gap-2">
          {candidates.length === 0 && (
            <span className="text-sm text-muted-foreground">
              No hay comerciales. Asigna primero el rol "Comercial Zona" en el panel superior.
            </span>
          )}
          {candidates.map((u) => (
            <Button
              key={u.id}
              size="sm"
              variant={userId === u.id ? "gold" : "outline"}
              onClick={() => setUserId(u.id)}
            >
              {u.full_name || u.email || u.id.slice(0, 8)}
            </Button>
          ))}
        </div>

        {currentUser && (
          <>
            <div className="flex flex-col gap-2 border-t border-border-faint pt-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {currentUser.full_name || currentUser.email}
                </div>
                <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                  {selected.size} edificios seleccionados · {initial.size} guardados
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={dirty ? "gold" : "outline"}>
                  {dirty ? "Cambios sin guardar" : "Sincronizado"}
                </Badge>
                <Button size="sm" variant="gold" onClick={save} disabled={!dirty || saving}>
                  {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
                  Guardar cambios
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar por dirección o ciudad…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={onlyAssigned}
                  onCheckedChange={(v) => setOnlyAssigned(!!v)}
                />
                Solo asignados
              </label>
            </div>

            <ul className="max-h-[480px] divide-y divide-border-faint overflow-y-auto rounded-md border border-border-faint">
              {filtered.map((b) => {
                const checked = selected.has(b.id);
                return (
                  <li
                    key={b.id}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-1"
                    onClick={() => toggle(b.id)}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggle(b.id)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-foreground">{b.direccion}</div>
                      <div className="truncate font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                        {b.ciudad ?? "—"}
                      </div>
                    </div>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Sin resultados
                </li>
              )}
            </ul>
            {(buildings?.length ?? 0) > 500 && (
              <p className="text-[11px] text-muted-foreground">
                Mostrando primeros 500 resultados. Refina la búsqueda para ver más.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}