create table public.patio_window_counts (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  refcatastral_14 text not null,
  patios_detectados jsonb not null,
  estimacion_total integer not null,
  estimacion_rango jsonb not null,
  metodo text not null,
  confianza text not null,
  flags text[] not null default '{}',
  notas text,
  densidad_patio_m numeric,
  plantas_residenciales integer,
  numero_viviendas integer,
  created_at timestamptz not null default now()
);

grant select on public.patio_window_counts to authenticated;
grant all on public.patio_window_counts to service_role;

alter table public.patio_window_counts enable row level security;

create policy "patio_window_counts_select_authenticated"
  on public.patio_window_counts for select
  to authenticated using (true);

create policy "patio_window_counts_service_all"
  on public.patio_window_counts for all
  to service_role using (true) with check (true);

create index patio_window_counts_building_idx
  on public.patio_window_counts (building_id, created_at desc);
create index patio_window_counts_refcatastral_idx
  on public.patio_window_counts (refcatastral_14);