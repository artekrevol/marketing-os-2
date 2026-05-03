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
      draft_scores: {
        Row: {
          ai_citation_readiness_score: number | null
          atomic_chunks_count: number | null
          atomic_questions_count: number | null
          banned_phrase_count: number | null
          brand_id: string
          citation_completeness: number | null
          created_at: string
          final_draft: string | null
          id: string
          originality_score: number | null
          project_id: string
          schema_markup_recommendations: Json | null
          updated_at: string
          voice_match_score: number | null
          word_count: number | null
        }
        Insert: {
          ai_citation_readiness_score?: number | null
          atomic_chunks_count?: number | null
          atomic_questions_count?: number | null
          banned_phrase_count?: number | null
          brand_id?: string
          citation_completeness?: number | null
          created_at?: string
          final_draft?: string | null
          id?: string
          originality_score?: number | null
          project_id: string
          schema_markup_recommendations?: Json | null
          updated_at?: string
          voice_match_score?: number | null
          word_count?: number | null
        }
        Update: {
          ai_citation_readiness_score?: number | null
          atomic_chunks_count?: number | null
          atomic_questions_count?: number | null
          banned_phrase_count?: number | null
          brand_id?: string
          citation_completeness?: number | null
          created_at?: string
          final_draft?: string | null
          id?: string
          originality_score?: number | null
          project_id?: string
          schema_markup_recommendations?: Json | null
          updated_at?: string
          voice_match_score?: number | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_scores_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      drafts: {
        Row: {
          ai_citation_readiness_score: number | null
          approved: boolean | null
          atomic_chunks_count: number | null
          brand_id: string
          citation_count: number | null
          content: string | null
          created_at: string
          dismissed_voice_flags: Json
          entity_density_score: number | null
          id: string
          last_edited_by: string | null
          project_id: string
          review_questions: Json | null
          revision_count: number | null
          schema_markup_recommendations: Json | null
          section_heading: string | null
          section_id: string
          updated_at: string
          voice_flags: Json | null
          voice_match_score: number | null
        }
        Insert: {
          ai_citation_readiness_score?: number | null
          approved?: boolean | null
          atomic_chunks_count?: number | null
          brand_id?: string
          citation_count?: number | null
          content?: string | null
          created_at?: string
          dismissed_voice_flags?: Json
          entity_density_score?: number | null
          id?: string
          last_edited_by?: string | null
          project_id: string
          review_questions?: Json | null
          revision_count?: number | null
          schema_markup_recommendations?: Json | null
          section_heading?: string | null
          section_id: string
          updated_at?: string
          voice_flags?: Json | null
          voice_match_score?: number | null
        }
        Update: {
          ai_citation_readiness_score?: number | null
          approved?: boolean | null
          atomic_chunks_count?: number | null
          brand_id?: string
          citation_count?: number | null
          content?: string | null
          created_at?: string
          dismissed_voice_flags?: Json
          entity_density_score?: number | null
          id?: string
          last_edited_by?: string | null
          project_id?: string
          review_questions?: Json | null
          revision_count?: number | null
          schema_markup_recommendations?: Json | null
          section_heading?: string | null
          section_id?: string
          updated_at?: string
          voice_flags?: Json | null
          voice_match_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "drafts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      fetched_pages: {
        Row: {
          brand_id: string | null
          byte_size: number | null
          content: string
          fetched_at: string
          id: string
          title: string | null
          url: string
        }
        Insert: {
          brand_id?: string | null
          byte_size?: number | null
          content: string
          fetched_at?: string
          id?: string
          title?: string | null
          url: string
        }
        Update: {
          brand_id?: string | null
          byte_size?: number | null
          content?: string
          fetched_at?: string
          id?: string
          title?: string | null
          url?: string
        }
        Relationships: []
      }
      interview_answers: {
        Row: {
          answer: string | null
          brand_id: string
          created_at: string
          follow_up: string | null
          id: string
          project_id: string
          question: string
          section_id: string
        }
        Insert: {
          answer?: string | null
          brand_id?: string
          created_at?: string
          follow_up?: string | null
          id?: string
          project_id: string
          question: string
          section_id: string
        }
        Update: {
          answer?: string | null
          brand_id?: string
          created_at?: string
          follow_up?: string | null
          id?: string
          project_id?: string
          question?: string
          section_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_answers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      outlines: {
        Row: {
          brand_id: string
          created_at: string
          cta_placement: string | null
          h1: string | null
          id: string
          internal_links: Json | null
          locked_at: string | null
          meta_description: string | null
          project_id: string
          sections: Json | null
          tone_reminder: string | null
          updated_at: string
        }
        Insert: {
          brand_id?: string
          created_at?: string
          cta_placement?: string | null
          h1?: string | null
          id?: string
          internal_links?: Json | null
          locked_at?: string | null
          meta_description?: string | null
          project_id: string
          sections?: Json | null
          tone_reminder?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          cta_placement?: string | null
          h1?: string | null
          id?: string
          internal_links?: Json | null
          locked_at?: string | null
          meta_description?: string | null
          project_id?: string
          sections?: Json | null
          tone_reminder?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outlines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      page_events: {
        Row: {
          brand_id: string | null
          created_at: string
          duration_ms: number | null
          entered_at: string
          id: string
          path: string
          project_id: string | null
          referrer: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string
        }
        Insert: {
          brand_id?: string | null
          created_at?: string
          duration_ms?: number | null
          entered_at?: string
          id?: string
          path: string
          project_id?: string | null
          referrer?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id: string
        }
        Update: {
          brand_id?: string | null
          created_at?: string
          duration_ms?: number | null
          entered_at?: string
          id?: string
          path?: string
          project_id?: string | null
          referrer?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      playbook: {
        Row: {
          brand_id: string | null
          content_markdown: string
          created_at: string
          id: string
          source_filename: string | null
          uploaded_at: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          brand_id?: string | null
          content_markdown: string
          created_at?: string
          id?: string
          source_filename?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          brand_id?: string | null
          content_markdown?: string
          created_at?: string
          id?: string
          source_filename?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: []
      }
      playbook_sections: {
        Row: {
          always_include: boolean
          brand_id: string | null
          created_at: string
          id: string
          section_content: string
          section_number: number
          section_title: string | null
          section_token_estimate: number
          version: number
        }
        Insert: {
          always_include?: boolean
          brand_id?: string | null
          created_at?: string
          id?: string
          section_content: string
          section_number: number
          section_title?: string | null
          section_token_estimate?: number
          version: number
        }
        Update: {
          always_include?: boolean
          brand_id?: string | null
          created_at?: string
          id?: string
          section_content?: string
          section_number?: number
          section_title?: string | null
          section_token_estimate?: number
          version?: number
        }
        Relationships: []
      }
      projects: {
        Row: {
          ai_proposed_brief: Json | null
          benchmark_url: string | null
          brand_id: string
          brief_confirmed_at: string | null
          brief_error: string | null
          company_domain: string | null
          competitor_url: string | null
          content_type: string
          created_at: string
          created_by: string | null
          current_stage: number
          funnel_stage: string | null
          icps: number[] | null
          id: string
          keyword: string | null
          keyword_cluster: Json | null
          mode: string
          playbook_version: number | null
          pod: string | null
          status: string
          topic: string
          updated_at: string
          url: string | null
          user_notes: string | null
          user_overrides: Json | null
          writer_id: string | null
        }
        Insert: {
          ai_proposed_brief?: Json | null
          benchmark_url?: string | null
          brand_id: string
          brief_confirmed_at?: string | null
          brief_error?: string | null
          company_domain?: string | null
          competitor_url?: string | null
          content_type: string
          created_at?: string
          created_by?: string | null
          current_stage?: number
          funnel_stage?: string | null
          icps?: number[] | null
          id?: string
          keyword?: string | null
          keyword_cluster?: Json | null
          mode?: string
          playbook_version?: number | null
          pod?: string | null
          status?: string
          topic: string
          updated_at?: string
          url?: string | null
          user_notes?: string | null
          user_overrides?: Json | null
          writer_id?: string | null
        }
        Update: {
          ai_proposed_brief?: Json | null
          benchmark_url?: string | null
          brand_id?: string
          brief_confirmed_at?: string | null
          brief_error?: string | null
          company_domain?: string | null
          competitor_url?: string | null
          content_type?: string
          created_at?: string
          created_by?: string | null
          current_stage?: number
          funnel_stage?: string | null
          icps?: number[] | null
          id?: string
          keyword?: string | null
          keyword_cluster?: Json | null
          mode?: string
          playbook_version?: number | null
          pod?: string | null
          status?: string
          topic?: string
          updated_at?: string
          url?: string | null
          user_notes?: string | null
          user_overrides?: Json | null
          writer_id?: string | null
        }
        Relationships: []
      }
      proof_points: {
        Row: {
          brand_id: string
          claim: string
          created_at: string
          id: string
          project_id: string
          publication_date: string | null
          source_publication: string | null
          source_url: string | null
          starred: boolean | null
          verification_status: string | null
        }
        Insert: {
          brand_id?: string
          claim: string
          created_at?: string
          id?: string
          project_id: string
          publication_date?: string | null
          source_publication?: string | null
          source_url?: string | null
          starred?: boolean | null
          verification_status?: string | null
        }
        Update: {
          brand_id?: string
          claim?: string
          created_at?: string
          id?: string
          project_id?: string
          publication_date?: string | null
          source_publication?: string | null
          source_url?: string | null
          starred?: boolean | null
          verification_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proof_points_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      research_briefs: {
        Row: {
          ai_citation_landscape: Json | null
          angle_inventory: Json | null
          approved_at: string | null
          atomic_question_map: Json | null
          benchmark_teardown: Json | null
          brand_id: string
          competitor_teardown: Json | null
          conversion_signals: Json | null
          created_at: string
          entity_data_requirements: Json | null
          id: string
          progress_error: string | null
          progress_stage: number | null
          progress_status: Json | null
          project_id: string
          proof_points_status: string | null
          raw_output: string | null
          search_intent: Json | null
          sub_status: Json
          synergy_map: Json | null
          updated_at: string
        }
        Insert: {
          ai_citation_landscape?: Json | null
          angle_inventory?: Json | null
          approved_at?: string | null
          atomic_question_map?: Json | null
          benchmark_teardown?: Json | null
          brand_id?: string
          competitor_teardown?: Json | null
          conversion_signals?: Json | null
          created_at?: string
          entity_data_requirements?: Json | null
          id?: string
          progress_error?: string | null
          progress_stage?: number | null
          progress_status?: Json | null
          project_id: string
          proof_points_status?: string | null
          raw_output?: string | null
          search_intent?: Json | null
          sub_status?: Json
          synergy_map?: Json | null
          updated_at?: string
        }
        Update: {
          ai_citation_landscape?: Json | null
          angle_inventory?: Json | null
          approved_at?: string | null
          atomic_question_map?: Json | null
          benchmark_teardown?: Json | null
          brand_id?: string
          competitor_teardown?: Json | null
          conversion_signals?: Json | null
          created_at?: string
          entity_data_requirements?: Json | null
          id?: string
          progress_error?: string | null
          progress_stage?: number | null
          progress_status?: Json | null
          project_id?: string
          proof_points_status?: string | null
          raw_output?: string | null
          search_intent?: Json | null
          sub_status?: Json
          synergy_map?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_briefs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_logs: {
        Row: {
          brand_id: string | null
          cache_creation_input_tokens: number | null
          cache_read_input_tokens: number | null
          created_at: string
          duration_ms: number | null
          error: string | null
          estimated_cost_usd: number | null
          id: string
          input_tokens: number | null
          metadata_user_id: string | null
          model: string | null
          ok: boolean | null
          output_tokens: number | null
          project_id: string | null
          stage: string | null
          sub_stage: string | null
        }
        Insert: {
          brand_id?: string | null
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          metadata_user_id?: string | null
          model?: string | null
          ok?: boolean | null
          output_tokens?: number | null
          project_id?: string | null
          stage?: string | null
          sub_stage?: string | null
        }
        Update: {
          brand_id?: string | null
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          metadata_user_id?: string | null
          model?: string | null
          ok?: boolean | null
          output_tokens?: number | null
          project_id?: string | null
          stage?: string | null
          sub_stage?: string | null
        }
        Relationships: []
      }
      brands: {
        Row: {
          created_at: string
          id: string
          name: string
          primary_domain: string | null
          slug: string
          thresholds: Json
          updated_at: string
          voice_profile: Json
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          primary_domain?: string | null
          slug: string
          thresholds?: Json
          updated_at?: string
          voice_profile?: Json
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          primary_domain?: string | null
          slug?: string
          thresholds?: Json
          updated_at?: string
          voice_profile?: Json
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          brand_access: string[]
          created_at: string
          display_name: string | null
          pod: string | null
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brand_access?: string[]
          created_at?: string
          display_name?: string | null
          pod?: string | null
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brand_access?: string[]
          created_at?: string
          display_name?: string | null
          pod?: string | null
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          actor_id: string | null
          brand_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json
          subject_id: string | null
          subject_type: string | null
        }
        Insert: {
          actor_id?: string | null
          brand_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          subject_id?: string | null
          subject_type?: string | null
        }
        Update: {
          actor_id?: string | null
          brand_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          subject_id?: string | null
          subject_type?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          brand_id: string | null
          created_at: string
          id: string
          justification: string
          metadata: Json
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          brand_id?: string | null
          created_at?: string
          id?: string
          justification: string
          metadata?: Json
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          brand_id?: string | null
          created_at?: string
          id?: string
          justification?: string
          metadata?: Json
          target_id?: string | null
          target_type?: string | null
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
      voice_library: {
        Row: {
          brand_id: string | null
          captured_at: string
          edit_type: string | null
          edited_human_text: string
          id: string
          original_ai_text: string
          project_id: string | null
          writer_id: string | null
        }
        Insert: {
          brand_id?: string | null
          captured_at?: string
          edit_type?: string | null
          edited_human_text: string
          id?: string
          original_ai_text: string
          project_id?: string | null
          writer_id?: string | null
        }
        Update: {
          brand_id?: string | null
          captured_at?: string
          edit_type?: string | null
          edited_human_text?: string
          id?: string
          original_ai_text?: string
          project_id?: string | null
          writer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_library_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_usage_summary: { Args: { _since?: string }; Returns: Json }
      admin_user_activity: {
        Args: { _since?: string }
        Returns: {
          avg_seconds: number
          last_seen: string
          max_seconds: number
          path: string
          total_seconds: number
          user_email: string
          user_id: string
          visits: number
        }[]
      }
      can_access_app: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_tekrevol_member: { Args: { _user_id: string }; Returns: boolean }
      list_app_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          is_admin: boolean
          is_tekrevol: boolean
          last_sign_in_at: string
          project_count: number
          user_id: string
        }[]
      }
      list_app_users_v2: {
        Args: never
        Returns: {
          brand_access: string[]
          created_at: string
          email: string
          is_admin: boolean
          is_tekrevol: boolean
          last_sign_in_at: string
          pod: string | null
          project_count: number
          role: string
          user_id: string
        }[]
      }
      current_user_brand_access: { Args: never; Returns: string[] }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "member"
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
      app_role: ["admin", "member"],
    },
  },
} as const
