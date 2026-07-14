
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public._owner_names_typo_match(a_nn text, b_nn text, p_token_threshold real DEFAULT 0.7)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  a text[]; b text[];
  a_only text[]; b_only text[];
  t1 text; t2 text; lev int; max_len int;
BEGIN
  IF a_nn IS NULL OR b_nn IS NULL OR a_nn = '' OR b_nn = '' THEN RETURN false; END IF;
  a := string_to_array(a_nn, ' ');
  b := string_to_array(b_nn, ' ');
  IF array_length(a,1) <> array_length(b,1) OR array_length(a,1) < 2 THEN RETURN false; END IF;
  SELECT array_agg(t) INTO a_only FROM (SELECT unnest(a) t EXCEPT SELECT unnest(b)) s;
  SELECT array_agg(t) INTO b_only FROM (SELECT unnest(b) t EXCEPT SELECT unnest(a)) s;
  IF a_only IS NULL AND b_only IS NULL THEN RETURN true; END IF;
  IF array_length(a_only,1) <> 1 OR array_length(b_only,1) <> 1 THEN RETURN false; END IF;
  t1 := a_only[1]; t2 := b_only[1];
  -- Acepta si trigram-sim alto O si distancia Levenshtein ≤ 2 sobre tokens de longitud >=5
  IF similarity(t1, t2) >= p_token_threshold THEN RETURN true; END IF;
  max_len := GREATEST(length(t1), length(t2));
  IF max_len < 5 THEN RETURN false; END IF;
  lev := extensions.levenshtein(t1, t2);
  -- 2 letras cambiadas en un token de 8-9 chars => probable errata (Cabornero/Carbonero)
  RETURN lev <= 2 AND lev::real / max_len::real <= 0.30;
END $$;
