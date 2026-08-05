export type ContentType =
  | "cost_guide"
  | "comparison_guide"
  | "how_to_guide"
  | "statistics_trends"
  | "explainer"
  | "case_study"
  | "vertical_deep_dive"
  | "thought_leadership";
export type Mode = "composition" | "interview";
export type Funnel = "TOFU" | "MOFU" | "BOFU";

export interface Project {
  id: string;
  topic: string;
  url: string | null;
  content_type: ContentType;
  mode: Mode;
  icps: number[];
  funnel_stage: Funnel | null;
  keyword: string | null;
  pod: string | null;
  writer_id: string | null;
  benchmark_url: string | null;
  competitor_url: string | null;
  company_domain: string;
  status: string;
  current_stage: number;
  created_at: string;
  updated_at: string;
  user_notes?: string | null;
  ai_proposed_brief?: any;
  keyword_cluster?: KeywordEntry[];
  user_overrides?: Record<string, any>;
  playbook_version?: number | null;
  brief_confirmed_at?: string | null;
  brand_id?: string | null;
}

export interface KeywordEntry {
  keyword: string;
  estimated_monthly_volume?: number;
  volume_is_estimated?: boolean;
  competition: "low" | "medium" | "high";
  is_primary: boolean;
  reasoning?: string;
}

export interface BriefProposal {
  keyword_cluster: KeywordEntry[];
  primary_keyword_reasoning?: string;
  funnel_stage: Funnel;
  funnel_reasoning?: string;
  icps: { id: number; label: string; playbook_citation: string }[];
  pod: string;
  pod_reasoning?: string;
  benchmark_candidates: { url: string; publisher: string; why: string; rank: number }[];
  competitor_candidates: { url: string; publisher?: string; serp_position?: number; why: string; rank: number }[];
  content_type: ContentType;
  mode: Mode;
  mode_reasoning?: string;
  ai_citation_landscape?: {
    sample_buyer_prompts?: string[];
    top_cited_sources?: { url: string; publisher: string; kind: string; why_cited: string }[];
    citation_gaps?: string[];
    suggested_authority_sources?: { publisher: string; url_or_topic?: string; why: string }[];
  };
  atomic_question_map?: {
    question: string;
    liftable_paragraph: boolean;
    suggested_location: string;
    requires_citation: boolean;
  }[];
  entity_data_requirements?: {
    minimum_named_entities?: Record<string, number>;
    required_authority_citations?: number;
    recommended_schema_types?: string[];
    originality_threshold?: number;
  };
}

export interface ProofPoint {
  id: string;
  project_id: string;
  claim: string;
  source_url: string | null;
  source_publication: string | null;
  publication_date: string | null;
  verification_status: "verified" | "unverified" | "needs writer confirmation";
  starred: boolean;
}

export interface OutlineSection {
  id: string;
  heading: string;
  level: "H2" | "H3";
  job: string;
  word_count: number;
  proof_points?: string[];
  internal_links?: string[];
  why_it_converts?: string;
  atomic_questions?: string[];
  required_entities?: string[];
  required_citations?: string[];
  ai_citation_likelihood?: "high" | "medium" | "low";
  schema_markup_types?: string[];
}