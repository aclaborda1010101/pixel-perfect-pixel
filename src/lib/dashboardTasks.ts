/**
 * Carga de tareas operativas del dashboard comercial.
 *
 * Se extrae del componente para poder probar la regresión: las tareas
 * visibles (manual o V5) deben cargarse SIEMPRE, incluso cuando el comercial
 * no tiene ningún edificio activo asignado.
 */
import {
  filterVisibleOperationalTasks,
  VISIBLE_OPERATIONAL_TASK_OR_FILTER,
  type OperationalTaskLike,
} from "@/lib/operationalTasks";

export const DASHBOARD_TASK_COLUMNS =
  "id,title,priority,task_type,task_key,building_id,status,created_at";

type QueryClientLike = { from: (table: string) => any };

export async function fetchVisibleUserTasks<T extends OperationalTaskLike>(
  client: QueryClientLike,
  userId: string,
): Promise<T[]> {
  const { data } = await (client.from("building_tasks") as any)
    .select(DASHBOARD_TASK_COLUMNS)
    .eq("user_id", userId)
    .in("status", ["pending", "in_progress"])
    .or(VISIBLE_OPERATIONAL_TASK_OR_FILTER)
    .order("created_at", { ascending: false });
  // Filtro defensivo cliente sobre el filtro servidor.
  return filterVisibleOperationalTasks((data ?? []) as T[]);
}