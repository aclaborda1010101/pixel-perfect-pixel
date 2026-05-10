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
      building_companies: {
        Row: {
          building_id: string
          company_id: string
          created_at: string
          fecha_fin: string | null
          fecha_inicio: string | null
          id: string
          metadatos: Json
          percentage: number | null
          role: Database["public"]["Enums"]["building_company_role"]
          source: string | null
          updated_at: string
        }
        Insert: {
          building_id: string
          company_id: string
          created_at?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          metadatos?: Json
          percentage?: number | null
          role?: Database["public"]["Enums"]["building_company_role"]
          source?: string | null
          updated_at?: string
        }
        Update: {
          building_id?: string
          company_id?: string
          created_at?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          metadatos?: Json
          percentage?: number | null
          role?: Database["public"]["Enums"]["building_company_role"]
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_companies_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      building_owners: {
        Row: {
          building_id: string
          created_at: string
          cuota: number | null
          es_influencer: boolean
          influencer_reason: string | null
          influencer_score: number | null
          metadatos: Json
          owner_id: string
          rol_notas: string | null
          subrole: Database["public"]["Enums"]["owner_subrole"]
        }
        Insert: {
          building_id: string
          created_at?: string
          cuota?: number | null
          es_influencer?: boolean
          influencer_reason?: string | null
          influencer_score?: number | null
          metadatos?: Json
          owner_id: string
          rol_notas?: string | null
          subrole?: Database["public"]["Enums"]["owner_subrole"]
        }
        Update: {
          building_id?: string
          created_at?: string
          cuota?: number | null
          es_influencer?: boolean
          influencer_reason?: string | null
          influencer_score?: number | null
          metadatos?: Json
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
          last_synced_at: string | null
          metadatos: Json
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
          last_synced_at?: string | null
          metadatos?: Json
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
          last_synced_at?: string | null
          metadatos?: Json
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
          analisis_confianza: number | null
          analyzed_at: string | null
          comercial_email: string | null
          comercial_hs_id: string | null
          comercial_nombre: string | null
          created_at: string
          direccion: Database["public"]["Enums"]["call_direction"]
          duracion_seg: number | null
          fecha: string
          frases_clave_negativas: string[] | null
          frases_clave_positivas: string[] | null
          id: string
          metadatos: Json
          notas_post_llamada: string | null
          objeciones: string[] | null
          outcome: string | null
          owner_id: string | null
          pivot_moments: Json
          preguntas_abiertas: number | null
          preguntas_cerradas: number | null
          ratio_comercial_cliente: number | null
          resumen: string | null
          sentiment: string | null
          siguiente_accion: string | null
          tacticas_usadas: string[]
          tecnica_score: number | null
          transcripcion: string | null
          transcripcion_source: string | null
          transcripcion_url: string | null
        }
        Insert: {
          analisis_confianza?: number | null
          analyzed_at?: string | null
          comercial_email?: string | null
          comercial_hs_id?: string | null
          comercial_nombre?: string | null
          created_at?: string
          direccion?: Database["public"]["Enums"]["call_direction"]
          duracion_seg?: number | null
          fecha?: string
          frases_clave_negativas?: string[] | null
          frases_clave_positivas?: string[] | null
          id?: string
          metadatos?: Json
          notas_post_llamada?: string | null
          objeciones?: string[] | null
          outcome?: string | null
          owner_id?: string | null
          pivot_moments?: Json
          preguntas_abiertas?: number | null
          preguntas_cerradas?: number | null
          ratio_comercial_cliente?: number | null
          resumen?: string | null
          sentiment?: string | null
          siguiente_accion?: string | null
          tacticas_usadas?: string[]
          tecnica_score?: number | null
          transcripcion?: string | null
          transcripcion_source?: string | null
          transcripcion_url?: string | null
        }
        Update: {
          analisis_confianza?: number | null
          analyzed_at?: string | null
          comercial_email?: string | null
          comercial_hs_id?: string | null
          comercial_nombre?: string | null
          created_at?: string
          direccion?: Database["public"]["Enums"]["call_direction"]
          duracion_seg?: number | null
          fecha?: string
          frases_clave_negativas?: string[] | null
          frases_clave_positivas?: string[] | null
          id?: string
          metadatos?: Json
          notas_post_llamada?: string | null
          objeciones?: string[] | null
          outcome?: string | null
          owner_id?: string | null
          pivot_moments?: Json
          preguntas_abiertas?: number | null
          preguntas_cerradas?: number | null
          ratio_comercial_cliente?: number | null
          resumen?: string | null
          sentiment?: string | null
          siguiente_accion?: string | null
          tacticas_usadas?: string[]
          tecnica_score?: number | null
          transcripcion?: string | null
          transcripcion_source?: string | null
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
      coach_reports: {
        Row: {
          comercial_hs_id: string | null
          fortalezas: Json
          frases_ganadoras: string[]
          generated_at: string
          id: string
          mejoras: Json
          metricas: Json
          owner_id: string
          plan_accion: Json
          total_calls: number | null
          week_end: string
          week_start: string
        }
        Insert: {
          comercial_hs_id?: string | null
          fortalezas?: Json
          frases_ganadoras?: string[]
          generated_at?: string
          id?: string
          mejoras?: Json
          metricas?: Json
          owner_id: string
          plan_accion?: Json
          total_calls?: number | null
          week_end: string
          week_start: string
        }
        Update: {
          comercial_hs_id?: string | null
          fortalezas?: Json
          frases_ganadoras?: string[]
          generated_at?: string
          id?: string
          mejoras?: Json
          metricas?: Json
          owner_id?: string
          plan_accion?: Json
          total_calls?: number | null
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          buyer_persona: Database["public"]["Enums"]["buyer_persona"]
          cif: string | null
          consentimiento: boolean
          created_at: string
          email: string | null
          id: string
          last_synced_at: string | null
          metadatos: Json
          nombre: string
          notas: string | null
          telefono: string | null
          updated_at: string
        }
        Insert: {
          buyer_persona?: Database["public"]["Enums"]["buyer_persona"]
          cif?: string | null
          consentimiento?: boolean
          created_at?: string
          email?: string | null
          id?: string
          last_synced_at?: string | null
          metadatos?: Json
          nombre: string
          notas?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          buyer_persona?: Database["public"]["Enums"]["buyer_persona"]
          cif?: string | null
          consentimiento?: boolean
          created_at?: string
          email?: string | null
          id?: string
          last_synced_at?: string | null
          metadatos?: Json
          nombre?: string
          notas?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Relationships: []
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
      external_ids: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadatos: Json
          provider: string
          provider_id: string
          provider_object_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadatos?: Json
          provider: string
          provider_id: string
          provider_object_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadatos?: Json
          provider?: string
          provider_id?: string
          provider_object_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      hubspot_calls: {
        Row: {
          associated_contact_ids: string[] | null
          associated_deal_ids: string[] | null
          created_at: string
          hs_call_body: string | null
          hs_call_direction: string | null
          hs_call_disposition: string | null
          hs_call_duration: number | null
          hs_call_from_number: string | null
          hs_call_recording_url: string | null
          hs_call_status: string | null
          hs_call_title: string | null
          hs_call_to_number: string | null
          hs_createdate: string | null
          hs_id: string
          hs_lastmodifieddate: string | null
          hs_owner_id: string | null
          hs_timestamp: string | null
          id: string
          raw: Json
          updated_at: string
        }
        Insert: {
          associated_contact_ids?: string[] | null
          associated_deal_ids?: string[] | null
          created_at?: string
          hs_call_body?: string | null
          hs_call_direction?: string | null
          hs_call_disposition?: string | null
          hs_call_duration?: number | null
          hs_call_from_number?: string | null
          hs_call_recording_url?: string | null
          hs_call_status?: string | null
          hs_call_title?: string | null
          hs_call_to_number?: string | null
          hs_createdate?: string | null
          hs_id: string
          hs_lastmodifieddate?: string | null
          hs_owner_id?: string | null
          hs_timestamp?: string | null
          id?: string
          raw?: Json
          updated_at?: string
        }
        Update: {
          associated_contact_ids?: string[] | null
          associated_deal_ids?: string[] | null
          created_at?: string
          hs_call_body?: string | null
          hs_call_direction?: string | null
          hs_call_disposition?: string | null
          hs_call_duration?: number | null
          hs_call_from_number?: string | null
          hs_call_recording_url?: string | null
          hs_call_status?: string | null
          hs_call_title?: string | null
          hs_call_to_number?: string | null
          hs_createdate?: string | null
          hs_id?: string
          hs_lastmodifieddate?: string | null
          hs_owner_id?: string | null
          hs_timestamp?: string | null
          id?: string
          raw?: Json
          updated_at?: string
        }
        Relationships: []
      }
      hubspot_changes_log: {
        Row: {
          entity_type: string
          field: string
          hs_id: string
          id: string
          new_value: string | null
          observed_at: string
          old_value: string | null
          sync_run_id: string | null
        }
        Insert: {
          entity_type: string
          field: string
          hs_id: string
          id?: string
          new_value?: string | null
          observed_at?: string
          old_value?: string | null
          sync_run_id?: string | null
        }
        Update: {
          entity_type?: string
          field?: string
          hs_id?: string
          id?: string
          new_value?: string | null
          observed_at?: string
          old_value?: string | null
          sync_run_id?: string | null
        }
        Relationships: []
      }
      hubspot_communications: {
        Row: {
          associated_contact_ids: string[]
          associated_deal_ids: string[]
          created_at: string
          hs_communication_body: string | null
          hs_communication_channel_type: string | null
          hs_communication_logged_from: string | null
          hs_createdate: string | null
          hs_id: string
          hs_lastmodifieddate: string | null
          hs_owner_id: string | null
          hs_timestamp: string | null
          id: string
          raw: Json
          updated_at: string
        }
        Insert: {
          associated_contact_ids?: string[]
          associated_deal_ids?: string[]
          created_at?: string
          hs_communication_body?: string | null
          hs_communication_channel_type?: string | null
          hs_communication_logged_from?: string | null
          hs_createdate?: string | null
          hs_id: string
          hs_lastmodifieddate?: string | null
          hs_owner_id?: string | null
          hs_timestamp?: string | null
          id?: string
          raw?: Json
          updated_at?: string
        }
        Update: {
          associated_contact_ids?: string[]
          associated_deal_ids?: string[]
          created_at?: string
          hs_communication_body?: string | null
          hs_communication_channel_type?: string | null
          hs_communication_logged_from?: string | null
          hs_createdate?: string | null
          hs_id?: string
          hs_lastmodifieddate?: string | null
          hs_owner_id?: string | null
          hs_timestamp?: string | null
          id?: string
          raw?: Json
          updated_at?: string
        }
        Relationships: []
      }
      hubspot_list_memberships: {
        Row: {
          added_at: string | null
          hs_list_id: string
          object_type: string
          observed_at: string
          record_id: string
        }
        Insert: {
          added_at?: string | null
          hs_list_id: string
          object_type: string
          observed_at?: string
          record_id: string
        }
        Update: {
          added_at?: string | null
          hs_list_id?: string
          object_type?: string
          observed_at?: string
          record_id?: string
        }
        Relationships: []
      }
      hubspot_lists: {
        Row: {
          created_at: string
          created_at_hs: string | null
          hs_list_id: string
          id: string
          list_type: string | null
          name: string | null
          object_type_id: string | null
          processing_type: string | null
          raw: Json
          size: number | null
          updated_at: string
          updated_at_hs: string | null
        }
        Insert: {
          created_at?: string
          created_at_hs?: string | null
          hs_list_id: string
          id?: string
          list_type?: string | null
          name?: string | null
          object_type_id?: string | null
          processing_type?: string | null
          raw?: Json
          size?: number | null
          updated_at?: string
          updated_at_hs?: string | null
        }
        Update: {
          created_at?: string
          created_at_hs?: string | null
          hs_list_id?: string
          id?: string
          list_type?: string | null
          name?: string | null
          object_type_id?: string | null
          processing_type?: string | null
          raw?: Json
          size?: number | null
          updated_at?: string
          updated_at_hs?: string | null
        }
        Relationships: []
      }
      hubspot_notes: {
        Row: {
          associated_contact_ids: string[] | null
          associated_deal_ids: string[] | null
          created_at: string
          hs_createdate: string | null
          hs_id: string
          hs_lastmodifieddate: string | null
          hs_note_body: string | null
          hs_timestamp: string | null
          id: string
          raw: Json
          updated_at: string
        }
        Insert: {
          associated_contact_ids?: string[] | null
          associated_deal_ids?: string[] | null
          created_at?: string
          hs_createdate?: string | null
          hs_id: string
          hs_lastmodifieddate?: string | null
          hs_note_body?: string | null
          hs_timestamp?: string | null
          id?: string
          raw?: Json
          updated_at?: string
        }
        Update: {
          associated_contact_ids?: string[] | null
          associated_deal_ids?: string[] | null
          created_at?: string
          hs_createdate?: string | null
          hs_id?: string
          hs_lastmodifieddate?: string | null
          hs_note_body?: string | null
          hs_timestamp?: string | null
          id?: string
          raw?: Json
          updated_at?: string
        }
        Relationships: []
      }
      hubspot_owners: {
        Row: {
          archived: boolean
          created_at: string
          email: string | null
          first_name: string | null
          full_name: string | null
          hs_owner_id: string
          last_name: string | null
          raw: Json
          synced_at: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          hs_owner_id: string
          last_name?: string | null
          raw?: Json
          synced_at?: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          hs_owner_id?: string
          last_name?: string | null
          raw?: Json
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      hubspot_snapshots: {
        Row: {
          entity_type: string
          id: string
          metrics: Json
          taken_at: string
          total_count: number
        }
        Insert: {
          entity_type: string
          id?: string
          metrics?: Json
          taken_at?: string
          total_count: number
        }
        Update: {
          entity_type?: string
          id?: string
          metrics?: Json
          taken_at?: string
          total_count?: number
        }
        Relationships: []
      }
      hubspot_sync_log: {
        Row: {
          created_at: string
          entity: string
          error_message: string | null
          finished_at: string | null
          id: string
          metadatos: Json
          pages_fetched: number
          records_failed: number
          records_upserted: number
          started_at: string
          status: string
        }
        Insert: {
          created_at?: string
          entity: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadatos?: Json
          pages_fetched?: number
          records_failed?: number
          records_upserted?: number
          started_at?: string
          status?: string
        }
        Update: {
          created_at?: string
          entity?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadatos?: Json
          pages_fetched?: number
          records_failed?: number
          records_upserted?: number
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      hubspot_sync_state: {
        Row: {
          created_at: string
          cursor: string | null
          entity: string
          id: string
          last_error: string | null
          last_full_sync_at: string | null
          last_run_at: string | null
          last_run_status: string | null
          metadatos: Json
          total_synced: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          cursor?: string | null
          entity: string
          id?: string
          last_error?: string | null
          last_full_sync_at?: string | null
          last_run_at?: string | null
          last_run_status?: string | null
          metadatos?: Json
          total_synced?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          cursor?: string | null
          entity?: string
          id?: string
          last_error?: string | null
          last_full_sync_at?: string | null
          last_run_at?: string | null
          last_run_status?: string | null
          metadatos?: Json
          total_synced?: number
          updated_at?: string
        }
        Relationships: []
      }
      hubspot_tasks: {
        Row: {
          associated_contact_ids: string[] | null
          associated_deal_ids: string[] | null
          created_at: string
          hs_createdate: string | null
          hs_id: string
          hs_lastmodifieddate: string | null
          hs_task_body: string | null
          hs_task_completion_date: string | null
          hs_task_priority: string | null
          hs_task_status: string | null
          hs_task_subject: string | null
          hs_task_type: string | null
          hs_timestamp: string | null
          id: string
          raw: Json
          updated_at: string
        }
        Insert: {
          associated_contact_ids?: string[] | null
          associated_deal_ids?: string[] | null
          created_at?: string
          hs_createdate?: string | null
          hs_id: string
          hs_lastmodifieddate?: string | null
          hs_task_body?: string | null
          hs_task_completion_date?: string | null
          hs_task_priority?: string | null
          hs_task_status?: string | null
          hs_task_subject?: string | null
          hs_task_type?: string | null
          hs_timestamp?: string | null
          id?: string
          raw?: Json
          updated_at?: string
        }
        Update: {
          associated_contact_ids?: string[] | null
          associated_deal_ids?: string[] | null
          created_at?: string
          hs_createdate?: string | null
          hs_id?: string
          hs_lastmodifieddate?: string | null
          hs_task_body?: string | null
          hs_task_completion_date?: string | null
          hs_task_priority?: string | null
          hs_task_status?: string | null
          hs_task_subject?: string | null
          hs_task_type?: string | null
          hs_timestamp?: string | null
          id?: string
          raw?: Json
          updated_at?: string
        }
        Relationships: []
      }
      hubspot_whatsapp: {
        Row: {
          associated_contact_ids: string[]
          associated_deal_ids: string[]
          created_at: string
          hs_communication_body: string | null
          hs_communication_channel_type: string | null
          hs_communication_logged_from: string | null
          hs_createdate: string | null
          hs_id: string
          hs_lastmodifieddate: string | null
          hs_owner_id: string | null
          hs_timestamp: string | null
          id: string
          raw: Json
          updated_at: string
        }
        Insert: {
          associated_contact_ids?: string[]
          associated_deal_ids?: string[]
          created_at?: string
          hs_communication_body?: string | null
          hs_communication_channel_type?: string | null
          hs_communication_logged_from?: string | null
          hs_createdate?: string | null
          hs_id: string
          hs_lastmodifieddate?: string | null
          hs_owner_id?: string | null
          hs_timestamp?: string | null
          id?: string
          raw?: Json
          updated_at?: string
        }
        Update: {
          associated_contact_ids?: string[]
          associated_deal_ids?: string[]
          created_at?: string
          hs_communication_body?: string | null
          hs_communication_channel_type?: string | null
          hs_communication_logged_from?: string | null
          hs_createdate?: string | null
          hs_id?: string
          hs_lastmodifieddate?: string | null
          hs_owner_id?: string | null
          hs_timestamp?: string | null
          id?: string
          raw?: Json
          updated_at?: string
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
          scope_id: string | null
          scope_type: string | null
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
          scope_id?: string | null
          scope_type?: string | null
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
          scope_id?: string | null
          scope_type?: string | null
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
      nota_simple_titulares: {
        Row: {
          cif_dni: string | null
          company_id: string | null
          created_at: string
          id: string
          metadatos: Json
          nombre_extraido: string | null
          nota_simple_id: string
          owner_id: string | null
          porcentaje: number | null
          rol: Database["public"]["Enums"]["nota_titular_rol"]
          updated_at: string
        }
        Insert: {
          cif_dni?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          metadatos?: Json
          nombre_extraido?: string | null
          nota_simple_id: string
          owner_id?: string | null
          porcentaje?: number | null
          rol?: Database["public"]["Enums"]["nota_titular_rol"]
          updated_at?: string
        }
        Update: {
          cif_dni?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          metadatos?: Json
          nombre_extraido?: string | null
          nota_simple_id?: string
          owner_id?: string | null
          porcentaje?: number | null
          rol?: Database["public"]["Enums"]["nota_titular_rol"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nota_simple_titulares_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nota_simple_titulares_nota_simple_id_fkey"
            columns: ["nota_simple_id"]
            isOneToOne: false
            referencedRelation: "notas_simples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nota_simple_titulares_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      notas_simples: {
        Row: {
          building_id: string | null
          created_at: string
          error_message: string | null
          file_url: string | null
          id: string
          owner_id: string | null
          processed_at: string | null
          raw_pdf_text: string | null
          riesgo: string | null
          status: string
          structured_json: Json | null
        }
        Insert: {
          building_id?: string | null
          created_at?: string
          error_message?: string | null
          file_url?: string | null
          id?: string
          owner_id?: string | null
          processed_at?: string | null
          raw_pdf_text?: string | null
          riesgo?: string | null
          status?: string
          structured_json?: Json | null
        }
        Update: {
          building_id?: string | null
          created_at?: string
          error_message?: string | null
          file_url?: string | null
          id?: string
          owner_id?: string | null
          processed_at?: string | null
          raw_pdf_text?: string | null
          riesgo?: string | null
          status?: string
          structured_json?: Json | null
        }
        Relationships: []
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
      owner_companies: {
        Row: {
          company_id: string
          created_at: string
          id: string
          metadatos: Json
          owner_id: string
          percentage: number | null
          role: Database["public"]["Enums"]["owner_company_role"]
          source: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          metadatos?: Json
          owner_id: string
          percentage?: number | null
          role: Database["public"]["Enums"]["owner_company_role"]
          source?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          metadatos?: Json
          owner_id?: string
          percentage?: number | null
          role?: Database["public"]["Enums"]["owner_company_role"]
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_companies_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_relations: {
        Row: {
          created_at: string
          id: string
          metadatos: Json
          notes: string | null
          owner_a_id: string
          owner_b_id: string
          percentage: number | null
          relation_type: Database["public"]["Enums"]["owner_relation_type"]
          source: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadatos?: Json
          notes?: string | null
          owner_a_id: string
          owner_b_id: string
          percentage?: number | null
          relation_type: Database["public"]["Enums"]["owner_relation_type"]
          source?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          metadatos?: Json
          notes?: string | null
          owner_a_id?: string
          owner_b_id?: string
          percentage?: number | null
          relation_type?: Database["public"]["Enums"]["owner_relation_type"]
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_relations_owner_a_id_fkey"
            columns: ["owner_a_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_relations_owner_b_id_fkey"
            columns: ["owner_b_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      owners: {
        Row: {
          buyer_persona: Database["public"]["Enums"]["buyer_persona"]
          consentimiento: boolean
          created_at: string
          email: string | null
          id: string
          last_synced_at: string | null
          metadatos: Json
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
          buyer_persona?: Database["public"]["Enums"]["buyer_persona"]
          consentimiento?: boolean
          created_at?: string
          email?: string | null
          id?: string
          last_synced_at?: string | null
          metadatos?: Json
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
          buyer_persona?: Database["public"]["Enums"]["buyer_persona"]
          consentimiento?: boolean
          created_at?: string
          email?: string | null
          id?: string
          last_synced_at?: string | null
          metadatos?: Json
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          building_id: string | null
          created_at: string
          cuerpo: string
          direccion: string | null
          enviado_at: string | null
          hs_id: string | null
          hubspot_owner_id: string | null
          id: string
          metadatos: Json
          owner_id: string | null
          programado_para: string | null
          status: Database["public"]["Enums"]["whatsapp_status"]
        }
        Insert: {
          building_id?: string | null
          created_at?: string
          cuerpo: string
          direccion?: string | null
          enviado_at?: string | null
          hs_id?: string | null
          hubspot_owner_id?: string | null
          id?: string
          metadatos?: Json
          owner_id?: string | null
          programado_para?: string | null
          status?: Database["public"]["Enums"]["whatsapp_status"]
        }
        Update: {
          building_id?: string | null
          created_at?: string
          cuerpo?: string
          direccion?: string | null
          enviado_at?: string | null
          hs_id?: string | null
          hubspot_owner_id?: string | null
          id?: string
          metadatos?: Json
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
      v_propietarios: {
        Row: {
          buyer_persona: string | null
          cif: string | null
          consentimiento: boolean | null
          email: string | null
          id: string | null
          nombre: string | null
          telefono: string | null
          tipo: string | null
          updated_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      calls_stats: {
        Args: never
        Returns: {
          analizables: number
          avg_duracion: number
          sin_transcripcion: number
          total: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
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
      notas_simples_kpis: {
        Args: {
          p_building_id?: string
          p_divisible?: string
          p_from?: string
          p_owner_id?: string
          p_riesgo?: string
          p_search?: string
          p_status?: string
          p_tipo_carga?: string
          p_to?: string
        }
        Returns: {
          importe_cargas: number
          listas: number
          riesgo_alto: number
          sin_edificio: number
          total: number
        }[]
      }
      notas_simples_search: {
        Args: {
          p_building_id?: string
          p_divisible?: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_owner_id?: string
          p_riesgo?: string
          p_search?: string
          p_status?: string
          p_tipo_carga?: string
          p_to?: string
        }
        Returns: {
          building_ciudad: string
          building_direccion: string
          building_id: string
          created_at: string
          error_message: string
          file_url: string
          id: string
          owner_id: string
          owner_nombre: string
          processed_at: string
          riesgo: string
          status: string
          structured_json: Json
          total_count: number
        }[]
      }
      rpc_inversores_paginated: {
        Args: { p_limit?: number; p_offset?: number; p_search?: string }
        Returns: {
          email: string
          id: string
          metadatos: Json
          nombre: string
          telefono: string
          total_count: number
          updated_at: string
        }[]
      }
      rpc_rag_search: {
        Args: {
          filter_origen?: string
          filter_scope_id?: string
          filter_scope_type?: string
          match_count?: number
          query_embedding?: string
          query_text: string
        }
        Returns: {
          contenido: string
          fts_rank: number
          hybrid_score: number
          id: string
          metadatos: Json
          origen: string
          referencia_id: string
          scope_id: string
          scope_type: string
          similarity: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "agent" | "viewer"
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
      building_company_role:
        | "titular"
        | "usufructuario"
        | "banco_acreedor"
        | "arrendador"
        | "otro"
      building_status:
        | "identificado"
        | "contactado"
        | "en_estudio"
        | "descartado"
      buyer_persona:
        | "cansado"
        | "desplazado"
        | "controla"
        | "ego"
        | "no_traspasa"
        | "vive_edificio"
        | "no_primero"
        | "sin_clasificar"
      cadence_step_kind: "llamada" | "whatsapp" | "email" | "visita"
      call_direction: "entrante" | "saliente"
      compliance_status: "pendiente" | "aprobado" | "rechazado"
      match_status: "propuesto" | "aprobado" | "rechazado" | "contactado"
      next_action_status: "pendiente" | "completada" | "cancelada"
      nota_titular_rol: "pleno" | "usufructo" | "nuda_propiedad" | "otro"
      owner_company_role:
        | "socio"
        | "administrador"
        | "apoderado"
        | "empleado"
        | "titular_via_sociedad"
      owner_relation_type:
        | "heredero_de"
        | "conyuge_de"
        | "representante_de"
        | "apoderado_de"
        | "padre_de"
        | "socio_de"
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
      app_role: ["admin", "manager", "agent", "viewer"],
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
      building_company_role: [
        "titular",
        "usufructuario",
        "banco_acreedor",
        "arrendador",
        "otro",
      ],
      building_status: [
        "identificado",
        "contactado",
        "en_estudio",
        "descartado",
      ],
      buyer_persona: [
        "cansado",
        "desplazado",
        "controla",
        "ego",
        "no_traspasa",
        "vive_edificio",
        "no_primero",
        "sin_clasificar",
      ],
      cadence_step_kind: ["llamada", "whatsapp", "email", "visita"],
      call_direction: ["entrante", "saliente"],
      compliance_status: ["pendiente", "aprobado", "rechazado"],
      match_status: ["propuesto", "aprobado", "rechazado", "contactado"],
      next_action_status: ["pendiente", "completada", "cancelada"],
      nota_titular_rol: ["pleno", "usufructo", "nuda_propiedad", "otro"],
      owner_company_role: [
        "socio",
        "administrador",
        "apoderado",
        "empleado",
        "titular_via_sociedad",
      ],
      owner_relation_type: [
        "heredero_de",
        "conyuge_de",
        "representante_de",
        "apoderado_de",
        "padre_de",
        "socio_de",
      ],
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
