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
      _fn_backups: {
        Row: {
          created_at: string | null
          definition: string | null
          fn_name: string | null
          id: number
          note: string | null
        }
        Insert: {
          created_at?: string | null
          definition?: string | null
          fn_name?: string | null
          id?: number
          note?: string | null
        }
        Update: {
          created_at?: string | null
          definition?: string | null
          fn_name?: string | null
          id?: number
          note?: string | null
        }
        Relationships: []
      }
      _p0_snapshot: {
        Row: {
          cluster_antes: string | null
          direccion: string | null
          flag_antes: boolean | null
          id: string | null
          score_antes: number | null
        }
        Insert: {
          cluster_antes?: string | null
          direccion?: string | null
          flag_antes?: boolean | null
          id?: string | null
          score_antes?: number | null
        }
        Update: {
          cluster_antes?: string | null
          direccion?: string | null
          flag_antes?: boolean | null
          id?: string | null
          score_antes?: number | null
        }
        Relationships: []
      }
      agent_attempts: {
        Row: {
          agente: string | null
          created_at: string | null
          enfoque: string
          hipotesis: string | null
          id: number
          notas_validador: string | null
          paso_validacion: boolean | null
          prior_art: string | null
          problem_id: number | null
          resultado: string | null
        }
        Insert: {
          agente?: string | null
          created_at?: string | null
          enfoque: string
          hipotesis?: string | null
          id?: number
          notas_validador?: string | null
          paso_validacion?: boolean | null
          prior_art?: string | null
          problem_id?: number | null
          resultado?: string | null
        }
        Update: {
          agente?: string | null
          created_at?: string | null
          enfoque?: string
          hipotesis?: string | null
          id?: number
          notas_validador?: string | null
          paso_validacion?: boolean | null
          prior_art?: string | null
          problem_id?: number | null
          resultado?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_attempts_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "agent_problem_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_ground_truth: {
        Row: {
          building_id: string | null
          catalogo: string | null
          created_at: string | null
          direccion: string | null
          dominio: string
          fuente: string | null
          id: number
          manzana: string | null
          nota: string | null
          valor_verdad: number | null
        }
        Insert: {
          building_id?: string | null
          catalogo?: string | null
          created_at?: string | null
          direccion?: string | null
          dominio: string
          fuente?: string | null
          id?: number
          manzana?: string | null
          nota?: string | null
          valor_verdad?: number | null
        }
        Update: {
          building_id?: string | null
          catalogo?: string | null
          created_at?: string | null
          direccion?: string | null
          dominio?: string
          fuente?: string | null
          id?: number
          manzana?: string | null
          nota?: string | null
          valor_verdad?: number | null
        }
        Relationships: []
      }
      agent_problem_ledger: {
        Row: {
          created_at: string | null
          criterio_exito: string
          definicion: string
          estado: string
          id: number
          titulo: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          criterio_exito: string
          definicion: string
          estado?: string
          id?: number
          titulo: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          criterio_exito?: string
          definicion?: string
          estado?: string
          id?: number
          titulo?: string
          updated_at?: string | null
        }
        Relationships: []
      }
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
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
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
            foreignKeyName: "assets_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "assets_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "assets_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "assets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "assets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "assets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
          },
        ]
      }
      backup_q4_building_owners: {
        Row: {
          building_id: string | null
          created_at: string | null
          cuota: number | null
          es_influencer: boolean | null
          influencer_reason: string | null
          influencer_score: number | null
          metadatos: Json | null
          owner_id: string | null
          owner_name_norm: string | null
          rol_notas: string | null
          subrole: Database["public"]["Enums"]["owner_subrole"] | null
        }
        Insert: {
          building_id?: string | null
          created_at?: string | null
          cuota?: number | null
          es_influencer?: boolean | null
          influencer_reason?: string | null
          influencer_score?: number | null
          metadatos?: Json | null
          owner_id?: string | null
          owner_name_norm?: string | null
          rol_notas?: string | null
          subrole?: Database["public"]["Enums"]["owner_subrole"] | null
        }
        Update: {
          building_id?: string | null
          created_at?: string | null
          cuota?: number | null
          es_influencer?: boolean | null
          influencer_reason?: string | null
          influencer_score?: number | null
          metadatos?: Json | null
          owner_id?: string | null
          owner_name_norm?: string | null
          rol_notas?: string | null
          subrole?: Database["public"]["Enums"]["owner_subrole"] | null
        }
        Relationships: []
      }
      backup_q4_buildings: {
        Row: {
          avisos_inteligentes: Json | null
          cartera_demo_seed: boolean | null
          catastro_ref: string | null
          ciudad: string | null
          cluster_asignado: string | null
          cluster_breakdown: Json | null
          cluster_motivo: string | null
          cluster_score: number | null
          codigo_postal: string | null
          comercial: string | null
          confianza_media: number | null
          created_at: string | null
          direccion: string | null
          division_horizontal: boolean | null
          es_esquina_manual: boolean | null
          es_estrella: boolean | null
          estado: Database["public"]["Enums"]["building_status"] | null
          grupo_barrio: string | null
          hs_deal_id: string | null
          id: string | null
          iee_actualizado_at: string | null
          iee_deficiencias: Json | null
          iee_estado: Database["public"]["Enums"]["iee_estado"] | null
          iee_fecha_inspeccion: string | null
          iee_fuente: string | null
          iee_proxima_revision: string | null
          last_synced_at: string | null
          metadatos: Json | null
          notas: string | null
          numero_propietarios: number | null
          pct_terciario: number | null
          refcatastral: string | null
          score: number | null
          score_breakdown: Json | null
          score_summary: string | null
          score_updated_at: string | null
          updated_at: string | null
        }
        Insert: {
          avisos_inteligentes?: Json | null
          cartera_demo_seed?: boolean | null
          catastro_ref?: string | null
          ciudad?: string | null
          cluster_asignado?: string | null
          cluster_breakdown?: Json | null
          cluster_motivo?: string | null
          cluster_score?: number | null
          codigo_postal?: string | null
          comercial?: string | null
          confianza_media?: number | null
          created_at?: string | null
          direccion?: string | null
          division_horizontal?: boolean | null
          es_esquina_manual?: boolean | null
          es_estrella?: boolean | null
          estado?: Database["public"]["Enums"]["building_status"] | null
          grupo_barrio?: string | null
          hs_deal_id?: string | null
          id?: string | null
          iee_actualizado_at?: string | null
          iee_deficiencias?: Json | null
          iee_estado?: Database["public"]["Enums"]["iee_estado"] | null
          iee_fecha_inspeccion?: string | null
          iee_fuente?: string | null
          iee_proxima_revision?: string | null
          last_synced_at?: string | null
          metadatos?: Json | null
          notas?: string | null
          numero_propietarios?: number | null
          pct_terciario?: number | null
          refcatastral?: string | null
          score?: number | null
          score_breakdown?: Json | null
          score_summary?: string | null
          score_updated_at?: string | null
          updated_at?: string | null
        }
        Update: {
          avisos_inteligentes?: Json | null
          cartera_demo_seed?: boolean | null
          catastro_ref?: string | null
          ciudad?: string | null
          cluster_asignado?: string | null
          cluster_breakdown?: Json | null
          cluster_motivo?: string | null
          cluster_score?: number | null
          codigo_postal?: string | null
          comercial?: string | null
          confianza_media?: number | null
          created_at?: string | null
          direccion?: string | null
          division_horizontal?: boolean | null
          es_esquina_manual?: boolean | null
          es_estrella?: boolean | null
          estado?: Database["public"]["Enums"]["building_status"] | null
          grupo_barrio?: string | null
          hs_deal_id?: string | null
          id?: string | null
          iee_actualizado_at?: string | null
          iee_deficiencias?: Json | null
          iee_estado?: Database["public"]["Enums"]["iee_estado"] | null
          iee_fecha_inspeccion?: string | null
          iee_fuente?: string | null
          iee_proxima_revision?: string | null
          last_synced_at?: string | null
          metadatos?: Json | null
          notas?: string | null
          numero_propietarios?: number | null
          pct_terciario?: number | null
          refcatastral?: string | null
          score?: number | null
          score_breakdown?: Json | null
          score_summary?: string | null
          score_updated_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      building_analysis: {
        Row: {
          accesos_codigos: Json | null
          analysis_duration_ms: number | null
          analyze_error: string | null
          analyzed_at: string | null
          anotaciones_plano: Json | null
          aviso_ventanas: string | null
          building_id: string
          calles_frente_visor: Json | null
          confidence: number | null
          confidence_ventanas: number | null
          created_at: string
          densidad_ventanas_fachada: number | null
          edificio_reformado: boolean | null
          es_esquina_visor: boolean | null
          escaleras_needs_review: boolean
          escaleras_visor_at: string | null
          escaleras_visor_catalogo: string | null
          escaleras_visor_confianza: number | null
          escaleras_visor_grado: string | null
          escaleras_visor_raw: Json | null
          escaleras_visor_source: string | null
          esquina: boolean | null
          esquina_needs_review: boolean
          esquina_visor_confianza: number | null
          fachada_lineal_total_m: number | null
          formula_ventanas_patio: string | null
          gestion_profesional: boolean | null
          id: string
          llm_raw_response: Json | null
          local_pb_esquina: boolean | null
          local_pb_fachada_m: number | null
          local_pb_m2: number | null
          local_pb_tipo_calle: string | null
          local_pb_viviendas_potenciales: number | null
          mala_gestion_evidencias: Json | null
          mala_gestion_score: number | null
          metricas_detalle: Json | null
          metricas_extra: Json | null
          modelo_fallback: boolean | null
          modelo_usado: string | null
          n_almacenes_sotano: number | null
          n_escaleras_en_piso01: number | null
          n_escaleras_en_planta_baja: number | null
          n_escaleras_evidencia: Json | null
          n_escaleras_final: number | null
          n_escaleras_fuente: string | null
          n_escaleras_visor: number | null
          n_locales_planta_baja: number | null
          patios_codigos: Json | null
          patios_detectados: number | null
          plano_render_url: string | null
          plantas_levantables: number | null
          plantas_levantables_requiere_humano: boolean
          plantas_max_normativa: number | null
          plantas_visibles: number | null
          proteccion_source: string | null
          protegido_historicamente: boolean | null
          protegido_raw: Json | null
          second_staircase_confirmed: boolean | null
          second_staircase_confirmed_at: string | null
          second_staircase_confirmed_source: string | null
          segundas_escaleras: boolean | null
          sources_used: Json | null
          tiene_azotea_transitable: boolean | null
          tiene_sotano: boolean | null
          updated_at: string
          ventanas_fachada_needs_review: boolean
          ventanas_fachada_total: number | null
          ventanas_patios_desglose: Json | null
          ventanas_patios_estimadas: number | null
          ventanas_patios_por_patio: Json | null
          ventanas_patios_por_planta: Json | null
          ventanas_patios_total: number | null
          ventanas_por_planta: Json | null
          viviendas_por_planta_tipo: number | null
        }
        Insert: {
          accesos_codigos?: Json | null
          analysis_duration_ms?: number | null
          analyze_error?: string | null
          analyzed_at?: string | null
          anotaciones_plano?: Json | null
          aviso_ventanas?: string | null
          building_id: string
          calles_frente_visor?: Json | null
          confidence?: number | null
          confidence_ventanas?: number | null
          created_at?: string
          densidad_ventanas_fachada?: number | null
          edificio_reformado?: boolean | null
          es_esquina_visor?: boolean | null
          escaleras_needs_review?: boolean
          escaleras_visor_at?: string | null
          escaleras_visor_catalogo?: string | null
          escaleras_visor_confianza?: number | null
          escaleras_visor_grado?: string | null
          escaleras_visor_raw?: Json | null
          escaleras_visor_source?: string | null
          esquina?: boolean | null
          esquina_needs_review?: boolean
          esquina_visor_confianza?: number | null
          fachada_lineal_total_m?: number | null
          formula_ventanas_patio?: string | null
          gestion_profesional?: boolean | null
          id?: string
          llm_raw_response?: Json | null
          local_pb_esquina?: boolean | null
          local_pb_fachada_m?: number | null
          local_pb_m2?: number | null
          local_pb_tipo_calle?: string | null
          local_pb_viviendas_potenciales?: number | null
          mala_gestion_evidencias?: Json | null
          mala_gestion_score?: number | null
          metricas_detalle?: Json | null
          metricas_extra?: Json | null
          modelo_fallback?: boolean | null
          modelo_usado?: string | null
          n_almacenes_sotano?: number | null
          n_escaleras_en_piso01?: number | null
          n_escaleras_en_planta_baja?: number | null
          n_escaleras_evidencia?: Json | null
          n_escaleras_final?: number | null
          n_escaleras_fuente?: string | null
          n_escaleras_visor?: number | null
          n_locales_planta_baja?: number | null
          patios_codigos?: Json | null
          patios_detectados?: number | null
          plano_render_url?: string | null
          plantas_levantables?: number | null
          plantas_levantables_requiere_humano?: boolean
          plantas_max_normativa?: number | null
          plantas_visibles?: number | null
          proteccion_source?: string | null
          protegido_historicamente?: boolean | null
          protegido_raw?: Json | null
          second_staircase_confirmed?: boolean | null
          second_staircase_confirmed_at?: string | null
          second_staircase_confirmed_source?: string | null
          segundas_escaleras?: boolean | null
          sources_used?: Json | null
          tiene_azotea_transitable?: boolean | null
          tiene_sotano?: boolean | null
          updated_at?: string
          ventanas_fachada_needs_review?: boolean
          ventanas_fachada_total?: number | null
          ventanas_patios_desglose?: Json | null
          ventanas_patios_estimadas?: number | null
          ventanas_patios_por_patio?: Json | null
          ventanas_patios_por_planta?: Json | null
          ventanas_patios_total?: number | null
          ventanas_por_planta?: Json | null
          viviendas_por_planta_tipo?: number | null
        }
        Update: {
          accesos_codigos?: Json | null
          analysis_duration_ms?: number | null
          analyze_error?: string | null
          analyzed_at?: string | null
          anotaciones_plano?: Json | null
          aviso_ventanas?: string | null
          building_id?: string
          calles_frente_visor?: Json | null
          confidence?: number | null
          confidence_ventanas?: number | null
          created_at?: string
          densidad_ventanas_fachada?: number | null
          edificio_reformado?: boolean | null
          es_esquina_visor?: boolean | null
          escaleras_needs_review?: boolean
          escaleras_visor_at?: string | null
          escaleras_visor_catalogo?: string | null
          escaleras_visor_confianza?: number | null
          escaleras_visor_grado?: string | null
          escaleras_visor_raw?: Json | null
          escaleras_visor_source?: string | null
          esquina?: boolean | null
          esquina_needs_review?: boolean
          esquina_visor_confianza?: number | null
          fachada_lineal_total_m?: number | null
          formula_ventanas_patio?: string | null
          gestion_profesional?: boolean | null
          id?: string
          llm_raw_response?: Json | null
          local_pb_esquina?: boolean | null
          local_pb_fachada_m?: number | null
          local_pb_m2?: number | null
          local_pb_tipo_calle?: string | null
          local_pb_viviendas_potenciales?: number | null
          mala_gestion_evidencias?: Json | null
          mala_gestion_score?: number | null
          metricas_detalle?: Json | null
          metricas_extra?: Json | null
          modelo_fallback?: boolean | null
          modelo_usado?: string | null
          n_almacenes_sotano?: number | null
          n_escaleras_en_piso01?: number | null
          n_escaleras_en_planta_baja?: number | null
          n_escaleras_evidencia?: Json | null
          n_escaleras_final?: number | null
          n_escaleras_fuente?: string | null
          n_escaleras_visor?: number | null
          n_locales_planta_baja?: number | null
          patios_codigos?: Json | null
          patios_detectados?: number | null
          plano_render_url?: string | null
          plantas_levantables?: number | null
          plantas_levantables_requiere_humano?: boolean
          plantas_max_normativa?: number | null
          plantas_visibles?: number | null
          proteccion_source?: string | null
          protegido_historicamente?: boolean | null
          protegido_raw?: Json | null
          second_staircase_confirmed?: boolean | null
          second_staircase_confirmed_at?: string | null
          second_staircase_confirmed_source?: string | null
          segundas_escaleras?: boolean | null
          sources_used?: Json | null
          tiene_azotea_transitable?: boolean | null
          tiene_sotano?: boolean | null
          updated_at?: string
          ventanas_fachada_needs_review?: boolean
          ventanas_fachada_total?: number | null
          ventanas_patios_desglose?: Json | null
          ventanas_patios_estimadas?: number | null
          ventanas_patios_por_patio?: Json | null
          ventanas_patios_por_planta?: Json | null
          ventanas_patios_total?: number | null
          ventanas_por_planta?: Json | null
          viviendas_por_planta_tipo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "building_analysis_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_analysis_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_analysis_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_analysis_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_analysis_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
      }
      building_assignments: {
        Row: {
          assigned_at: string
          building_id: string
          created_by: string | null
          id: string
          status: Database["public"]["Enums"]["assignment_status"]
          user_id: string
        }
        Insert: {
          assigned_at?: string
          building_id: string
          created_by?: string | null
          id?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          user_id: string
        }
        Update: {
          assigned_at?: string
          building_id?: string
          created_by?: string | null
          id?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          user_id?: string
        }
        Relationships: []
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
            foreignKeyName: "building_companies_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_companies_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_companies_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_companies_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_company_graph"
            referencedColumns: ["company_id"]
          },
        ]
      }
      building_feedback: {
        Row: {
          analisis_ia: Json | null
          audio_url: string | null
          autor_email: string | null
          autor_id: string | null
          building_id: string
          canal: string
          created_at: string
          dimension: string | null
          estado: string
          id: string
          metadatos: Json
          override_aplicado: Json | null
          texto: string | null
          updated_at: string
        }
        Insert: {
          analisis_ia?: Json | null
          audio_url?: string | null
          autor_email?: string | null
          autor_id?: string | null
          building_id: string
          canal: string
          created_at?: string
          dimension?: string | null
          estado?: string
          id?: string
          metadatos?: Json
          override_aplicado?: Json | null
          texto?: string | null
          updated_at?: string
        }
        Update: {
          analisis_ia?: Json | null
          audio_url?: string | null
          autor_email?: string | null
          autor_id?: string | null
          building_id?: string
          canal?: string
          created_at?: string
          dimension?: string | null
          estado?: string
          id?: string
          metadatos?: Json
          override_aplicado?: Json | null
          texto?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_feedback_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_feedback_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_feedback_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_feedback_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_feedback_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
      }
      building_imagery: {
        Row: {
          building_id: string
          fetched_at: string
          file_path: string
          heading: number | null
          id: string
          pitch: number | null
          public_url: string
          source: string
          zoom: number | null
        }
        Insert: {
          building_id: string
          fetched_at?: string
          file_path: string
          heading?: number | null
          id?: string
          pitch?: number | null
          public_url: string
          source: string
          zoom?: number | null
        }
        Update: {
          building_id?: string
          fetched_at?: string
          file_path?: string
          heading?: number | null
          id?: string
          pitch?: number | null
          public_url?: string
          source?: string
          zoom?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "building_imagery_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_imagery_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_imagery_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_imagery_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_imagery_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
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
          owner_name_norm: string | null
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
          owner_name_norm?: string | null
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
          owner_name_norm?: string | null
          rol_notas?: string | null
          subrole?: Database["public"]["Enums"]["owner_subrole"]
        }
        Relationships: [
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_owners_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_owners_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "building_owners_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "building_owners_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
          },
        ]
      }
      building_processing_status: {
        Row: {
          building_id: string
          current_phase: string | null
          error: string | null
          finished_at: string | null
          phases: Json
          pipeline_stage: string | null
          started_at: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          building_id: string
          current_phase?: string | null
          error?: string | null
          finished_at?: string | null
          phases?: Json
          pipeline_stage?: string | null
          started_at?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          building_id?: string
          current_phase?: string | null
          error?: string | null
          finished_at?: string | null
          phases?: Json
          pipeline_stage?: string | null
          started_at?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_processing_status_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_processing_status_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_processing_status_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_processing_status_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_processing_status_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
      }
      building_tasks: {
        Row: {
          building_id: string
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          priority: string
          status: string
          task_key: string | null
          task_type: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          building_id: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          status?: string
          task_key?: string | null
          task_type?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          building_id?: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          status?: string
          task_key?: string | null
          task_type?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_tasks_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_tasks_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_tasks_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_tasks_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_tasks_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
      }
      buildings: {
        Row: {
          avisos_inteligentes: Json | null
          cartera_demo_seed: boolean
          catastro_ref: string | null
          ciudad: string
          cluster_asignado: string | null
          cluster_breakdown: Json | null
          cluster_motivo: string | null
          cluster_score: number | null
          codigo_postal: string | null
          comercial: string | null
          confianza_media: number | null
          created_at: string
          direccion: string
          division_horizontal: boolean
          es_esquina_manual: boolean | null
          es_estrella: boolean
          estado: Database["public"]["Enums"]["building_status"]
          grupo_barrio: string | null
          hs_deal_id: string | null
          id: string
          iee_actualizado_at: string | null
          iee_deficiencias: Json | null
          iee_estado: Database["public"]["Enums"]["iee_estado"]
          iee_fecha_inspeccion: string | null
          iee_fuente: string | null
          iee_proxima_revision: string | null
          last_synced_at: string | null
          metadatos: Json
          notas: string | null
          numero_propietarios: number | null
          pct_terciario: number | null
          refcatastral: string | null
          score: number | null
          score_breakdown: Json | null
          score_summary: string | null
          score_updated_at: string | null
          updated_at: string
        }
        Insert: {
          avisos_inteligentes?: Json | null
          cartera_demo_seed?: boolean
          catastro_ref?: string | null
          ciudad: string
          cluster_asignado?: string | null
          cluster_breakdown?: Json | null
          cluster_motivo?: string | null
          cluster_score?: number | null
          codigo_postal?: string | null
          comercial?: string | null
          confianza_media?: number | null
          created_at?: string
          direccion: string
          division_horizontal?: boolean
          es_esquina_manual?: boolean | null
          es_estrella?: boolean
          estado?: Database["public"]["Enums"]["building_status"]
          grupo_barrio?: string | null
          hs_deal_id?: string | null
          id?: string
          iee_actualizado_at?: string | null
          iee_deficiencias?: Json | null
          iee_estado?: Database["public"]["Enums"]["iee_estado"]
          iee_fecha_inspeccion?: string | null
          iee_fuente?: string | null
          iee_proxima_revision?: string | null
          last_synced_at?: string | null
          metadatos?: Json
          notas?: string | null
          numero_propietarios?: number | null
          pct_terciario?: number | null
          refcatastral?: string | null
          score?: number | null
          score_breakdown?: Json | null
          score_summary?: string | null
          score_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          avisos_inteligentes?: Json | null
          cartera_demo_seed?: boolean
          catastro_ref?: string | null
          ciudad?: string
          cluster_asignado?: string | null
          cluster_breakdown?: Json | null
          cluster_motivo?: string | null
          cluster_score?: number | null
          codigo_postal?: string | null
          comercial?: string | null
          confianza_media?: number | null
          created_at?: string
          direccion?: string
          division_horizontal?: boolean
          es_esquina_manual?: boolean | null
          es_estrella?: boolean
          estado?: Database["public"]["Enums"]["building_status"]
          grupo_barrio?: string | null
          hs_deal_id?: string | null
          id?: string
          iee_actualizado_at?: string | null
          iee_deficiencias?: Json | null
          iee_estado?: Database["public"]["Enums"]["iee_estado"]
          iee_fecha_inspeccion?: string | null
          iee_fuente?: string | null
          iee_proxima_revision?: string | null
          last_synced_at?: string | null
          metadatos?: Json
          notas?: string | null
          numero_propietarios?: number | null
          pct_terciario?: number | null
          refcatastral?: string | null
          score?: number | null
          score_breakdown?: Json | null
          score_summary?: string | null
          score_updated_at?: string | null
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
          {
            foreignKeyName: "cadence_steps_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "cadence_steps_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "cadence_steps_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
          },
        ]
      }
      call_playbook: {
        Row: {
          created_at: string
          ejemplo_literal: string | null
          evidencia: Json
          id: string
          n_exito: number
          n_usos: number
          perfil_tipologia: string
          tactica_texto: string
          tactica_tipo: string
          tasa_exito: number
          ultima_actualizacion: string
        }
        Insert: {
          created_at?: string
          ejemplo_literal?: string | null
          evidencia?: Json
          id?: string
          n_exito?: number
          n_usos?: number
          perfil_tipologia: string
          tactica_texto: string
          tactica_tipo: string
          tasa_exito?: number
          ultima_actualizacion?: string
        }
        Update: {
          created_at?: string
          ejemplo_literal?: string | null
          evidencia?: Json
          id?: string
          n_exito?: number
          n_usos?: number
          perfil_tipologia?: string
          tactica_texto?: string
          tactica_tipo?: string
          tasa_exito?: number
          ultima_actualizacion?: string
        }
        Relationships: []
      }
      call_sessions: {
        Row: {
          building_id: string | null
          call_id: string | null
          cerrada_at: string | null
          checklist: Json
          comercial_id: string
          created_at: string
          estado: string
          finalizada_at: string | null
          hubspot_call_id: string | null
          id: string
          iniciada_at: string
          notas: string | null
          objetivo: string | null
          owner_id: string | null
          paso: number
          puntuacion: number | null
          resultado: string | null
          updated_at: string
          voss_brief: Json | null
          voss_post: Json | null
        }
        Insert: {
          building_id?: string | null
          call_id?: string | null
          cerrada_at?: string | null
          checklist?: Json
          comercial_id: string
          created_at?: string
          estado?: string
          finalizada_at?: string | null
          hubspot_call_id?: string | null
          id?: string
          iniciada_at?: string
          notas?: string | null
          objetivo?: string | null
          owner_id?: string | null
          paso?: number
          puntuacion?: number | null
          resultado?: string | null
          updated_at?: string
          voss_brief?: Json | null
          voss_post?: Json | null
        }
        Update: {
          building_id?: string | null
          call_id?: string | null
          cerrada_at?: string | null
          checklist?: Json
          comercial_id?: string
          created_at?: string
          estado?: string
          finalizada_at?: string | null
          hubspot_call_id?: string | null
          id?: string
          iniciada_at?: string
          notas?: string | null
          objetivo?: string | null
          owner_id?: string | null
          paso?: number
          puntuacion?: number | null
          resultado?: string | null
          updated_at?: string
          voss_brief?: Json | null
          voss_post?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "call_sessions_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_sessions_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "call_sessions_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_sessions_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "call_sessions_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "call_sessions_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_sessions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_sessions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "call_sessions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "call_sessions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
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
          {
            foreignKeyName: "calls_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "calls_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "calls_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
          },
        ]
      }
      catastro_authority_cache: {
        Row: {
          ano_construccion: number | null
          confidence: Json
          created_at: string
          direccion_oficial: string | null
          errors: Json
          fetched_at: string
          flags: Json
          garajes_total: number | null
          id: string
          lat: number | null
          locales_total: number | null
          lon: number | null
          n_subparcelas_residenciales: number | null
          numero_plantas: number | null
          payload: Json
          plantas: Json
          refcatastral_14: string
          refcatastral_20: string | null
          superficie_parcela_m2: number | null
          updated_at: string
          usos: Json | null
          viviendas_total: number | null
        }
        Insert: {
          ano_construccion?: number | null
          confidence?: Json
          created_at?: string
          direccion_oficial?: string | null
          errors?: Json
          fetched_at?: string
          flags?: Json
          garajes_total?: number | null
          id?: string
          lat?: number | null
          locales_total?: number | null
          lon?: number | null
          n_subparcelas_residenciales?: number | null
          numero_plantas?: number | null
          payload?: Json
          plantas?: Json
          refcatastral_14: string
          refcatastral_20?: string | null
          superficie_parcela_m2?: number | null
          updated_at?: string
          usos?: Json | null
          viviendas_total?: number | null
        }
        Update: {
          ano_construccion?: number | null
          confidence?: Json
          created_at?: string
          direccion_oficial?: string | null
          errors?: Json
          fetched_at?: string
          flags?: Json
          garajes_total?: number | null
          id?: string
          lat?: number | null
          locales_total?: number | null
          lon?: number | null
          n_subparcelas_residenciales?: number | null
          numero_plantas?: number | null
          payload?: Json
          plantas?: Json
          refcatastral_14?: string
          refcatastral_20?: string | null
          superficie_parcela_m2?: number | null
          updated_at?: string
          usos?: Json | null
          viviendas_total?: number | null
        }
        Relationships: []
      }
      catastro_data: {
        Row: {
          ancho_calle_m: number | null
          building_id: string | null
          created_at: string
          dnprc_json: Json | null
          fetch_error: string | null
          fetch_quality: string | null
          fetched_at: string | null
          fxcc_disponible: boolean
          fxcc_num_pages: number | null
          fxcc_pages_urls: Json | null
          fxcc_pdf_url: string | null
          fxcc_source: string | null
          lat: number | null
          lon: number | null
          plano_url: string | null
          plantas_num_pages: number | null
          plantas_pages_urls: Json | null
          plantas_pdf_disponible: boolean | null
          plantas_pdf_url: string | null
          refcatastral: string
          updated_at: string
        }
        Insert: {
          ancho_calle_m?: number | null
          building_id?: string | null
          created_at?: string
          dnprc_json?: Json | null
          fetch_error?: string | null
          fetch_quality?: string | null
          fetched_at?: string | null
          fxcc_disponible?: boolean
          fxcc_num_pages?: number | null
          fxcc_pages_urls?: Json | null
          fxcc_pdf_url?: string | null
          fxcc_source?: string | null
          lat?: number | null
          lon?: number | null
          plano_url?: string | null
          plantas_num_pages?: number | null
          plantas_pages_urls?: Json | null
          plantas_pdf_disponible?: boolean | null
          plantas_pdf_url?: string | null
          refcatastral: string
          updated_at?: string
        }
        Update: {
          ancho_calle_m?: number | null
          building_id?: string | null
          created_at?: string
          dnprc_json?: Json | null
          fetch_error?: string | null
          fetch_quality?: string | null
          fetched_at?: string | null
          fxcc_disponible?: boolean
          fxcc_num_pages?: number | null
          fxcc_pages_urls?: Json | null
          fxcc_pdf_url?: string | null
          fxcc_source?: string | null
          lat?: number | null
          lon?: number | null
          plano_url?: string | null
          plantas_num_pages?: number | null
          plantas_pages_urls?: Json | null
          plantas_pdf_disponible?: boolean | null
          plantas_pdf_url?: string | null
          refcatastral?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catastro_data_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catastro_data_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "catastro_data_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catastro_data_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "catastro_data_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
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
      enrichment_config: {
        Row: {
          created_at: string
          id: string
          parametros: Json
          reglas: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          parametros?: Json
          reglas?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          parametros?: Json
          reglas?: Json
          updated_at?: string
        }
        Relationships: []
      }
      enrichment_jobs: {
        Row: {
          building_id: string | null
          created_at: string
          datos: Json
          error: string | null
          estado: string
          fase: string
          id: string
          intentos: number
          lease_token: string | null
          lease_until: string | null
          max_intentos: number
          next_attempt_at: string | null
          nota_simple_id: string | null
          titular_apellido1: string | null
          titular_apellido2: string | null
          titular_nif: string | null
          titular_nombre: string
          titular_pct: number | null
          titular_tipo: string
          updated_at: string
        }
        Insert: {
          building_id?: string | null
          created_at?: string
          datos?: Json
          error?: string | null
          estado?: string
          fase: string
          id?: string
          intentos?: number
          lease_token?: string | null
          lease_until?: string | null
          max_intentos?: number
          next_attempt_at?: string | null
          nota_simple_id?: string | null
          titular_apellido1?: string | null
          titular_apellido2?: string | null
          titular_nif?: string | null
          titular_nombre: string
          titular_pct?: number | null
          titular_tipo: string
          updated_at?: string
        }
        Update: {
          building_id?: string | null
          created_at?: string
          datos?: Json
          error?: string | null
          estado?: string
          fase?: string
          id?: string
          intentos?: number
          lease_token?: string | null
          lease_until?: string | null
          max_intentos?: number
          next_attempt_at?: string | null
          nota_simple_id?: string | null
          titular_apellido1?: string | null
          titular_apellido2?: string | null
          titular_nif?: string | null
          titular_nombre?: string
          titular_pct?: number | null
          titular_tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_jobs_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_jobs_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "enrichment_jobs_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_jobs_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "enrichment_jobs_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "enrichment_jobs_nota_simple_id_fkey"
            columns: ["nota_simple_id"]
            isOneToOne: false
            referencedRelation: "notas_simples"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_verifications: {
        Row: {
          aprobado_at: string | null
          aprobado_por: string | null
          created_at: string
          decision: string
          id: string
          job_id: string
          motivo: string | null
          propuesta: Json
          updated_at: string
        }
        Insert: {
          aprobado_at?: string | null
          aprobado_por?: string | null
          created_at?: string
          decision?: string
          id?: string
          job_id: string
          motivo?: string | null
          propuesta?: Json
          updated_at?: string
        }
        Update: {
          aprobado_at?: string | null
          aprobado_por?: string | null
          created_at?: string
          decision?: string
          id?: string
          job_id?: string
          motivo?: string | null
          propuesta?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_verifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "enrichment_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      escaleras_control_set: {
        Row: {
          building_id: string
          created_at: string
          gt: number
          id: string
          rank: number
          seed: string
          set_name: string
        }
        Insert: {
          building_id: string
          created_at?: string
          gt: number
          id?: string
          rank: number
          seed: string
          set_name: string
        }
        Update: {
          building_id?: string
          created_at?: string
          gt?: number
          id?: string
          rank?: number
          seed?: string
          set_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "escaleras_control_set_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escaleras_control_set_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "escaleras_control_set_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escaleras_control_set_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "escaleras_control_set_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
      }
      escaleras_eval_results: {
        Row: {
          building_id: string
          confidence: number | null
          created_at: string
          error: string | null
          evidencia: Json | null
          gt: number
          id: string
          needs_review: boolean
          pred_n: number | null
          pred_segundas: boolean | null
          set_name: string
          version: string
        }
        Insert: {
          building_id: string
          confidence?: number | null
          created_at?: string
          error?: string | null
          evidencia?: Json | null
          gt: number
          id?: string
          needs_review?: boolean
          pred_n?: number | null
          pred_segundas?: boolean | null
          set_name: string
          version: string
        }
        Update: {
          building_id?: string
          confidence?: number | null
          created_at?: string
          error?: string | null
          evidencia?: Json | null
          gt?: number
          id?: string
          needs_review?: boolean
          pred_n?: number | null
          pred_segundas?: boolean | null
          set_name?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "escaleras_eval_results_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escaleras_eval_results_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "escaleras_eval_results_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escaleras_eval_results_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "escaleras_eval_results_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
      }
      escaleras_validation_queue: {
        Row: {
          building_id: string | null
          confianza: number | null
          detectado_en: string
          direccion: string | null
          estado: string
          evidencia: Json | null
          id: string
          motivo: string | null
          n_escaleras_detectado: number | null
          rc14: string | null
          segundas_escaleras: boolean | null
          validado_at: string | null
          validado_n_escaleras: number | null
          validado_por: string | null
          validado_resultado: boolean | null
        }
        Insert: {
          building_id?: string | null
          confianza?: number | null
          detectado_en?: string
          direccion?: string | null
          estado?: string
          evidencia?: Json | null
          id?: string
          motivo?: string | null
          n_escaleras_detectado?: number | null
          rc14?: string | null
          segundas_escaleras?: boolean | null
          validado_at?: string | null
          validado_n_escaleras?: number | null
          validado_por?: string | null
          validado_resultado?: boolean | null
        }
        Update: {
          building_id?: string | null
          confianza?: number | null
          detectado_en?: string
          direccion?: string | null
          estado?: string
          evidencia?: Json | null
          id?: string
          motivo?: string | null
          n_escaleras_detectado?: number | null
          rc14?: string | null
          segundas_escaleras?: boolean | null
          validado_at?: string | null
          validado_n_escaleras?: number | null
          validado_por?: string | null
          validado_resultado?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "escaleras_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escaleras_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "escaleras_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escaleras_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "escaleras_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
      }
      esquina_validation_queue: {
        Row: {
          building_id: string | null
          confianza: number | null
          detectado_en: string
          direccion: string | null
          estado: string
          id: string
          is_corner_anterior: boolean | null
          is_corner_nuevo: boolean | null
          n_frentes: number | null
          nota: string | null
          rc14: string | null
          street_names: string[] | null
          tipo_anterior: string | null
          tipo_nuevo: string | null
          validado_at: string | null
          validado_por: string | null
          validado_resultado: boolean | null
          validado_tipo: string | null
        }
        Insert: {
          building_id?: string | null
          confianza?: number | null
          detectado_en?: string
          direccion?: string | null
          estado?: string
          id?: string
          is_corner_anterior?: boolean | null
          is_corner_nuevo?: boolean | null
          n_frentes?: number | null
          nota?: string | null
          rc14?: string | null
          street_names?: string[] | null
          tipo_anterior?: string | null
          tipo_nuevo?: string | null
          validado_at?: string | null
          validado_por?: string | null
          validado_resultado?: boolean | null
          validado_tipo?: string | null
        }
        Update: {
          building_id?: string | null
          confianza?: number | null
          detectado_en?: string
          direccion?: string | null
          estado?: string
          id?: string
          is_corner_anterior?: boolean | null
          is_corner_nuevo?: boolean | null
          n_frentes?: number | null
          nota?: string | null
          rc14?: string | null
          street_names?: string[] | null
          tipo_anterior?: string | null
          tipo_nuevo?: string | null
          validado_at?: string | null
          validado_por?: string | null
          validado_resultado?: boolean | null
          validado_tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esquina_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esquina_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "esquina_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esquina_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "esquina_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
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
      facade_window_counts: {
        Row: {
          building_id: string
          confidence: string
          created_at: string
          ejes_verticales: number
          es_esquina: boolean | null
          esquina_source: string | null
          fachada_principal: Json
          fachada_secundaria: Json | null
          fachadas_a_calle: Json | null
          final_count: number
          flags: string[]
          id: string
          longitud_fachada_m: number | null
          longitud_fachada_source: string | null
          longitud_fachada_total_m: number | null
          refcatastral_14: string
          street_view_panoramas: Json
          vlm_parsed: Json | null
          vlm_raw_response: string
        }
        Insert: {
          building_id: string
          confidence: string
          created_at?: string
          ejes_verticales: number
          es_esquina?: boolean | null
          esquina_source?: string | null
          fachada_principal: Json
          fachada_secundaria?: Json | null
          fachadas_a_calle?: Json | null
          final_count: number
          flags?: string[]
          id?: string
          longitud_fachada_m?: number | null
          longitud_fachada_source?: string | null
          longitud_fachada_total_m?: number | null
          refcatastral_14: string
          street_view_panoramas?: Json
          vlm_parsed?: Json | null
          vlm_raw_response: string
        }
        Update: {
          building_id?: string
          confidence?: string
          created_at?: string
          ejes_verticales?: number
          es_esquina?: boolean | null
          esquina_source?: string | null
          fachada_principal?: Json
          fachada_secundaria?: Json | null
          fachadas_a_calle?: Json | null
          final_count?: number
          flags?: string[]
          id?: string
          longitud_fachada_m?: number | null
          longitud_fachada_source?: string | null
          longitud_fachada_total_m?: number | null
          refcatastral_14?: string
          street_view_panoramas?: Json
          vlm_parsed?: Json | null
          vlm_raw_response?: string
        }
        Relationships: [
          {
            foreignKeyName: "facade_window_counts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facade_window_counts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "facade_window_counts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facade_window_counts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "facade_window_counts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
      }
      facade_window_ground_truth: {
        Row: {
          annotated_image_path: string | null
          building_id: string
          created_at: string
          created_by: string | null
          delta: number | null
          direccion: string
          human_count: number
          id: string
          model_count: number | null
          notes: string | null
          rule_learned: string | null
          source: string
          updated_at: string
        }
        Insert: {
          annotated_image_path?: string | null
          building_id: string
          created_at?: string
          created_by?: string | null
          delta?: number | null
          direccion: string
          human_count: number
          id?: string
          model_count?: number | null
          notes?: string | null
          rule_learned?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          annotated_image_path?: string | null
          building_id?: string
          created_at?: string
          created_by?: string | null
          delta?: number | null
          direccion?: string
          human_count?: number
          id?: string
          model_count?: number | null
          notes?: string | null
          rule_learned?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facade_window_ground_truth_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facade_window_ground_truth_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "facade_window_ground_truth_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facade_window_ground_truth_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "facade_window_ground_truth_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
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
          hs_call_source: string | null
          hs_call_status: string | null
          hs_call_title: string | null
          hs_call_to_number: string | null
          hs_call_transcription: string | null
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
          hs_call_source?: string | null
          hs_call_status?: string | null
          hs_call_title?: string | null
          hs_call_to_number?: string | null
          hs_call_transcription?: string | null
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
          hs_call_source?: string | null
          hs_call_status?: string | null
          hs_call_title?: string | null
          hs_call_to_number?: string | null
          hs_call_transcription?: string | null
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
      hubspot_emails: {
        Row: {
          associated_contact_ids: string[] | null
          associated_deal_ids: string[] | null
          created_at: string
          hs_createdate: string | null
          hs_email_direction: string | null
          hs_email_from_email: string | null
          hs_email_html: string | null
          hs_email_status: string | null
          hs_email_subject: string | null
          hs_email_text: string | null
          hs_email_to_email: string | null
          hs_id: string
          hs_lastmodifieddate: string | null
          hs_owner_id: string | null
          hs_timestamp: string | null
          raw: Json | null
          updated_at: string
        }
        Insert: {
          associated_contact_ids?: string[] | null
          associated_deal_ids?: string[] | null
          created_at?: string
          hs_createdate?: string | null
          hs_email_direction?: string | null
          hs_email_from_email?: string | null
          hs_email_html?: string | null
          hs_email_status?: string | null
          hs_email_subject?: string | null
          hs_email_text?: string | null
          hs_email_to_email?: string | null
          hs_id: string
          hs_lastmodifieddate?: string | null
          hs_owner_id?: string | null
          hs_timestamp?: string | null
          raw?: Json | null
          updated_at?: string
        }
        Update: {
          associated_contact_ids?: string[] | null
          associated_deal_ids?: string[] | null
          created_at?: string
          hs_createdate?: string | null
          hs_email_direction?: string | null
          hs_email_from_email?: string | null
          hs_email_html?: string | null
          hs_email_status?: string | null
          hs_email_subject?: string | null
          hs_email_text?: string | null
          hs_email_to_email?: string | null
          hs_id?: string
          hs_lastmodifieddate?: string | null
          hs_owner_id?: string | null
          hs_timestamp?: string | null
          raw?: Json | null
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
      hubspot_meetings: {
        Row: {
          associated_contact_ids: string[] | null
          associated_deal_ids: string[] | null
          created_at: string
          hs_createdate: string | null
          hs_id: string
          hs_lastmodifieddate: string | null
          hs_meeting_body: string | null
          hs_meeting_end_time: string | null
          hs_meeting_location: string | null
          hs_meeting_outcome: string | null
          hs_meeting_start_time: string | null
          hs_meeting_title: string | null
          hs_owner_id: string | null
          hs_timestamp: string | null
          raw: Json | null
          updated_at: string
        }
        Insert: {
          associated_contact_ids?: string[] | null
          associated_deal_ids?: string[] | null
          created_at?: string
          hs_createdate?: string | null
          hs_id: string
          hs_lastmodifieddate?: string | null
          hs_meeting_body?: string | null
          hs_meeting_end_time?: string | null
          hs_meeting_location?: string | null
          hs_meeting_outcome?: string | null
          hs_meeting_start_time?: string | null
          hs_meeting_title?: string | null
          hs_owner_id?: string | null
          hs_timestamp?: string | null
          raw?: Json | null
          updated_at?: string
        }
        Update: {
          associated_contact_ids?: string[] | null
          associated_deal_ids?: string[] | null
          created_at?: string
          hs_createdate?: string | null
          hs_id?: string
          hs_lastmodifieddate?: string | null
          hs_meeting_body?: string | null
          hs_meeting_end_time?: string | null
          hs_meeting_location?: string | null
          hs_meeting_outcome?: string | null
          hs_meeting_start_time?: string | null
          hs_meeting_title?: string | null
          hs_owner_id?: string | null
          hs_timestamp?: string | null
          raw?: Json | null
          updated_at?: string
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
      import_q4_lista: {
        Row: {
          address: string | null
          ciudad: string | null
          comercial: string | null
          cp: string | null
          etapa: string | null
          hs_id: string
          match_via: string | null
          matched_building_id: string | null
          nombre_negocio: string | null
          refcat: string | null
          refcat14: string | null
        }
        Insert: {
          address?: string | null
          ciudad?: string | null
          comercial?: string | null
          cp?: string | null
          etapa?: string | null
          hs_id: string
          match_via?: string | null
          matched_building_id?: string | null
          nombre_negocio?: string | null
          refcat?: string | null
          refcat14?: string | null
        }
        Update: {
          address?: string | null
          ciudad?: string | null
          comercial?: string | null
          cp?: string | null
          etapa?: string | null
          hs_id?: string
          match_via?: string | null
          matched_building_id?: string | null
          nombre_negocio?: string | null
          refcat?: string | null
          refcat14?: string | null
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
      keep_q4: {
        Row: {
          id: string | null
        }
        Insert: {
          id?: string | null
        }
        Update: {
          id?: string | null
        }
        Relationships: []
      }
      knowledge_chunks: {
        Row: {
          contenido: string
          created_at: string
          document_id: string | null
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
          document_id?: string | null
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
          document_id?: string | null
          embedding?: string | null
          id?: string
          metadatos?: Json
          origen?: string
          referencia_id?: string | null
          scope_id?: string | null
          scope_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          created_at: string
          error: string | null
          id: string
          metadatos: Json
          mime_type: string | null
          nombre: string
          num_chunks: number
          origen: string
          size_bytes: number | null
          status: string
          storage_path: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          metadatos?: Json
          mime_type?: string | null
          nombre: string
          num_chunks?: number
          origen: string
          size_bytes?: number | null
          status?: string
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          metadatos?: Json
          mime_type?: string | null
          nombre?: string
          num_chunks?: number
          origen?: string
          size_bytes?: number | null
          status?: string
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      madrid_barrio_clusters: {
        Row: {
          barrio: string
          barrio_norm: string
          cluster: string
          cluster_secundario: string | null
          distrito: string
          notas: string | null
        }
        Insert: {
          barrio: string
          barrio_norm: string
          cluster: string
          cluster_secundario?: string | null
          distrito: string
          notas?: string | null
        }
        Update: {
          barrio?: string
          barrio_norm?: string
          cluster?: string
          cluster_secundario?: string | null
          distrito?: string
          notas?: string | null
        }
        Relationships: []
      }
      madrid_calles_comerciales: {
        Row: {
          calle: string
          calle_norm: string
          tipo: string
        }
        Insert: {
          calle: string
          calle_norm: string
          tipo: string
        }
        Update: {
          calle?: string
          calle_norm?: string
          tipo?: string
        }
        Relationships: []
      }
      madrid_calles_subzona: {
        Row: {
          barrio: string | null
          calle_norm: string
          cluster_override: string
          created_at: string
          especificidad: number
          id: string
          notas: string | null
          numero_desde: number | null
          numero_hasta: number | null
          sub_zona: string
        }
        Insert: {
          barrio?: string | null
          calle_norm: string
          cluster_override: string
          created_at?: string
          especificidad?: number
          id?: string
          notas?: string | null
          numero_desde?: number | null
          numero_hasta?: number | null
          sub_zona: string
        }
        Update: {
          barrio?: string | null
          calle_norm?: string
          cluster_override?: string
          created_at?: string
          especificidad?: number
          id?: string
          notas?: string | null
          numero_desde?: number | null
          numero_hasta?: number | null
          sub_zona?: string
        }
        Relationships: []
      }
      madrid_edificios_protegidos: {
        Row: {
          created_at: string
          direccion: string | null
          direccion_norm: string | null
          fuente: string
          id: string
          nivel_proteccion: string | null
          raw: Json | null
          refcat: string | null
          refcat_norm: string | null
        }
        Insert: {
          created_at?: string
          direccion?: string | null
          direccion_norm?: string | null
          fuente?: string
          id?: string
          nivel_proteccion?: string | null
          raw?: Json | null
          refcat?: string | null
          refcat_norm?: string | null
        }
        Update: {
          created_at?: string
          direccion?: string | null
          direccion_norm?: string | null
          fuente?: string
          id?: string
          nivel_proteccion?: string | null
          raw?: Json | null
          refcat?: string | null
          refcat_norm?: string | null
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
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "next_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
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
            foreignKeyName: "nota_simple_titulares_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_company_graph"
            referencedColumns: ["company_id"]
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
          {
            foreignKeyName: "nota_simple_titulares_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "nota_simple_titulares_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "nota_simple_titulares_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
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
        Relationships: [
          {
            foreignKeyName: "notas_simples_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_simples_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "notas_simples_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_simples_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "notas_simples_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "notas_simples_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_simples_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "notas_simples_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "notas_simples_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
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
          {
            foreignKeyName: "notes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "notes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "notes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
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
            foreignKeyName: "owner_companies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_company_graph"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "owner_companies_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_companies_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "owner_companies_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "owner_companies_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
          },
        ]
      }
      owner_merge_audit: {
        Row: {
          canonical_owner_id: string
          created_at: string
          details: Json
          id: string
          merged_owner_id: string
          name_norm: string | null
          nif: string | null
          reason: string | null
        }
        Insert: {
          canonical_owner_id: string
          created_at?: string
          details?: Json
          id?: string
          merged_owner_id: string
          name_norm?: string | null
          nif?: string | null
          reason?: string | null
        }
        Update: {
          canonical_owner_id?: string
          created_at?: string
          details?: Json
          id?: string
          merged_owner_id?: string
          name_norm?: string | null
          nif?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_merge_audit_canonical_owner_id_fkey"
            columns: ["canonical_owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_merge_audit_canonical_owner_id_fkey"
            columns: ["canonical_owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "owner_merge_audit_canonical_owner_id_fkey"
            columns: ["canonical_owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "owner_merge_audit_canonical_owner_id_fkey"
            columns: ["canonical_owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
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
            foreignKeyName: "owner_relations_owner_a_id_fkey"
            columns: ["owner_a_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "owner_relations_owner_a_id_fkey"
            columns: ["owner_a_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "owner_relations_owner_a_id_fkey"
            columns: ["owner_a_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "owner_relations_owner_b_id_fkey"
            columns: ["owner_b_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_relations_owner_b_id_fkey"
            columns: ["owner_b_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "owner_relations_owner_b_id_fkey"
            columns: ["owner_b_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "owner_relations_owner_b_id_fkey"
            columns: ["owner_b_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
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
          merged_into: string | null
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
          merged_into?: string | null
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
          merged_into?: string | null
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
        Relationships: [
          {
            foreignKeyName: "owners_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owners_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "owners_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "owners_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
          },
        ]
      }
      parcel_geometry_cache: {
        Row: {
          area_m2: number | null
          bbox: Json
          centroid: Json
          confidence: string
          corner_type: string | null
          expires_at: string
          exterior_ring: Json
          fetched_at: string
          flags: string[]
          frentes_jsonb: Json | null
          id: string
          interior_rings: Json
          is_corner: boolean | null
          osm_id: number | null
          osm_type: string | null
          perimeter_m: number | null
          raw_response: Json | null
          refcatastral_14: string
          source: string
          street_edges_jsonb: Json | null
          street_names_distinct: string[] | null
          total_street_length_m: number | null
        }
        Insert: {
          area_m2?: number | null
          bbox: Json
          centroid: Json
          confidence: string
          corner_type?: string | null
          expires_at?: string
          exterior_ring: Json
          fetched_at?: string
          flags?: string[]
          frentes_jsonb?: Json | null
          id?: string
          interior_rings?: Json
          is_corner?: boolean | null
          osm_id?: number | null
          osm_type?: string | null
          perimeter_m?: number | null
          raw_response?: Json | null
          refcatastral_14: string
          source: string
          street_edges_jsonb?: Json | null
          street_names_distinct?: string[] | null
          total_street_length_m?: number | null
        }
        Update: {
          area_m2?: number | null
          bbox?: Json
          centroid?: Json
          confidence?: string
          corner_type?: string | null
          expires_at?: string
          exterior_ring?: Json
          fetched_at?: string
          flags?: string[]
          frentes_jsonb?: Json | null
          id?: string
          interior_rings?: Json
          is_corner?: boolean | null
          osm_id?: number | null
          osm_type?: string | null
          perimeter_m?: number | null
          raw_response?: Json | null
          refcatastral_14?: string
          source?: string
          street_edges_jsonb?: Json | null
          street_names_distinct?: string[] | null
          total_street_length_m?: number | null
        }
        Relationships: []
      }
      patio_window_counts: {
        Row: {
          building_id: string
          confianza: string
          created_at: string
          densidad_patio_m: number | null
          estimacion_rango: Json
          estimacion_total: number
          flags: string[]
          id: string
          metodo: string
          notas: string | null
          numero_viviendas: number | null
          patios_detectados: Json
          plantas_residenciales: number | null
          refcatastral_14: string
        }
        Insert: {
          building_id: string
          confianza: string
          created_at?: string
          densidad_patio_m?: number | null
          estimacion_rango: Json
          estimacion_total: number
          flags?: string[]
          id?: string
          metodo: string
          notas?: string | null
          numero_viviendas?: number | null
          patios_detectados: Json
          plantas_residenciales?: number | null
          refcatastral_14: string
        }
        Update: {
          building_id?: string
          confianza?: string
          created_at?: string
          densidad_patio_m?: number | null
          estimacion_rango?: Json
          estimacion_total?: number
          flags?: string[]
          id?: string
          metodo?: string
          notas?: string | null
          numero_viviendas?: number | null
          patios_detectados?: Json
          plantas_residenciales?: number | null
          refcatastral_14?: string
        }
        Relationships: [
          {
            foreignKeyName: "patio_window_counts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patio_window_counts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "patio_window_counts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patio_window_counts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "patio_window_counts_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
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
      proteccion_validation_queue: {
        Row: {
          building_id: string
          capa: string | null
          detectado_en: string
          direccion: string | null
          estado: string
          id: string
          n_catalogo: string | null
          nivel_proteccion: string | null
          nota: string | null
          rc14: string | null
          validado_at: string | null
          validado_por: string | null
          validado_resultado: boolean | null
        }
        Insert: {
          building_id: string
          capa?: string | null
          detectado_en?: string
          direccion?: string | null
          estado: string
          id?: string
          n_catalogo?: string | null
          nivel_proteccion?: string | null
          nota?: string | null
          rc14?: string | null
          validado_at?: string | null
          validado_por?: string | null
          validado_resultado?: boolean | null
        }
        Update: {
          building_id?: string
          capa?: string | null
          detectado_en?: string
          direccion?: string | null
          estado?: string
          id?: string
          n_catalogo?: string | null
          nivel_proteccion?: string | null
          nota?: string | null
          rc14?: string | null
          validado_at?: string | null
          validado_por?: string | null
          validado_resultado?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "proteccion_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proteccion_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "proteccion_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proteccion_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "proteccion_validation_queue_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
      }
      qa_ground_truth: {
        Row: {
          ano: number | null
          building_id: string | null
          cluster_label: string | null
          created_at: string
          deal_id: string | null
          dh: boolean | null
          direccion_norm: string
          direccion_raw: string
          es_esquina: boolean | null
          escaleras: number | null
          fuente_verificacion: string | null
          id: string
          lista: string
          m2_per_viv: number | null
          m2_tot: number | null
          m2_viv: number | null
          matched_by: string | null
          motivo: string | null
          n_viv: number | null
          pct_viv: number | null
          propietarios: number | null
          protegido: boolean | null
          tipo: string | null
          updated_at: string
          ventanas_fachada: number | null
          ventanas_patio: number | null
          verificado_at: string | null
          verificado_por: string | null
          zona: string | null
        }
        Insert: {
          ano?: number | null
          building_id?: string | null
          cluster_label?: string | null
          created_at?: string
          deal_id?: string | null
          dh?: boolean | null
          direccion_norm: string
          direccion_raw: string
          es_esquina?: boolean | null
          escaleras?: number | null
          fuente_verificacion?: string | null
          id?: string
          lista: string
          m2_per_viv?: number | null
          m2_tot?: number | null
          m2_viv?: number | null
          matched_by?: string | null
          motivo?: string | null
          n_viv?: number | null
          pct_viv?: number | null
          propietarios?: number | null
          protegido?: boolean | null
          tipo?: string | null
          updated_at?: string
          ventanas_fachada?: number | null
          ventanas_patio?: number | null
          verificado_at?: string | null
          verificado_por?: string | null
          zona?: string | null
        }
        Update: {
          ano?: number | null
          building_id?: string | null
          cluster_label?: string | null
          created_at?: string
          deal_id?: string | null
          dh?: boolean | null
          direccion_norm?: string
          direccion_raw?: string
          es_esquina?: boolean | null
          escaleras?: number | null
          fuente_verificacion?: string | null
          id?: string
          lista?: string
          m2_per_viv?: number | null
          m2_tot?: number | null
          m2_viv?: number | null
          matched_by?: string | null
          motivo?: string | null
          n_viv?: number | null
          pct_viv?: number | null
          propietarios?: number | null
          protegido?: boolean | null
          tipo?: string | null
          updated_at?: string
          ventanas_fachada?: number | null
          ventanas_patio?: number | null
          verificado_at?: string | null
          verificado_por?: string | null
          zona?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_ground_truth_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_ground_truth_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "qa_ground_truth_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_ground_truth_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "qa_ground_truth_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
      }
      scoring_v2_feedback: {
        Row: {
          aviso_key: string
          building_id: string
          comentario: string | null
          created_at: string
          id: string
          notes: string | null
          payload: Json
          tipo: string | null
          user_email: string | null
          user_id: string | null
          valor: string | null
          vote: number
        }
        Insert: {
          aviso_key: string
          building_id: string
          comentario?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          payload?: Json
          tipo?: string | null
          user_email?: string | null
          user_id?: string | null
          valor?: string | null
          vote: number
        }
        Update: {
          aviso_key?: string
          building_id?: string
          comentario?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          payload?: Json
          tipo?: string | null
          user_email?: string | null
          user_id?: string | null
          valor?: string | null
          vote?: number
        }
        Relationships: [
          {
            foreignKeyName: "scoring_v2_feedback_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_v2_feedback_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "scoring_v2_feedback_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_v2_feedback_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "scoring_v2_feedback_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
      }
      scoring_v2_jobs: {
        Row: {
          current_phase: string | null
          cursor: string | null
          error: string | null
          failed: number | null
          finished_at: string | null
          id: string
          items_status: Json
          kind: string | null
          log: Json | null
          phase: string | null
          phase_progress: Json
          processed: number | null
          started_at: string | null
          status: string
          total: number | null
        }
        Insert: {
          current_phase?: string | null
          cursor?: string | null
          error?: string | null
          failed?: number | null
          finished_at?: string | null
          id?: string
          items_status?: Json
          kind?: string | null
          log?: Json | null
          phase?: string | null
          phase_progress?: Json
          processed?: number | null
          started_at?: string | null
          status?: string
          total?: number | null
        }
        Update: {
          current_phase?: string | null
          cursor?: string | null
          error?: string | null
          failed?: number | null
          finished_at?: string | null
          id?: string
          items_status?: Json
          kind?: string | null
          log?: Json | null
          phase?: string | null
          phase_progress?: Json
          processed?: number | null
          started_at?: string | null
          status?: string
          total?: number | null
        }
        Relationships: []
      }
      scoring_v2_seed: {
        Row: {
          created_at: string
          direccion: string | null
          edificio: string
          hubspot_deal_id: string | null
          matched_at: string | null
          matched_building_id: string | null
          raw: Json | null
        }
        Insert: {
          created_at?: string
          direccion?: string | null
          edificio: string
          hubspot_deal_id?: string | null
          matched_at?: string | null
          matched_building_id?: string | null
          raw?: Json | null
        }
        Update: {
          created_at?: string
          direccion?: string | null
          edificio?: string
          hubspot_deal_id?: string | null
          matched_at?: string | null
          matched_building_id?: string | null
          raw?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "scoring_v2_seed_matched_building_id_fkey"
            columns: ["matched_building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_v2_seed_matched_building_id_fkey"
            columns: ["matched_building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "scoring_v2_seed_matched_building_id_fkey"
            columns: ["matched_building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_v2_seed_matched_building_id_fkey"
            columns: ["matched_building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "scoring_v2_seed_matched_building_id_fkey"
            columns: ["matched_building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
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
      wa_ai_jobs: {
        Row: {
          attempts: number
          conversation_id: string
          created_at: string
          error: string | null
          id: string
          run_after: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          conversation_id: string
          created_at?: string
          error?: string | null
          id?: string
          run_after?: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          conversation_id?: string
          created_at?: string
          error?: string | null
          id?: string
          run_after?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_ai_jobs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wa_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_bot_config: {
        Row: {
          active_hours: Json
          extract_fields: Json
          forbidden: Json
          goals: Json
          id: string
          is_active: boolean
          off_hours_message: string | null
          persona: string
          reply_delay_max: number
          reply_delay_min: number
          tone: string
          updated_at: string
        }
        Insert: {
          active_hours?: Json
          extract_fields?: Json
          forbidden?: Json
          goals?: Json
          id?: string
          is_active?: boolean
          off_hours_message?: string | null
          persona?: string
          reply_delay_max?: number
          reply_delay_min?: number
          tone?: string
          updated_at?: string
        }
        Update: {
          active_hours?: Json
          extract_fields?: Json
          forbidden?: Json
          goals?: Json
          id?: string
          is_active?: boolean
          off_hours_message?: string | null
          persona?: string
          reply_delay_max?: number
          reply_delay_min?: number
          tone?: string
          updated_at?: string
        }
        Relationships: []
      }
      wa_campaign_targets: {
        Row: {
          campaign_id: string
          contact_id: string | null
          created_at: string
          id: string
          metadata: Json
          name: string | null
          phone: string
          replied_at: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          contact_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          name?: string | null
          phone: string
          replied_at?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          name?: string | null
          phone?: string
          replied_at?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_campaign_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "wa_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_campaign_targets_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_campaigns: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          metadata: Json
          name: string
          qualified_count: number
          replied_count: number
          scheduled_at: string | null
          sent_count: number
          status: string
          target_count: number
          template: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          name: string
          qualified_count?: number
          replied_count?: number
          scheduled_at?: string | null
          sent_count?: number
          status?: string
          target_count?: number
          template: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          name?: string
          qualified_count?: number
          replied_count?: number
          scheduled_at?: string | null
          sent_count?: number
          status?: string
          target_count?: number
          template?: string
          updated_at?: string
        }
        Relationships: []
      }
      wa_contacts: {
        Row: {
          created_at: string
          id: string
          jid: string | null
          last_bot_contact_at: string | null
          last_human_agent_id: string | null
          last_human_contact_at: string | null
          last_message_at: string | null
          lead_id: string | null
          metadata: Json
          name: string | null
          phone: string
          sentiment: string | null
          stage: string
          tags: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          jid?: string | null
          last_bot_contact_at?: string | null
          last_human_agent_id?: string | null
          last_human_contact_at?: string | null
          last_message_at?: string | null
          lead_id?: string | null
          metadata?: Json
          name?: string | null
          phone: string
          sentiment?: string | null
          stage?: string
          tags?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          jid?: string | null
          last_bot_contact_at?: string | null
          last_human_agent_id?: string | null
          last_human_contact_at?: string | null
          last_message_at?: string | null
          lead_id?: string | null
          metadata?: Json
          name?: string | null
          phone?: string
          sentiment?: string | null
          stage?: string
          tags?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_contacts_last_human_agent_id_fkey"
            columns: ["last_human_agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_contacts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_contacts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "wa_contacts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "wa_contacts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
          },
        ]
      }
      wa_conversations: {
        Row: {
          ai_enabled: boolean
          campaign_id: string | null
          contact_id: string
          created_at: string
          handoff_reason: string | null
          id: string
          last_message_at: string | null
          metadata: Json
          qualification: Json
          rol_confianza: number | null
          rol_owner: Database["public"]["Enums"]["owner_role"] | null
          rol_source: string | null
          status: string
          subrol_owner: Database["public"]["Enums"]["owner_subrole"] | null
          summary: string | null
          summary_msg_count: number
          summary_updated_at: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          ai_enabled?: boolean
          campaign_id?: string | null
          contact_id: string
          created_at?: string
          handoff_reason?: string | null
          id?: string
          last_message_at?: string | null
          metadata?: Json
          qualification?: Json
          rol_confianza?: number | null
          rol_owner?: Database["public"]["Enums"]["owner_role"] | null
          rol_source?: string | null
          status?: string
          subrol_owner?: Database["public"]["Enums"]["owner_subrole"] | null
          summary?: string | null
          summary_msg_count?: number
          summary_updated_at?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          ai_enabled?: boolean
          campaign_id?: string | null
          contact_id?: string
          created_at?: string
          handoff_reason?: string | null
          id?: string
          last_message_at?: string | null
          metadata?: Json
          qualification?: Json
          rol_confianza?: number | null
          rol_owner?: Database["public"]["Enums"]["owner_role"] | null
          rol_source?: string | null
          status?: string
          subrol_owner?: Database["public"]["Enums"]["owner_subrole"] | null
          summary?: string | null
          summary_msg_count?: number
          summary_updated_at?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_instances: {
        Row: {
          created_at: string
          id: string
          instance_name: string
          last_seen_at: string | null
          metadata: Json
          owner_jid: string | null
          phone_number: string | null
          qr_base64: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          instance_name: string
          last_seen_at?: string | null
          metadata?: Json
          owner_jid?: string | null
          phone_number?: string | null
          qr_base64?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          instance_name?: string
          last_seen_at?: string | null
          metadata?: Json
          owner_jid?: string | null
          phone_number?: string | null
          qr_base64?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      wa_messages: {
        Row: {
          agent_user_id: string | null
          ai_generated: boolean
          campaign_id: string | null
          contact_id: string
          content: string | null
          conversation_id: string
          created_at: string
          direction: string
          evolution_message_id: string | null
          id: string
          media_url: string | null
          metadata: Json
          sender_type: string | null
          status: string
          type: string
        }
        Insert: {
          agent_user_id?: string | null
          ai_generated?: boolean
          campaign_id?: string | null
          contact_id: string
          content?: string | null
          conversation_id: string
          created_at?: string
          direction: string
          evolution_message_id?: string | null
          id?: string
          media_url?: string | null
          metadata?: Json
          sender_type?: string | null
          status?: string
          type?: string
        }
        Update: {
          agent_user_id?: string | null
          ai_generated?: boolean
          campaign_id?: string | null
          contact_id?: string
          content?: string | null
          conversation_id?: string
          created_at?: string
          direction?: string
          evolution_message_id?: string | null
          id?: string
          media_url?: string | null
          metadata?: Json
          sender_type?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_messages_agent_user_id_fkey"
            columns: ["agent_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "wa_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wa_conversations"
            referencedColumns: ["id"]
          },
        ]
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
          {
            foreignKeyName: "whatsapp_messages_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
          },
        ]
      }
    }
    Views: {
      v_building_conversations: {
        Row: {
          associated_contact_ids: string[] | null
          associated_deal_ids: string[] | null
          body: string | null
          building_id: string | null
          direction: string | null
          duration_seg: number | null
          hs_id: string | null
          hs_owner_id: string | null
          kind: string | null
          ts: string | null
        }
        Relationships: []
      }
      v_building_graph: {
        Row: {
          building_id: string | null
          ciudad: string | null
          companies_count: number | null
          direccion: string | null
          estado: Database["public"]["Enums"]["building_status"] | null
          influencers_count: number | null
          notas_count: number | null
          numero_propietarios: number | null
          owners_count: number | null
        }
        Relationships: []
      }
      v_building_score: {
        Row: {
          ciudad: string | null
          confidence: number | null
          direccion: string | null
          division_horizontal: boolean | null
          esquina: boolean | null
          has_ai_analysis: boolean | null
          id: string | null
          intencion_venta: boolean | null
          m2_almacen_x: number | null
          m2_comercio_x: number | null
          m2_exactos: number | null
          m2_industrial_x: number | null
          m2_oficina_x: number | null
          m2_rango: string | null
          m2_total: number | null
          md: Json | null
          num_viviendas: number | null
          numero_propietarios: number | null
          owners_count: number | null
          patios_detectados: number | null
          plantas_levantables: number | null
          protegido_historicamente: boolean | null
          s_m2: number | null
          s_no_dh: number | null
          s_owners: number | null
          s_ratio: number | null
          s_viviendas: number | null
          score: number | null
          score_breakdown: Json | null
          score_raw: number | null
          segundas_escaleras: boolean | null
          ventanas_fachada_total: number | null
          viviendas_unidades: number | null
        }
        Relationships: []
      }
      v_call_queue_daily: {
        Row: {
          building_id: string | null
          contactos_previos: number | null
          cuota: number | null
          dias_cadencia_vencida: number | null
          last_call_at: string | null
          nombre: string | null
          owner_id: string | null
          prioridad: number | null
          score_edificio: number | null
          score_owner: number | null
          telefono: string | null
          temperatura: string | null
        }
        Relationships: [
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_owners_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_owners_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_graph"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "building_owners_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_last_contact"
            referencedColumns: ["owner_id"]
          },
          {
            foreignKeyName: "building_owners_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "v_owner_score"
            referencedColumns: ["owner_id"]
          },
        ]
      }
      v_cohort77_calls_audit: {
        Row: {
          building_id: string | null
          calls_locales: number | null
          direccion: string | null
          gap: number | null
          hs_calls_esperadas: number | null
          owners_con_hs: number | null
          owners_total: number | null
          ultima_call_hs: string | null
          ultima_call_local: string | null
        }
        Relationships: [
          {
            foreignKeyName: "building_processing_status_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_processing_status_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_processing_status_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_processing_status_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_processing_status_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: true
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
      }
      v_cohort77_pct_audit: {
        Row: {
          building_id: string | null
          con_pct: number | null
          direccion: string | null
          estado: string | null
          invalidos: number | null
          n_owners: number | null
          sum_pct: number | null
        }
        Relationships: []
      }
      v_company_graph: {
        Row: {
          buildings_count: number | null
          buyer_persona: Database["public"]["Enums"]["buyer_persona"] | null
          cif: string | null
          company_id: string | null
          nombre: string | null
          notas_count: number | null
          owners_count: number | null
        }
        Relationships: []
      }
      v_dashboard_buildings_worked: {
        Row: {
          con_nota_simple: number | null
          con_propietarios: number | null
          total: number | null
        }
        Relationships: []
      }
      v_dashboard_call_heatmap: {
        Row: {
          calls: number | null
          dow: number | null
          hr: number | null
        }
        Relationships: []
      }
      v_dashboard_city_conversion: {
        Row: {
          ciudad: string | null
          total: number | null
          trabajados: number | null
        }
        Relationships: []
      }
      v_hubspot_calls_huerfanas: {
        Row: {
          associated_contact_ids: string[] | null
          associated_deal_ids: string[] | null
          hs_call_direction: string | null
          hs_call_from_number: string | null
          hs_call_to_number: string | null
          hs_id: string | null
          hs_timestamp: string | null
          motivo: string | null
        }
        Relationships: []
      }
      v_kpis_comercial_semana: {
        Row: {
          calidad_media: number | null
          comercial_key: string | null
          comercial_nombre: string | null
          duracion_media_seg: number | null
          interesados: number | null
          llamadas_mayor_1min: number | null
          llamadas_total: number | null
          pct_mayor_1min: number | null
          pixels_enviados: number | null
          reuniones_cerradas: number | null
          seguimientos: number | null
          semana: string | null
          whatsapp_enviados: number | null
        }
        Relationships: []
      }
      v_owner_call_stats: {
        Row: {
          dias_desde_ultima_llamada: number | null
          entrantes: number | null
          intentos_totales: number | null
          owner_id: string | null
          salientes: number | null
          ultima_llamada: string | null
          ultima_vez_conectado: string | null
          veces_conectado: number | null
        }
        Relationships: []
      }
      v_owner_calls_enriched: {
        Row: {
          direccion: string | null
          duracion_seg: number | null
          hs_id: string | null
          hs_timestamp: string | null
          nota: string | null
          owner_id: string | null
          resultado: string | null
          tiene_grabacion: boolean | null
        }
        Relationships: []
      }
      v_owner_graph: {
        Row: {
          buildings_count: number | null
          calls_count: number | null
          companies_count: number | null
          email: string | null
          nombre: string | null
          notas_count: number | null
          owner_id: string | null
          relations_count: number | null
          rol: Database["public"]["Enums"]["owner_role"] | null
          subrole: Database["public"]["Enums"]["owner_subrole"] | null
          telefono: string | null
        }
        Relationships: []
      }
      v_owner_last_contact: {
        Row: {
          calls_count: number | null
          last_call_at: string | null
          owner_id: string | null
        }
        Insert: {
          calls_count?: never
          last_call_at?: never
          owner_id?: string | null
        }
        Update: {
          calls_count?: never
          last_call_at?: never
          owner_id?: string | null
        }
        Relationships: []
      }
      v_owner_score: {
        Row: {
          building_id: string | null
          contactos_previos: number | null
          email: string | null
          es_influencer: boolean | null
          influencer_reason: string | null
          influencer_score: number | null
          last_call_at: string | null
          metadatos: Json | null
          nombre: string | null
          owner_id: string | null
          pct_invalido: boolean | null
          pct_normalizado: boolean | null
          pct_origen: string | null
          pct_propiedad: number | null
          pct_raw: string | null
          rol: Database["public"]["Enums"]["owner_role"] | null
          rol_notas: string | null
          score: number | null
          subrole: Database["public"]["Enums"]["owner_subrole"] | null
          telefono: string | null
        }
        Relationships: [
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_graph"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_building_score"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_cohort77_pct_audit"
            referencedColumns: ["building_id"]
          },
          {
            foreignKeyName: "building_owners_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "v_staircase_review_queue"
            referencedColumns: ["building_id"]
          },
        ]
      }
      v_productividad_comercial: {
        Row: {
          comercial: string | null
          dur_30_60: number | null
          dur_60_90: number | null
          dur_desconocida: number | null
          dur_gt_90: number | null
          dur_lt_30: number | null
          hitos_medios: number | null
          llamadas_scoreadas: number | null
          llamadas_total: number | null
          pct_canal_abierto: number | null
          pct_info_edificio: number | null
          pct_que_le_mueve: number | null
          pct_tipologia: number | null
          score_post_call_medio: number | null
        }
        Relationships: []
      }
      v_productividad_comercial_semana: {
        Row: {
          comercial: string | null
          dur_30_60: number | null
          dur_60_90: number | null
          dur_gt_90: number | null
          dur_lt_30: number | null
          hitos_medios: number | null
          llamadas_scoreadas: number | null
          llamadas_total: number | null
          pct_canal_abierto: number | null
          pct_info_edificio: number | null
          pct_que_le_mueve: number | null
          pct_tipologia: number | null
          semana: string | null
        }
        Relationships: []
      }
      v_productividad_global: {
        Row: {
          dur_30_60: number | null
          dur_60_90: number | null
          dur_gt_90: number | null
          dur_lt_30: number | null
          hitos_medios: number | null
          llamadas_scoreadas: number | null
          llamadas_total: number | null
          pct_canal_abierto: number | null
          pct_info_edificio: number | null
          pct_que_le_mueve: number | null
          pct_tipologia: number | null
        }
        Relationships: []
      }
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
      v_staircase_review_queue: {
        Row: {
          building_id: string | null
          catalogo: string | null
          cluster_asignado: string | null
          direccion: string | null
          fxcc_piso01: number | null
          fxcc_segundas: boolean | null
          manzana: string | null
          prioridad: number | null
          score: number | null
          visor_conf: number | null
          visor_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _safe_int_from_dir: { Args: { p: string }; Returns: number }
      calls_stats: {
        Args: never
        Returns: {
          analizables: number
          avg_duracion: number
          sin_transcripcion: number
          total: number
        }[]
      }
      compute_cluster_score: {
        Args: { p_building_id: string }
        Returns: number
      }
      compute_score: { Args: { p_building_id: string }; Returns: number }
      count_distinct_owners: {
        Args: { p_building_id: string }
        Returns: number
      }
      count_distinct_owners_batch: {
        Args: { p_building_ids: string[] }
        Returns: {
          building_id: string
          n: number
        }[]
      }
      count_pending_scoring_calls: { Args: never; Returns: number }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_pending_scoring_calls: {
        Args: { _limit?: number }
        Returns: {
          comercial_email: string
          duracion_seg: number
          id: string
          metadatos: Json
          transcripcion: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_whatsapp_access: { Args: { _user_id: string }; Returns: boolean }
      iee_score_components: {
        Args: { p_building_id: string }
        Returns: {
          aviso: Json
          delta: number
          estado: string
          label: string
        }[]
      }
      madrid_plantas_max: { Args: { ancho_m: number }; Returns: number }
      match_building_fuzzy: {
        Args: { p_ciudad?: string; p_direccion: string; p_threshold?: number }
        Returns: string
      }
      match_knowledge_chunks:
        | {
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
        | {
            Args: {
              filter_origenes?: string[]
              filter_scope_id?: string
              filter_scope_type?: string
              match_count?: number
              query_embedding: string
            }
            Returns: {
              chunk_id: string
              metadatos: Json
              similarity: number
              snippet: string
              source: string
            }[]
          }
      match_owner_by_phone: {
        Args: { p_phone: string }
        Returns: {
          buildings: Json
          match_status: string
          owner_id: string
          owner_nombre: string
        }[]
      }
      merge_duplicate_owners: { Args: { p_dry_run?: boolean }; Returns: Json }
      normalize_barrio: { Args: { p: string }; Returns: string }
      normalize_catastro: { Args: { p: string }; Returns: string }
      normalize_pct_propiedad: {
        Args: { raw: string }
        Returns: {
          invalido: boolean
          normalizado: boolean
          pct: number
          raw_value: string
        }[]
      }
      normalize_person_name: { Args: { p: string }; Returns: string }
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
      recompute_building_owner_metrics: {
        Args: { p_building_ids?: string[] }
        Returns: Json
      }
      rpc_inversores_paginated:
        | {
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
        | {
            Args: {
              p_buyer_persona?: string
              p_distrito?: string
              p_limit?: number
              p_offset?: number
              p_order?: string
              p_search?: string
              p_tipo?: string
            }
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      app_role:
        | "admin"
        | "manager"
        | "agent"
        | "viewer"
        | "captacion"
        | "comercial_zona"
        | "prevalificacion"
        | "whatsapp"
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
      assignment_status: "active" | "paused" | "discarded"
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
      iee_estado:
        | "desconocido"
        | "no_procede"
        | "pendiente"
        | "favorable"
        | "caducada"
        | "desfavorable_leve"
        | "desfavorable_grave"
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
      app_role: [
        "admin",
        "manager",
        "agent",
        "viewer",
        "captacion",
        "comercial_zona",
        "prevalificacion",
        "whatsapp",
      ],
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
      assignment_status: ["active", "paused", "discarded"],
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
      iee_estado: [
        "desconocido",
        "no_procede",
        "pendiente",
        "favorable",
        "caducada",
        "desfavorable_leve",
        "desfavorable_grave",
      ],
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
