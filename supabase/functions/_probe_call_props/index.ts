import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const { ids } = await req.json();
  const props = ['hs_call_transcription','hs_call_recording_transcript_id','hs_call_recording_url','hs_call_body','hs_call_summary','hs_call_ai_summary','hs_call_transcription_id','hs_call_video_recording_url'];
  const out: any[] = [];
  for (const id of ids) {
    const qs = props.map(p => `properties=${p}`).join('&');
    try {
      const r = await hubspotFetch(`/crm/v3/objects/calls/${id}?${qs}`);
      out.push({ id, props: r.properties });
    } catch (e: any) { out.push({ id, error: e.message }); }
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, 'Content-Type':'application/json' } });
});