ALTER TABLE public.building_owners
  ADD CONSTRAINT building_owners_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE,
  ADD CONSTRAINT building_owners_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;

ALTER TABLE public.notas_simples
  ADD CONSTRAINT notas_simples_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE SET NULL,
  ADD CONSTRAINT notas_simples_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE SET NULL;