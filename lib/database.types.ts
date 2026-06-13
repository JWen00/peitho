export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      topics: {
        Row: {
          id: string;
          text: string;
          category: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          text: string;
          category?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          text?: string;
          category?: string | null;
          active?: boolean;
          created_at?: string;
        };
      };
      sessions: {
        Row: {
          id: string;
          user_id: string;
          topic_id: string | null;
          topic_text: string;
          transcript: string | null;
          audio_path: string | null;
          duration_seconds: number | null;
          attempt_number: number;
          local_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          topic_id?: string | null;
          topic_text: string;
          transcript?: string | null;
          audio_path?: string | null;
          duration_seconds?: number | null;
          attempt_number?: number;
          local_date: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          topic_id?: string | null;
          topic_text?: string;
          transcript?: string | null;
          audio_path?: string | null;
          duration_seconds?: number | null;
          attempt_number?: number;
          local_date?: string;
          created_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
