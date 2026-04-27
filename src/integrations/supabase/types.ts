export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_runs: {
        Row: {
          agent_name: string
          confianza: number | null
          created_at: string
          error: string | null
          id: string
          latencia_ms: number | null
          modelo: string | null
          resultado: Json | null
          scope_id: string | null
          scope_type: string | null
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          agent_name: string
          confianza?: number | null
          created_at?: string
          error?: string | null
          id?: string
          latencia_ms?: number | null
          modelo?: string | null
          resultado?: Json | null
          scope_id?: string | null
          scope_type?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          agent_name?: string
          confianza?: number | null
          created_at?: string
          error?: string | null
          id?: string
          latencia_ms?: number | null
          modelo?: string | null
          resultado?: Json | null
          scope_id?: string | null
          scope_type?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: []
      }
      assets: {
        Row: {
          building_id: string | null
          ciudad: string | null
          created_at: string
          descripcion: string | null
          estado: Database["public"]["Enums"]["asset_status"]
          id: string
          owner_id: string | null
          superficie_m2: number | null
          tipo: Database["public"]["Enums"]["asset_type"]
          ubicacion: string
          updated_at: string
          valoracion_confianza: number | null
          valoracion_estimada: number | null
          valoracion_fuente: string | null
        }
        Insert: {
          building_id?: string | null
          ciudad?: string | null
          created_at?: string
          descripcion?: string | null
          estado?: Database["public"]["Enums"]["asset_status"]
          id?: string
          owner_id?: string | null
          superficie_m2?: number | null
          tipo?: Database["public"]["Enums"]["asset_type"]
          ubicacion: string
          updated_at?: string
          valoracion_confianza?: number | null
          valoracion_estimada?: number | null
          valoracion_fuente?: string | null
        }
        Update: {
          building_id?: string | null
          ciudad?: string | null
          created_at?: string
          descripcion?: string | null
          estado?: Database["public"]["Enums"]["asset_status"]
          id?: string
          owner_id?: string | null
          superficie_m2?: number | null
          tipo?: Database["public"]["Enums"]["asset_type"]
          ubicacion?: string
          updated_at?: string
          valoracion_confianza?: number | null
          valoracion_estimada?: number | null
          valoracion_fuente?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      building_owners: {
        Row: {
          building_id: string
          created_at: string
          cuota: number | null
          owner_id: string
          rol_notas: string | null
          subrole: Database["public"]["Enums"]["owner_subrole"]
        }
        Insert: {
          building_id: string
          created_at?: string
          cuota?: number | null
          owner_id: string
          rol_notas?: string | null
          subrole?: Database["public"]["Enums"]["owner_subrole"]
        }
        Update: {
          building_id?: string
          created_at?: string
          cuota?: number | null
          owner_id?: string
          rol_notas?: string | null
          subrole?: Database["public"]["Enums"]["owner_subrole"]
        }
        Relationships: []
      }
      buildings: {
        Row: {
          catastro_ref: string | null
          ciudad: string
          codigo_postal: string | null
          created_at: string
          direccion: string
          division_horizontal: boolean
          estado: Database["public"]["Enums"]["building_status"]
          id: string
          notas: string | null
          numero_propietarios: number | null
          updated_at: string
        }
        Insert: {
          catastro_ref?: string | null
          ciudad: string
          codigo_postal?: string | null
          created_at?: string
          direccion: string
          division_horizontal?: boolean
          estado?: Database["public"]["Enums"]["building_status"]
          id?: string
          notas?: string | null
          numero_propietarios?: number | null
          updated_at?: string
        }
        Update: {
          catastro_ref?: string | null
          ciudad?: string
          codigo_postal?: string | null
          created_at?: string
          direccion?: string
          division_horizontal?: boolean
          estado?: Database["public"]["Enums"]["building_status"]
          id?: string
          notas?: string | null
          numero_propietarios?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      cadence_steps: {
        Row: {
          created_at: string
          dia_offset: number
          estado: string
          id: string
          owner_id: string | null
          plantilla: string | null
          tipo: Database["public"]["Enums"]["cadence_step_kind"]
        }
        Insert: {
          created_at?: string
          dia_offset?: number
          estado?: string
          id?: string
          owner_id?: string | null
          plantilla?: string | null
          tipo: Database["public"]["Enums"]["cadence_step_kind"]
        }
        Update: {
          created_at?: string
          dia_offset?: number
          estado?: string
          id?: string
          owner_id?: string | null
          plantilla?: string | null
          tipo?: Database["public"]["Enums"]["cadence_step_kind"]
        }
        Relationships: [
          {
            foreignKeyName: "cadence_steps_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          created_at: string
          direccion: Database["public"]["Enums"]["call_direction"]
          duracion_seg: number | null
          fecha: string
          id: string
          owner_id: string | null
          resumen: string | null
          siguiente_accion: string | null
          transcripcion: string | null
          transcripcion_url: string | null
        }
        Insert: {
          created_at?: string
          direccion?: Database["public"]["Enums"]["call_direction"]
          duracion_seg?: number | null
          fecha?: string
          id?: string
          owner_id?: string | null
          resumen?: string | null
          siguiente_accion?: string | null
          transcripcion?: string | null
          transcripcion_url?: string | null
        }
        Update: {
          created_at?: string
          direccion?: Database["public"]["Enums"]["call_direction"]
          duracion_seg?: number | null
          fecha?: string
          id?: string
          owner_id?: string | null
          resumen?: string | null
          siguiente_accion?: string | null
          transcripcion?: string | null
          transcripcion_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_cases: {
        Row: {
          created_at: string
          dpia_ok: boolean
          estado: Database["public"]["Enums"]["compliance_status"]
          evidencia: string | null
          id: string
          motivo: string
          owner_revisor: string | null
          resuelto_at: string | null
          scope_id: string | null
          scope_type: string
        }
        Insert: {
          created_at?: string
          dpia_ok?: boolean
          estado?: Database["public"]["Enums"]["compliance_status"]
          evidencia?: string | null
          id?: string
          motivo: string
          owner_revisor?: string | null
          resuelto_at?: string | null
          scope_id?: string | null
          scope_type: string
        }
        Update: {
          created_at?: string
          dpia_ok?: boolean
          estado?: Database["public"]["Enums"]["compliance_status"]
          evidencia?: string | null
          id?: string
          motivo?: string
          owner_revisor?: string | null
          resuelto_at?: string | null
          scope_id?: string | null
          scope_type?: string
        }
        Relationships: []
      }
      investors: {
        Row: {
          ciudades: string[]
          consentimiento: boolean
          created_at: string
          email: string | null
          id: string
          nombre: string
          notas: string | null
          telefono: string | null
          ticket_max: number | null
          ticket_min: number | null
          tipos_activo: Database["public"]["Enums"]["asset_type"][]
          updated_at: string
        }
        Insert: {
          ciudades?: string[]
          consentimiento?: boolean
          created_at?: string
          email?: string | null
          id?: string
          nombre: string
          notas?: string | null
          telefono?: string | null
          ticket_max?: number | null
          ticket_min?: number | null
          tipos_activo?: Database["public"]["Enums"]["asset_type"][]
          updated_at?: string
        }
        Update: {
          ciudades?: string[]
          consentimiento?: boolean
          created_at?: string
          email?: string | null
          id?: string
          nombre?: string
          notas?: string | null
          telefono?: string | null
          ticket_max?: number | null
          ticket_min?: number | null
          tipos_activo?: Database["public"]["Enums"]["asset_type"][]
          updated_at?: string
        }
        Relationships: []
      }
      knowledge_chunks: {
        Row: {
          contenido: string
          created_at: string
          embedding: string | null
          id: string
          metadatos: Json
          origen: string
          referencia_id: string | null
          scope_id: string | null
          scope_type: string | null
        }
        Insert: {
          contenido: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadatos?: Json
          origen: string
          referencia_id?: string | null
          scope_id?: string | null
          scope_type?: string | null
        }
        Update: {
          contenido?: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadatos?: Json
          origen?: string
          referencia_id?: string | null
          scope_id?: string | null
          scope_type?: string | null
        }
        Relationships: []
      }
      match_candidates: {
        Row: {
          asset_id: string
          created_at: string
          estado: Database["public"]["Enums"]["match_status"]
          evidencia: string | null
          id: string
          investor_id: string
          score: number
        }
        Insert: {
          asset_id: string
          created_at?: string
          estado?: Database["public"]["Enums"]["match_status"]
          evidencia?: string | null
          id?: string
          investor_id: string
          score: number
        }
        Update: {
          asset_id?: string
          created_at?: string
          estado?: Database["public"]["Enums"]["match_status"]
          evidencia?: string | null
          id?: string
          investor_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_candidates_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_candidates_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
        ]
      }
      next_actions: {
        Row: {
          asset_id: string | null
          created_at: string
          detalle: string | null
          estado: Database["public"]["Enums"]["next_action_status"]
          id: string
          origen: string | null
          owner_id: string | null
          titulo: string
          vencimiento: string | null
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          detalle?: string | null
          estado?: Database["public"]["Enums"]["next_action_status"]
          id?: string
          origen?: string | null
          owner_id?: string | null
          titulo: string
          vencimiento?: string | null
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          detalle?: string | null
          estado?: Database["public"]["Enums"]["next_action_status"]
          id?: string
          origen?: string | null
          owner_id?: string | null
          titulo?: string
          vencimiento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "next_actions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          asset_id: string | null
          created_at: string
          etiquetas: string[]
          id: string
          owner_id: string | null
          texto: string
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          etiquetas?: string[]
          id?: string
          owner_id?: string | null
          texto: string
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          etiquetas?: string[]
          id?: string
          owner_id?: string | null
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      org_settings: {
        Row: {
          clave: string
          id: string
          updated_at: string
          valor: Json
        }
        Insert: {
          clave: string
          id?: string
          updated_at?: string
          valor: Json
        }
        Update: {
          clave?: string
          id?: string
          updated_at?: string
          valor?: Json
        }
        Relationships: []
      }
      owners: {
        Row: {
          consentimiento: boolean
          created_at: string
          email: string | null
          id: string
          nombre: string
          notas_breves: string | null
          rol: Database["public"]["Enums"]["owner_role"]
          rol_confianza: number | null
          rol_justificacion: string | null
          subrole: Database["public"]["Enums"]["owner_subrole"]
          telefono: string | null
          updated_at: string
        }
        Insert: {
          consentimiento?: boolean
          created_at?: string
          email?: string | null
          id?: string
          nombre: string
          notas_breves?: string | null
          rol?: Database["public"]["Enums"]["owner_role"]
          rol_confianza?: number | null
          rol_justificacion?: string | null
          subrole?: Database["public"]["Enums"]["owner_subrole"]
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          consentimiento?: boolean
          created_at?: string
          email?: string | null
          id?: string
          nombre?: string
          notas_breves?: string | null
          rol?: Database["public"]["Enums"]["owner_role"]
          rol_confianza?: number | null
          rol_justificacion?: string | null
          subrole?: Database["public"]["Enums"]["owner_subrole"]
          telefono?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          created_at: string
          cuerpo: string
          enviado_at: string | null
          id: string
          owner_id: string | null
          programado_para: string | null
          status: Database["public"]["Enums"]["whatsapp_status"]
        }
        Insert: {
          created_at?: string
          cuerpo: string
          enviado_at?: string | null
          id?: string
          owner_id?: string | null
          programado_para?: string | null
          status?: Database["public"]["Enums"]["whatsapp_status"]
        }
        Update: {
          created_at?: string
          cuerpo?: string
          enviado_at?: string | null
          id?: string
          owner_id?: string | null
          programado_para?: string | null
          status?: Database["public"]["Enums"]["whatsapp_status"]
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_knowledge_chunks: {
        Args: {
          filter_scope_id?: string
          filter_scope_type?: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          contenido: string
          id: string
          metadatos: Json
          origen: string
          scope_id: string
          scope_type: string
          similarity: number
        }[]
      }
    }
    Enums: {
      asset_status:
        | "prospecto"
        | "en_estudio"
        | "listo_para_matching"
        | "en_negociacion"
        | "cerrado"
        | "descartado"
      asset_type:
        | "vivienda"
        | "local"
        | "edificio"
        | "suelo"
        | "oficina"
        | "industrial"
        | "otro"
      building_status:
        | "identificado"
        | "contactado"
        | "en_estudio"
        | "descartado"
      cadence_step_kind: "llamada" | "whatsapp" | "email" | "visita"
      call_direction: "entrante" | "saliente"
      compliance_status: "pendiente" | "aprobado" | "rechazado"
      match_status: "propuesto" | "aprobado" | "rechazado" | "contactado"
      next_action_status: "pendiente" | "completada" | "cancelada"
      owner_role:
        | "particular"
        | "heredero"
        | "inversor_pasivo"
        | "operador_profesional"
        | "institucional"
        | "desconocido"
      owner_subrole:
        | "ninguno"
        | "heredero_operador"
        | "heredero_residente"
        | "heredero_ausente"
        | "heredero_conflictivo"
        | "arrendador"
        | "usufructuario"
        | "nudo_propietario"
        | "apoderado"
      whatsapp_status: "borrador" | "mock_enviado" | "fallido"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      asset_status: [
        "prospecto",
        "en_estudio",
        "listo_para_matching",
        "en_negociacion",
        "cerrado",
        "descartado",
      ],
      asset_type: [
        "vivienda",
        "local",
        "edificio",
        "suelo",
        "oficina",
        "industrial",
        "otro",
      ],
      building_status: [
        "identificado",
        "contactado",
        "en_estudio",
        "descartado",
      ],
      cadence_step_kind: ["llamada", "whatsapp", "email", "visita"],
      call_direction: ["entrante", "saliente"],
      compliance_status: ["pendiente", "aprobado", "rechazado"],
      match_status: ["propuesto", "aprobado", "rechazado", "contactado"],
      next_action_status: ["pendiente", "completada", "cancelada"],
      owner_role: [
        "particular",
        "heredero",
        "inversor_pasivo",
        "operador_profesional",
        "institucional",
        "desconocido",
      ],
      owner_subrole: [
        "ninguno",
        "heredero_operador",
        "heredero_residente",
        "heredero_ausente",
        "heredero_conflictivo",
        "arrendador",
        "usufructuario",
        "nudo_propietario",
        "apoderado",
      ],
      whatsapp_status: ["borrador", "mock_enviado", "fallido"],
    },
  },
} as const
