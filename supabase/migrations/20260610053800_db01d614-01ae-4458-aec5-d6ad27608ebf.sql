CREATE POLICY "admins_read_knowledge_bucket" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'knowledge' AND public.has_role(auth.uid(),'admin'));

CREATE POLICY "admins_write_knowledge_bucket" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'knowledge' AND public.has_role(auth.uid(),'admin'));

CREATE POLICY "admins_delete_knowledge_bucket" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'knowledge' AND public.has_role(auth.uid(),'admin'));