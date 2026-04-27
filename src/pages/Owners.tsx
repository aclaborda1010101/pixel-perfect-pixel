import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { Users } from "lucide-react";

type Owner = {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  rol: string;
  consentimiento: boolean;
  updated_at: string;
};

export default function Owners() {
  const { t } = useI18n();
  const [data, setData] = useState<Owner[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("owners")
        .select("id,nombre,email,telefono,rol,consentimiento,updated_at")
        .order("updated_at", { ascending: false });
      setData((data as Owner[]) ?? []);
    })();
  }, []);

  const filtered = useMemo(
    () =>
      data.filter((o) =>
        [o.nombre, o.email, o.telefono].some((f) =>
          (f ?? "").toLowerCase().includes(q.toLowerCase()),
        ),
      ),
    [data, q],
  );

  return (
    <div>
      <PageHeader title={t.owners.title} />
      <div className="mb-4 max-w-sm">
        <Input
          placeholder={t.common.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {data.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Aún no hay propietarios"
          description="Los propietarios se crean automáticamente al analizar llamadas o asociarlos a un activo."
          ctaLabel="Analizar una llamada"
          ctaTo="/analizar-llamada"
        />
      ) : (
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">{t.owners.title}</th>
              <th className="px-4 py-3">{t.owners.role}</th>
              <th className="px-4 py-3">{t.owners.consent}</th>
              <th className="px-4 py-3">{t.owners.lastContact}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && data.length > 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  Sin coincidencias para “{q}”.
                </td>
              </tr>
            )}
            {filtered.map((o) => (
              <tr
                key={o.id}
                className="border-b border-border last:border-0 hover:bg-muted/30"
              >
                <td className="px-4 py-3">
                  <Link to={`/propietarios/${o.id}`} className="font-medium text-foreground hover:text-primary">
                    {o.nombre}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {o.email ?? o.telefono ?? "—"}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline">{o.rol}</Badge>
                </td>
                <td className="px-4 py-3">
                  {o.consentimiento ? "✅" : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(o.updated_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      )}
    </div>
  );
}