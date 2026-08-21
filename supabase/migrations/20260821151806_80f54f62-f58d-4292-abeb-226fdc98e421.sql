UPDATE public.buildings SET pct_terciario = round(pct_terciario * 100, 2)
 WHERE pct_terciario > 0 AND pct_terciario <= 1;
UPDATE public.buildings SET pct_residencial = round(pct_residencial * 100, 2)
 WHERE pct_residencial > 0 AND pct_residencial <= 1;
SELECT public.coherencia_evaluar();