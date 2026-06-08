
UPDATE public.madrid_calles_subzona
SET calle_norm = upper(regexp_replace(calle_norm, '\s+', '', 'g'));
