
CREATE POLICY "feedback-audio auth read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'feedback-audio');
CREATE POLICY "feedback-audio auth insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'feedback-audio');
