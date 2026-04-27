import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n/I18nProvider";

type Match = { id: string; contenido: string; origen: string; similarity: number };

export function RagSearch({ scopeType, scopeId }: { scopeType?: string; scopeId?: string }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [embedded, setEmbedded] = useState<boolean | null>(null);

  const run = async () => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("rag_search", {
        body: { query: q, scope_type: scopeType, scope_id: scopeId, k: 5 },
      });
      if (error) throw error;
      setMatches((data as any).matches ?? []);
      setEmbedded((data as any).embedded ?? false);
    } finally { setLoading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-4 w-4 text-primary" /> {t.agents.ragTitle}
          {embedded === false && (
            <span className="ml-2 text-xs text-muted-foreground">(léxico)</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.agents.ragPlaceholder}
            onKeyDown={(e) => e.key === "Enter" && run()} />
          <Button onClick={run} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            {t.agents.ragRun}
          </Button>
        </div>
        {matches.length > 0 && (
          <ul className="divide-y divide-border rounded border border-border">
            {matches.map((m) => (
              <li key={m.id} className="px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase text-muted-foreground">{m.origen}</span>
                  <span className="text-xs text-muted-foreground">{(m.similarity * 100).toFixed(0)}%</span>
                </div>
                <div>{m.contenido}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}