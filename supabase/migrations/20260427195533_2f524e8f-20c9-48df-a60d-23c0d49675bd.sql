
CREATE TYPE owner_subrole AS ENUM (
  'ninguno','heredero_operador','heredero_residente','heredero_ausente',
  'heredero_conflictivo','arrendador','usufructuario','nudo_propietario','apoderado'
);

ALTER TABLE public.owners ADD COLUMN subrole owner_subrole NOT NULL DEFAULT 'ninguno';

CREATE TABLE public.building_owners (
  building_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  cuota numeric,
  subrole owner_subrole NOT NULL DEFAULT 'ninguno',
  rol_notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (building_id, owner_id)
);

ALTER TABLE public.building_owners ENABLE ROW LEVEL SECURITY;

CREATE POLICY preview_all_select ON public.building_owners FOR SELECT USING (true);
CREATE POLICY preview_all_insert ON public.building_owners FOR INSERT WITH CHECK (true);
CREATE POLICY preview_all_update ON public.building_owners FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY preview_all_delete ON public.building_owners FOR DELETE USING (true);

CREATE INDEX idx_building_owners_building ON public.building_owners(building_id);
CREATE INDEX idx_building_owners_owner ON public.building_owners(owner_id);
