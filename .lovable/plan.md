# Crear admin agustin.cifuentes@afflux.es

## Credenciales

```
Email:    agustin.cifuentes@afflux.es
Password: Bosco2305
Rol:      admin
URL:      /login → "Acceder con contraseña"
```

## Pasos

1. **Insert directo en `auth.users`** vía SQL admin con `crypt()` + bcrypt:
   - `email_confirmed_at = now()` (auto-confirmado, sin necesitar email)
   - `raw_user_meta_data = {"full_name":"Agustín Cifuentes"}`
   - `aud='authenticated'`, `role='authenticated'`

2. **Trigger `handle_new_user`** crea automáticamente:
   - Fila en `profiles`
   - Fila en `user_roles` con rol `admin` (es el primer usuario → lógica del trigger ya actualizada)

3. **Verificar** con SELECT sobre `auth.users` + `profiles` + `user_roles` confirmando los 3 registros y rol admin.

4. **Login**: ir a `/login`, click "Acceder con contraseña", introducir email + `Bosco2305`. Sesión activa.

## Notas

- HIBP está activo: `Bosco2305` puede aparecer en breaches y el cambio futuro a una débil sería rechazado, pero el insert directo bypassa esa validación (admin-side).
- Nada de HubSpot. Cero writes externos.
- Tras login, sigo encadenando con C.2 → C.3+C.4 → D → E.
