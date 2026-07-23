DELETE FROM public.user_roles ur
USING auth.users u
WHERE ur.user_id = u.id AND u.email = 'david.casero@afflux.es' AND ur.role = 'viewer';