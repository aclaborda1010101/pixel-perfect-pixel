## Problema

El login de David falla con `500: Database error querying schema` y en los logs de auth aparece:

```
error finding user: sql: Scan error on column index 3, name "confirmation_token": converting NULL to string is unsupported
```

Es un bug conocido de GoTrue: cuando en `auth.users` los campos de token (`confirmation_token`, `email_change`, `email_change_token_new`, `recovery_token`, `phone_change`, `phone_change_token`, `email_change_token_current`, `reauthentication_token`) están a `NULL` en vez de `''`, el driver Go no puede escanear la fila y devuelve 500 en cualquier `signInWithPassword`. La cuenta se creó ayer por migración/SQL directo y quedaron esos campos a NULL.

## Solución

Una única migración que normaliza esos campos a cadena vacía para el usuario afectado (y de paso para cualquier otro usuario con el mismo problema latente, sin tocar nada más de `auth`).

```sql
UPDATE auth.users
SET
  confirmation_token      = COALESCE(confirmation_token, ''),
  email_change            = COALESCE(email_change, ''),
  email_change_token_new  = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  recovery_token          = COALESCE(recovery_token, ''),
  phone_change            = COALESCE(phone_change, ''),
  phone_change_token      = COALESCE(phone_change_token, ''),
  reauthentication_token  = COALESCE(reauthentication_token, '')
WHERE
  confirmation_token IS NULL
  OR email_change IS NULL
  OR email_change_token_new IS NULL
  OR email_change_token_current IS NULL
  OR recovery_token IS NULL
  OR phone_change IS NULL
  OR phone_change_token IS NULL
  OR reauthentication_token IS NULL;
```

Después, David podrá entrar con `david.casero@afflux.es` / `Afflux2026!` (o pedir magic link).

## Verificación

- Reintentar login con la contraseña desde la UI.
- Si aún falla, revisar `auth-logs` para confirmar que ya no aparece el error de `confirmation_token`.
