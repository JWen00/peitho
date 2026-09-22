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
        Relationships: [];
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
          client_talk_id: string | null;
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
          /** Set by the `sessions_set_attempt_number` trigger; ignored on insert. */
          attempt_number?: number;
          local_date: string;
          client_talk_id?: string | null;
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
          client_talk_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'sessions_topic_id_fkey';
            columns: ['topic_id'];
            isOneToOne: false;
            referencedRelation: 'topics';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      talk_heatmap: {
        Args: { from_date: string; to_date: string };
        Returns: { talk_date: string; talk_count: number }[];
      };
    };
    Enums: Record<string, never>;
  };
}
