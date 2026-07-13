import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "list_next_actions",
  title: "List next actions",
  description:
    "Lists next actions (tareas pendientes) belonging to the signed-in user, ordered by due date.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .describe("Maximum number of rows to return (1-50).")
      .default(20),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx: ToolContext) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const capped = Math.max(1, Math.min(50, limit ?? 20));
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data, error } = await supabase
      .from("next_actions")
      .select("id, titulo, detalle, vencimiento, origen, created_at")
      .order("vencimiento", { ascending: true, nullsFirst: false })
      .limit(capped);
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { rows: data ?? [] },
    };
  },
});