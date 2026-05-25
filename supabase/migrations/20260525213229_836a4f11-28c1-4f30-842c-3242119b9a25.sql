INSERT INTO public.catastro_data (refcatastral, building_id, plantas_pdf_url, plantas_pages_urls, plantas_num_pages, plantas_pdf_disponible, fetched_at)
VALUES (
  '9839518VK3793H',
  '0485d8cf-c1a2-4412-b38f-e37fb18961a2',
  'https://vsbrupwznqaaoiflvliu.supabase.co/storage/v1/object/public/catastro/9839518VK3793H_plantas.pdf',
  '["https://vsbrupwznqaaoiflvliu.supabase.co/storage/v1/object/public/catastro/9839518VK3793H_plantas_p1.png","https://vsbrupwznqaaoiflvliu.supabase.co/storage/v1/object/public/catastro/9839518VK3793H_plantas_p2.png","https://vsbrupwznqaaoiflvliu.supabase.co/storage/v1/object/public/catastro/9839518VK3793H_plantas_p3.png","https://vsbrupwznqaaoiflvliu.supabase.co/storage/v1/object/public/catastro/9839518VK3793H_plantas_p4.png","https://vsbrupwznqaaoiflvliu.supabase.co/storage/v1/object/public/catastro/9839518VK3793H_plantas_p5.png"]'::jsonb,
  5,
  true,
  now()
)
ON CONFLICT (refcatastral) DO UPDATE SET
  building_id = EXCLUDED.building_id,
  plantas_pdf_url = EXCLUDED.plantas_pdf_url,
  plantas_pages_urls = EXCLUDED.plantas_pages_urls,
  plantas_num_pages = EXCLUDED.plantas_num_pages,
  plantas_pdf_disponible = EXCLUDED.plantas_pdf_disponible,
  fetched_at = EXCLUDED.fetched_at;