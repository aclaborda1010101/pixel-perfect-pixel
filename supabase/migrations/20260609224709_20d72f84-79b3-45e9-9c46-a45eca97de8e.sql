
CREATE OR REPLACE FUNCTION public._safe_int_from_dir(p text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE m text;
BEGIN
  m := (regexp_match(COALESCE(p,''), '\m(\d{1,4})\M'))[1];
  IF m IS NULL THEN RETURN NULL; END IF;
  RETURN m::integer;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
