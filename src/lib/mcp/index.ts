import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listNextActionsTool from "./tools/list_next_actions";

// Build the OAuth issuer from the Supabase project ref (Vite inlines this at
// build time). The issuer must be the direct supabase.co host so it matches
// what the discovery document publishes.
const projectRef =
  import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "afflux-property-mcp",
  title: "Afflux Property MCP",
  version: "0.1.0",
  instructions:
    "Tools for Afflux Property. Callers act as the signed-in user (RLS applies). Use `whoami` to verify connectivity and `list_next_actions` to inspect the user's pending tasks.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listNextActionsTool],
});