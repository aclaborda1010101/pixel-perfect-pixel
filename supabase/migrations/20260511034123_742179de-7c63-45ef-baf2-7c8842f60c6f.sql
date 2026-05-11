CREATE OR REPLACE VIEW public.v_building_conversations AS
WITH deal_to_building AS (
  SELECT entity_id AS building_id, provider_id AS deal_hs_id
  FROM public.external_ids
  WHERE provider='hubspot' AND provider_object_type='deal'
)
SELECT db.building_id, 'call'::text AS kind, c.hs_id, c.hs_timestamp AS ts,
       c.hs_call_body AS body, c.hs_call_duration AS duration_seg,
       c.hs_call_direction AS direction, c.hs_owner_id, c.associated_contact_ids, c.associated_deal_ids
FROM public.hubspot_calls c
JOIN deal_to_building db ON db.deal_hs_id = ANY(c.associated_deal_ids)
UNION ALL
SELECT db.building_id, 'whatsapp', w.hs_id, w.hs_timestamp,
       w.hs_communication_body, NULL, NULL, w.hs_owner_id, w.associated_contact_ids, w.associated_deal_ids
FROM public.hubspot_whatsapp w
JOIN deal_to_building db ON db.deal_hs_id = ANY(w.associated_deal_ids)
UNION ALL
SELECT db.building_id, 'note', n.hs_id, n.hs_timestamp,
       n.hs_note_body, NULL, NULL, NULL, n.associated_contact_ids, n.associated_deal_ids
FROM public.hubspot_notes n
JOIN deal_to_building db ON db.deal_hs_id = ANY(n.associated_deal_ids);