import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { BookOpen, Upload, RefreshCw, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

const ORIGENES = [
  { value: "documento_maestro", label: "Documento maestro" },
  { value: "tipologias_qa", label: "Tipologías Q&A" },
  { value: "proceso_operativo", label: "Proceso operativo" },
  { value: "marketing", label: "Marketing" },
  { value: "otro", label: "Otro" },
];

type Doc = {
  id: string; nombre: string; origen: string; num_chunks: number;
  status: string; error: string | null; size_bytes: number | null; created_at: string;
};

export function KnowledgeBasePanel() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [origen, setOrigen] = useState("documento_maestro");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase
      .from("knowledge_documents" as any)
      .select("id, nombre, origen, num_chunks, status, error, size_bytes, created_at")
      .order("created_at", { ascending: false });
    setDocs((data as any) || []);
  }
  useEffect(() => { load(); }, []);

  async function upload() {
    if (!file) { toast.error("Selecciona un archivo"); return; }
    setBusy(true);
    try {
      const path = `${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("knowledge").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { data: doc, error: insErr } = await supabase
        .from("knowledge_documents" as any)
        .insert({
          nombre: file.name,
          storage_path: path,
          mime_type: file.type,
          size_bytes: file.size,
          origen,
          status: "pendiente",
        })
        .select()
        .single();
      if (insErr) throw insErr;
      toast.success("Subido. Procesando…");
      setFile(null);
      await load();
      const { error: fnErr } = await supabase.functions.invoke("knowledge_ingest_file", { body: { document_id: (doc as any).id } });
      if (fnErr) throw fnErr;
      toast.success("Ingesta completada");
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Error subiendo");
    } finally { setBusy(false); }
  }

  async function reingest(id: string) {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("knowledge_ingest_file", { body: { document_id: id } });
      if (error) throw error;
      toast.success("Re-ingestado");
      load();
    } catch (e: any) { toast.error(e?.message ?? "Error"); }
    finally { setBusy(false); }
  }

  async function remove(d: Doc) {
    if (!confirm(`Borrar "${d.nombre}" y sus ${d.num_chunks} chunks?`)) return;
    setBusy(true);
    try {
      const { data: full } = await supabase.from("knowledge_documents" as any).select("storage_path").eq("id", d.id).maybeSingle();
      await supabase.from("knowledge_documents" as any).delete().eq("id", d.id);
      if ((full as any)?.storage_path) await supabase.storage.from("knowledge").remove([(full as any).storage_path]);
      toast.success("Borrado");
      load();
    } catch (e: any) { toast.error(e?.message ?? "Error"); }
    finally { setBusy(false); }
  }

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <Eyebrow><BookOpen className="mr-1 inline h-3 w-3" /> Base de conocimiento</Eyebrow>
        <CardTitle>Documentos indexados · {docs.length}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2 rounded border border-border-faint p-3">
          <div className="space-y-1">
            <Eyebrow>Origen</Eyebrow>
            <Select value={origen} onValueChange={setOrigen}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>{ORIGENES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex-1 min-w-[220px]">
            <Eyebrow>Archivo (docx, xlsx, pdf, txt)</Eyebrow>
            <Input type="file" accept=".docx,.xlsx,.xls,.pdf,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <Button onClick={upload} disabled={busy || !file} variant="gold">
            {busy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Upload className="mr-2 h-3 w-3" />}
            Subir e ingestar
          </Button>
        </div>

        <ul className="divide-y divide-border-faint">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{d.nombre}</div>
                <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <Badge variant="outline">{d.origen}</Badge>
                  <Badge variant={d.status === "ok" ? "info" : d.status === "error" ? "destructive" : "outline"}>{d.status}</Badge>
                  <span>{d.num_chunks} chunks</span>
                  {d.size_bytes ? <span>· {(d.size_bytes / 1024).toFixed(0)} KB</span> : null}
                  {d.error ? <span className="text-destructive">· {d.error}</span> : null}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => reingest(d.id)} disabled={busy}>
                <RefreshCw className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => remove(d)} disabled={busy}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
          {docs.length === 0 && <li className="py-3 text-sm text-muted-foreground">Aún no hay documentos. Sube el primero arriba.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}