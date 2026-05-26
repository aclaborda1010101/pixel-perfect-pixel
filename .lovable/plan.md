## Fix coords=0 en `fetch-catastro-data` + reintento de fallidos

### Bug
En `fetch-catastro-data/index.ts:106-108`, `Number(null)===0` y `isFinite(0)===true`, así que cuando ya existía un row en `catastro_data` con `lat/lon` NULL (de jobs anteriores), `haveCoords` se evaluaba `true`, se saltaba el geocoding y el upsert final escribía `lat=0, lon=0`. Por eso 7 edificios pasan a fase Google con coords inválidas y `fetch-google-imagery` devuelve 400.

### Cambios

**1. `supabase/functions/fetch-catastro-data/index.ts` (líneas 106-108)**
```ts
const latRaw = existing?.lat;
const lonRaw = existing?.lon;
let lat: number = latRaw != null ? Number(latRaw) : NaN;
let lon: number = lonRaw != null ? Number(lonRaw) : NaN;
const haveCoords = isFinite(lat) && isFinite(lon) && lat !== 0 && lon !== 0;
```

**2. Deploy** `fetch-catastro-data`.

**3. Limpiar coords inválidas existentes** (migración):
```sql
UPDATE catastro_data SET lat = NULL, lon = NULL 
WHERE lat = 0 OR lon = 0;
```

**4. Esperar a que el job actual `f5cf3643…` termine** (no abortarlo — está procesando los 60 restantes correctamente). Cuando finalice, lanzar un nuevo job de `auto-process-cartera-demo` con `force:true` solo para los que tengan `fetch_error` o sigan sin Google imagery / sin PDF — el orquestador detectará coords NULL, las repobblará con Nominatim y reintentará la fase Google.

### Fuera de alcance
- Fix del SVG (sigue pendiente del log diagnóstico)
- Cambios en `fetch-google-imagery` (su validación `!cat?.lat` es correcta)
