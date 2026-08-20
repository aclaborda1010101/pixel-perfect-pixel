// Textos en lenguaje llano para el bloque "Datos de HubSpot" de la ficha del edificio.

export const AVISO_HORAS = 24;

export interface FotoSync {
  propietarios: number;
  telefonos: number;
  llamadas: number;
  fuente_pct: string;
  suma_pct: number;
  reparto_completo: boolean;
}

export interface ResultadoSync {
  antes: FotoSync;
  despues: FotoSync;
  stats?: { llamadas_sincronizadas?: number };
}

/** "hace 2 horas", "hace 5 minutos", "el 13 de agosto"… */
export function textoUltimaActualizacion(iso: string | null | undefined, ahora = new Date()): string {
  if (!iso) return "Nunca se han traído los datos de HubSpot para este edificio";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Nunca se han traído los datos de HubSpot para este edificio";
  const min = Math.floor((ahora.getTime() - d.getTime()) / 60000);
  if (min < 1) return "Datos de HubSpot actualizados hace unos segundos";
  if (min < 60) return `Datos de HubSpot actualizados hace ${min} ${min === 1 ? "minuto" : "minutos"}`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `Datos de HubSpot actualizados hace ${horas} ${horas === 1 ? "hora" : "horas"}`;
  const dias = Math.floor(horas / 24);
  if (dias < 7) return `Datos de HubSpot actualizados hace ${dias} ${dias === 1 ? "día" : "días"}`;
  return `Datos de HubSpot actualizados el ${d.toLocaleDateString("es-ES", { day: "numeric", month: "long" })}`;
}

/** Pasadas 24 horas (o sin fecha) el texto se muestra en tono de aviso, no de error. */
export function necesitaAviso(iso: string | null | undefined, ahora = new Date()): boolean {
  if (!iso) return true;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return true;
  return ahora.getTime() - d.getTime() > AVISO_HORAS * 3600 * 1000;
}

/** Resumen concreto de lo que ha traído la sincronización. */
export function resumenCambios(r: ResultadoSync): string {
  const partes: string[] = [];
  const nuevosProp = r.despues.propietarios - r.antes.propietarios;
  const nuevosTel = r.despues.telefonos - r.antes.telefonos;
  const nuevasLlam = r.despues.llamadas - r.antes.llamadas;
  if (nuevosProp > 0) partes.push(`Se ${nuevosProp === 1 ? "ha añadido 1 propietario" : `han añadido ${nuevosProp} propietarios`}`);
  if (nuevosTel > 0) partes.push(`${nuevosTel} ${nuevosTel === 1 ? "teléfono nuevo" : "teléfonos nuevos"}`);
  if (nuevasLlam > 0) partes.push(`${nuevasLlam} ${nuevasLlam === 1 ? "llamada" : "llamadas"}`);
  if (!r.antes.reparto_completo && r.despues.reparto_completo) partes.push("el reparto pasa a estar completo");
  else if (r.antes.reparto_completo && !r.despues.reparto_completo) partes.push("el reparto ha dejado de cuadrar");
  if (r.antes.fuente_pct !== r.despues.fuente_pct) {
    partes.push(
      r.despues.fuente_pct === "crm"
        ? "los porcentajes pasan a tomarse de HubSpot"
        : "los porcentajes pasan a tomarse de la nota del Registro",
    );
  }
  if (partes.length === 0) return "Todo estaba al día: no había nada nuevo que traer.";
  return `${partes.join(" · ")}.`;
}
