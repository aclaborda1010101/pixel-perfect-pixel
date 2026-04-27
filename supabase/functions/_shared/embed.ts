// Compute a 768-dim embedding via the Lovable AI Gateway (Google Gemini embedding model).
// Returns null if the gateway has no embedding endpoint available, so callers can degrade gracefully.

export async function embed(text: string): Promise<number[] | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/text-embedding-004",
        input: text,
      }),
    });
    if (!res.ok) {
      console.warn("embed: gateway returned", res.status);
      return null;
    }
    const json = await res.json();
    const v = json?.data?.[0]?.embedding;
    if (!Array.isArray(v)) return null;
    return v as number[];
  } catch (e) {
    console.warn("embed: error", e);
    return null;
  }
}