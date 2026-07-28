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
      api_keys: {
        Row: {
          name: string
          updated_at: string
          value: string
        }
        Insert: {
          name: string
          updated_at?: string
          value: string
        }
        Update: {
          name?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      lsi_settings: {
        Row: {
          blacklist_domains: string[]
          competitor_count: number
          folder: string | null
          id: string
          project_domain: string
          search_engine: string
          serp_depth: number
          topvisor_project_id: string | null
          topvisor_region_index: number | null
          updated_at: string
        }
        Insert: {
          blacklist_domains?: string[]
          competitor_count?: number
          folder?: string | null
          id?: string
          project_domain?: string
          search_engine?: string
          serp_depth?: number
          topvisor_project_id?: string | null
          topvisor_region_index?: number | null
          updated_at?: string
        }
        Update: {
          blacklist_domains?: string[]
          competitor_count?: number
          folder?: string | null
          id?: string
          project_domain?: string
          search_engine?: string
          serp_depth?: number
          topvisor_project_id?: string | null
          topvisor_region_index?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      text_requirement_analysis: {
        Row: {
          competitor_count: number | null
          created_at: string
          error_message: string | null
          folder: string | null
          group_key: string
          group_name: string | null
          id: string
          miratext_hash: string | null
          raw_miratext_response: Json | null
          raw_topvisor_response: Json | null
          search_engine: string | null
          serp_date: string | null
          serp_depth: number | null
          status: string
          target_url: string | null
          topvisor_project_id: string | null
          topvisor_region_index: number | null
          updated_at: string
        }
        Insert: {
          competitor_count?: number | null
          created_at?: string
          error_message?: string | null
          folder?: string | null
          group_key: string
          group_name?: string | null
          id?: string
          miratext_hash?: string | null
          raw_miratext_response?: Json | null
          raw_topvisor_response?: Json | null
          search_engine?: string | null
          serp_date?: string | null
          serp_depth?: number | null
          status?: string
          target_url?: string | null
          topvisor_project_id?: string | null
          topvisor_region_index?: number | null
          updated_at?: string
        }
        Update: {
          competitor_count?: number | null
          created_at?: string
          error_message?: string | null
          folder?: string | null
          group_key?: string
          group_name?: string | null
          id?: string
          miratext_hash?: string | null
          raw_miratext_response?: Json | null
          raw_topvisor_response?: Json | null
          search_engine?: string | null
          serp_date?: string | null
          serp_depth?: number | null
          status?: string
          target_url?: string | null
          topvisor_project_id?: string | null
          topvisor_region_index?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      text_requirement_competitor: {
        Row: {
          analysis_id: string
          avg_position: number | null
          created_at: string
          domain: string | null
          exclude_reason: string | null
          id: string
          is_excluded: boolean
          is_selected: boolean
          keyword_count: number | null
          position: number | null
          snippet_body: string | null
          snippet_title: string | null
          source: string | null
          url: string
        }
        Insert: {
          analysis_id: string
          avg_position?: number | null
          created_at?: string
          domain?: string | null
          exclude_reason?: string | null
          id?: string
          is_excluded?: boolean
          is_selected?: boolean
          keyword_count?: number | null
          position?: number | null
          snippet_body?: string | null
          snippet_title?: string | null
          source?: string | null
          url: string
        }
        Update: {
          analysis_id?: string
          avg_position?: number | null
          created_at?: string
          domain?: string | null
          exclude_reason?: string | null
          id?: string
          is_excluded?: boolean
          is_selected?: boolean
          keyword_count?: number | null
          position?: number | null
          snippet_body?: string | null
          snippet_title?: string | null
          source?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "text_requirement_competitor_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "text_requirement_analysis"
            referencedColumns: ["id"]
          },
        ]
      }
      text_requirement_item: {
        Row: {
          analysis_id: string
          competitor_site_count: number | null
          created_at: string
          density: number | null
          id: string
          is_manual: boolean
          max_count: number | null
          min_count: number | null
          priority: string | null
          recommended_count: number | null
          source_field: string | null
          status: string
          type: string
          updated_at: string
          value: string
        }
        Insert: {
          analysis_id: string
          competitor_site_count?: number | null
          created_at?: string
          density?: number | null
          id?: string
          is_manual?: boolean
          max_count?: number | null
          min_count?: number | null
          priority?: string | null
          recommended_count?: number | null
          source_field?: string | null
          status?: string
          type: string
          updated_at?: string
          value: string
        }
        Update: {
          analysis_id?: string
          competitor_site_count?: number | null
          created_at?: string
          density?: number | null
          id?: string
          is_manual?: boolean
          max_count?: number | null
          min_count?: number | null
          priority?: string | null
          recommended_count?: number | null
          source_field?: string | null
          status?: string
          type?: string
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "text_requirement_item_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "text_requirement_analysis"
            referencedColumns: ["id"]
          },
        ]
      }
      text_requirement_version: {
        Row: {
          analysis_id: string | null
          approved_at: string | null
          change_comment: string | null
          created_at: string
          group_key: string
          id: string
          recommended_length_max: number | null
          recommended_length_min: number | null
          status: string
          version_number: number
        }
        Insert: {
          analysis_id?: string | null
          approved_at?: string | null
          change_comment?: string | null
          created_at?: string
          group_key: string
          id?: string
          recommended_length_max?: number | null
          recommended_length_min?: number | null
          status?: string
          version_number?: number
        }
        Update: {
          analysis_id?: string | null
          approved_at?: string | null
          change_comment?: string | null
          created_at?: string
          group_key?: string
          id?: string
          recommended_length_max?: number | null
          recommended_length_min?: number | null
          status?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "text_requirement_version_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "text_requirement_analysis"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
