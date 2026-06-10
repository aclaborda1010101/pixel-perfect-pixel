
CREATE POLICY "authenticated_read_enrichment_evidence"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'enrichment-evidence');

CREATE POLICY "service_role_write_enrichment_evidence"
  ON storage.objects FOR INSERT TO service_role
  WITH CHECK (bucket_id = 'enrichment-evidence');
