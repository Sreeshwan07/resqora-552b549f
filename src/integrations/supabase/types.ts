export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      accident_media: {
        Row: {
          address: string | null;
          analysis: Json | null;
          captured_at: string;
          created_at: string;
          id: string;
          incident_id: string;
          latitude: number | null;
          longitude: number | null;
          media_type: string;
          mime_type: string | null;
          size_bytes: number | null;
          storage_path: string;
          upload_status: string;
          user_id: string;
        };
        Insert: {
          address?: string | null;
          analysis?: Json | null;
          captured_at?: string;
          created_at?: string;
          id?: string;
          incident_id: string;
          latitude?: number | null;
          longitude?: number | null;
          media_type: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          storage_path: string;
          upload_status?: string;
          user_id: string;
        };
        Update: {
          address?: string | null;
          analysis?: Json | null;
          captured_at?: string;
          created_at?: string;
          id?: string;
          incident_id?: string;
          latitude?: number | null;
          longitude?: number | null;
          media_type?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          storage_path?: string;
          upload_status?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      activity_logs: {
        Row: {
          action: string;
          created_at: string;
          detail: string | null;
          id: string;
          user_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          detail?: string | null;
          id?: string;
          user_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          detail?: string | null;
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      blood_donors: {
        Row: {
          available: boolean;
          blood_group: string;
          city: string;
          created_at: string;
          full_name: string;
          id: string;
          last_donation_date: string | null;
          phone: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          available?: boolean;
          blood_group: string;
          city: string;
          created_at?: string;
          full_name: string;
          id?: string;
          last_donation_date?: string | null;
          phone: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          available?: boolean;
          blood_group?: string;
          city?: string;
          created_at?: string;
          full_name?: string;
          id?: string;
          last_donation_date?: string | null;
          phone?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      disaster_zones: {
        Row: {
          active: boolean;
          advisory: string | null;
          created_at: string;
          created_by: string | null;
          ends_at: string | null;
          id: string;
          is_simulation: boolean;
          latitude: number;
          longitude: number;
          name: string;
          radius_km: number;
          severity: string;
          starts_at: string;
          updated_at: string;
          zone_type: string;
        };
        Insert: {
          active?: boolean;
          advisory?: string | null;
          created_at?: string;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          is_simulation?: boolean;
          latitude: number;
          longitude: number;
          name: string;
          radius_km?: number;
          severity?: string;
          starts_at?: string;
          updated_at?: string;
          zone_type?: string;
        };
        Update: {
          active?: boolean;
          advisory?: string | null;
          created_at?: string;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          is_simulation?: boolean;
          latitude?: number;
          longitude?: number;
          name?: string;
          radius_km?: number;
          severity?: string;
          starts_at?: string;
          updated_at?: string;
          zone_type?: string;
        };
        Relationships: [];
      };
      emergencies: {
        Row: {
          ack_at: string | null;
          ack_by: string | null;
          ack_timeout_seconds: number;
          address: string | null;
          ai_first_aid: string[] | null;
          ai_recommendation: string | null;
          ai_summary: string | null;
          connectivity_status: string;
          created_at: string;
          duration_seconds: number | null;
          escalated_at: string | null;
          escalation_level: number;
          hospital_status: string;
          id: string;
          idempotency_key: string | null;
          incident_description: string | null;
          incident_type: string;
          is_mass_casualty: boolean;
          is_simulation: boolean;
          latitude: number | null;
          live_status: string;
          location_accuracy: number | null;
          location_source: string | null;
          location_updated_at: string | null;
          longitude: number | null;
          notes: string | null;
          notified_at: string | null;
          phase: string;
          phase_updated_at: string;
          public_code: string | null;
          relay_state: string;
          reporter_phone: string | null;
          resolution_status: string | null;
          resolved_at: string | null;
          responder_status: string;
          severity: string;
          source: string;
          started_at: string;
          status: string;
          type: string;
          updated_at: string;
          user_id: string | null;
          victim_count: number;
        };
        Insert: {
          ack_at?: string | null;
          ack_by?: string | null;
          ack_timeout_seconds?: number;
          address?: string | null;
          ai_first_aid?: string[] | null;
          ai_recommendation?: string | null;
          ai_summary?: string | null;
          connectivity_status?: string;
          created_at?: string;
          duration_seconds?: number | null;
          escalated_at?: string | null;
          escalation_level?: number;
          hospital_status?: string;
          id?: string;
          idempotency_key?: string | null;
          incident_description?: string | null;
          incident_type?: string;
          is_mass_casualty?: boolean;
          is_simulation?: boolean;
          latitude?: number | null;
          live_status?: string;
          location_accuracy?: number | null;
          location_source?: string | null;
          location_updated_at?: string | null;
          longitude?: number | null;
          notes?: string | null;
          notified_at?: string | null;
          phase?: string;
          phase_updated_at?: string;
          public_code?: string | null;
          relay_state?: string;
          reporter_phone?: string | null;
          resolution_status?: string | null;
          resolved_at?: string | null;
          responder_status?: string;
          severity?: string;
          source?: string;
          started_at?: string;
          status?: string;
          type?: string;
          updated_at?: string;
          user_id?: string | null;
          victim_count?: number;
        };
        Update: {
          ack_at?: string | null;
          ack_by?: string | null;
          ack_timeout_seconds?: number;
          address?: string | null;
          ai_first_aid?: string[] | null;
          ai_recommendation?: string | null;
          ai_summary?: string | null;
          connectivity_status?: string;
          created_at?: string;
          duration_seconds?: number | null;
          escalated_at?: string | null;
          escalation_level?: number;
          hospital_status?: string;
          id?: string;
          idempotency_key?: string | null;
          incident_description?: string | null;
          incident_type?: string;
          is_mass_casualty?: boolean;
          is_simulation?: boolean;
          latitude?: number | null;
          live_status?: string;
          location_accuracy?: number | null;
          location_source?: string | null;
          location_updated_at?: string | null;
          longitude?: number | null;
          notes?: string | null;
          notified_at?: string | null;
          phase?: string;
          phase_updated_at?: string;
          public_code?: string | null;
          relay_state?: string;
          reporter_phone?: string | null;
          resolution_status?: string | null;
          resolved_at?: string | null;
          responder_status?: string;
          severity?: string;
          source?: string;
          started_at?: string;
          status?: string;
          type?: string;
          updated_at?: string;
          user_id?: string | null;
          victim_count?: number;
        };
        Relationships: [];
      };
      emergency_alert_deliveries: {
        Row: {
          channel: string;
          contact_email: string | null;
          contact_id: string | null;
          contact_name: string;
          contact_phone: string | null;
          created_at: string;
          emergency_id: string;
          error: string | null;
          id: string;
          kind: string;
          sent_at: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          channel?: string;
          contact_email?: string | null;
          contact_id?: string | null;
          contact_name: string;
          contact_phone?: string | null;
          created_at?: string;
          emergency_id: string;
          error?: string | null;
          id?: string;
          kind?: string;
          sent_at?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          channel?: string;
          contact_email?: string | null;
          contact_id?: string | null;
          contact_name?: string;
          contact_phone?: string | null;
          created_at?: string;
          emergency_id?: string;
          error?: string | null;
          id?: string;
          kind?: string;
          sent_at?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "emergency_alert_deliveries_emergency_id_fkey";
            columns: ["emergency_id"];
            isOneToOne: false;
            referencedRelation: "emergencies";
            referencedColumns: ["id"];
          },
        ];
      };
      emergency_contacts: {
        Row: {
          created_at: string;
          email: string | null;
          id: string;
          is_guardian: boolean;
          name: string;
          phone: string;
          position: number;
          relationship: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          id?: string;
          is_guardian?: boolean;
          name: string;
          phone: string;
          position?: number;
          relationship: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          id?: string;
          is_guardian?: boolean;
          name?: string;
          phone?: string;
          position?: number;
          relationship?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      emergency_events: {
        Row: {
          created_at: string;
          detail: string | null;
          emergency_id: string;
          id: string;
          label: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          detail?: string | null;
          emergency_id: string;
          id?: string;
          label: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          detail?: string | null;
          emergency_id?: string;
          id?: string;
          label?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "emergency_events_emergency_id_fkey";
            columns: ["emergency_id"];
            isOneToOne: false;
            referencedRelation: "emergencies";
            referencedColumns: ["id"];
          },
        ];
      };
      emergency_notes: {
        Row: {
          category: string;
          content: string;
          created_at: string;
          id: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          category?: string;
          content: string;
          created_at?: string;
          id?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          category?: string;
          content?: string;
          created_at?: string;
          id?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      emergency_victims: {
        Row: {
          assigned_responder: string | null;
          created_at: string;
          emergency_id: string;
          hospital: string | null;
          id: string;
          label: string;
          notes: string | null;
          priority: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          assigned_responder?: string | null;
          created_at?: string;
          emergency_id: string;
          hospital?: string | null;
          id?: string;
          label: string;
          notes?: string | null;
          priority?: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          assigned_responder?: string | null;
          created_at?: string;
          emergency_id?: string;
          hospital?: string | null;
          id?: string;
          label?: string;
          notes?: string | null;
          priority?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "emergency_victims_emergency_id_fkey";
            columns: ["emergency_id"];
            isOneToOne: false;
            referencedRelation: "emergencies";
            referencedColumns: ["id"];
          },
        ];
      };
      favorite_places: {
        Row: {
          address: string | null;
          category: string;
          created_at: string;
          id: string;
          latitude: number | null;
          longitude: number | null;
          name: string;
          phone: string | null;
          place_key: string;
          user_id: string;
        };
        Insert: {
          address?: string | null;
          category: string;
          created_at?: string;
          id?: string;
          latitude?: number | null;
          longitude?: number | null;
          name: string;
          phone?: string | null;
          place_key: string;
          user_id: string;
        };
        Update: {
          address?: string | null;
          category?: string;
          created_at?: string;
          id?: string;
          latitude?: number | null;
          longitude?: number | null;
          name?: string;
          phone?: string | null;
          place_key?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      guardian_notes: {
        Row: {
          created_at: string;
          emergency_id: string;
          guardian_name: string;
          guardian_session_id: string | null;
          id: string;
          note: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          emergency_id: string;
          guardian_name: string;
          guardian_session_id?: string | null;
          id?: string;
          note: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          emergency_id?: string;
          guardian_name?: string;
          guardian_session_id?: string | null;
          id?: string;
          note?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guardian_notes_emergency_id_fkey";
            columns: ["emergency_id"];
            isOneToOne: false;
            referencedRelation: "emergencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guardian_notes_guardian_session_id_fkey";
            columns: ["guardian_session_id"];
            isOneToOne: false;
            referencedRelation: "guardian_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      guardian_sessions: {
        Row: {
          acknowledged_at: string | null;
          active: boolean;
          created_at: string;
          emergency_id: string;
          expires_at: string | null;
          guardian_contact_id: string | null;
          guardian_email: string | null;
          guardian_name: string;
          guardian_phone: string | null;
          id: string;
          opened_at: string | null;
          token: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          acknowledged_at?: string | null;
          active?: boolean;
          created_at?: string;
          emergency_id: string;
          expires_at?: string | null;
          guardian_contact_id?: string | null;
          guardian_email?: string | null;
          guardian_name: string;
          guardian_phone?: string | null;
          id?: string;
          opened_at?: string | null;
          token: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          acknowledged_at?: string | null;
          active?: boolean;
          created_at?: string;
          emergency_id?: string;
          expires_at?: string | null;
          guardian_contact_id?: string | null;
          guardian_email?: string | null;
          guardian_name?: string;
          guardian_phone?: string | null;
          id?: string;
          opened_at?: string | null;
          token?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guardian_sessions_emergency_id_fkey";
            columns: ["emergency_id"];
            isOneToOne: false;
            referencedRelation: "emergencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guardian_sessions_guardian_contact_id_fkey";
            columns: ["guardian_contact_id"];
            isOneToOne: false;
            referencedRelation: "emergency_contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      guardian_tasks: {
        Row: {
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          done: boolean;
          emergency_id: string;
          id: string;
          label: string;
          task_key: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          done?: boolean;
          emergency_id: string;
          id?: string;
          label: string;
          task_key: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          done?: boolean;
          emergency_id?: string;
          id?: string;
          label?: string;
          task_key?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guardian_tasks_emergency_id_fkey";
            columns: ["emergency_id"];
            isOneToOne: false;
            referencedRelation: "emergencies";
            referencedColumns: ["id"];
          },
        ];
      };
      hospital_handoffs: {
        Row: {
          bed_or_ward: string | null;
          created_at: string;
          department: string | null;
          emergency_id: string;
          expected_arrival: string | null;
          handover_notes: string | null;
          hospital_name: string;
          id: string;
          received_at: string | null;
          received_by: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          bed_or_ward?: string | null;
          created_at?: string;
          department?: string | null;
          emergency_id: string;
          expected_arrival?: string | null;
          handover_notes?: string | null;
          hospital_name: string;
          id?: string;
          received_at?: string | null;
          received_by?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          bed_or_ward?: string | null;
          created_at?: string;
          department?: string | null;
          emergency_id?: string;
          expected_arrival?: string | null;
          handover_notes?: string | null;
          hospital_name?: string;
          id?: string;
          received_at?: string | null;
          received_by?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hospital_handoffs_emergency_id_fkey";
            columns: ["emergency_id"];
            isOneToOne: false;
            referencedRelation: "emergencies";
            referencedColumns: ["id"];
          },
        ];
      };
      incident_assignments: {
        Row: {
          accepted_at: string | null;
          assigned_by: string | null;
          completed_at: string | null;
          created_at: string;
          emergency_id: string;
          eta_minutes: number | null;
          id: string;
          notes: string | null;
          resource_id: string | null;
          resource_name: string;
          resource_type: string;
          responder_user_id: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          assigned_by?: string | null;
          completed_at?: string | null;
          created_at?: string;
          emergency_id: string;
          eta_minutes?: number | null;
          id?: string;
          notes?: string | null;
          resource_id?: string | null;
          resource_name: string;
          resource_type?: string;
          responder_user_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          assigned_by?: string | null;
          completed_at?: string | null;
          created_at?: string;
          emergency_id?: string;
          eta_minutes?: number | null;
          id?: string;
          notes?: string | null;
          resource_id?: string | null;
          resource_name?: string;
          resource_type?: string;
          responder_user_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "incident_assignments_emergency_id_fkey";
            columns: ["emergency_id"];
            isOneToOne: false;
            referencedRelation: "emergencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incident_assignments_resource_id_fkey";
            columns: ["resource_id"];
            isOneToOne: false;
            referencedRelation: "response_resources";
            referencedColumns: ["id"];
          },
        ];
      };
      location_pings: {
        Row: {
          accuracy: number | null;
          battery_level: number | null;
          created_at: string;
          emergency_id: string;
          id: string;
          latitude: number;
          longitude: number;
          speed: number | null;
          user_id: string;
        };
        Insert: {
          accuracy?: number | null;
          battery_level?: number | null;
          created_at?: string;
          emergency_id: string;
          id?: string;
          latitude: number;
          longitude: number;
          speed?: number | null;
          user_id: string;
        };
        Update: {
          accuracy?: number | null;
          battery_level?: number | null;
          created_at?: string;
          emergency_id?: string;
          id?: string;
          latitude?: number;
          longitude?: number;
          speed?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "location_pings_emergency_id_fkey";
            columns: ["emergency_id"];
            isOneToOne: false;
            referencedRelation: "emergencies";
            referencedColumns: ["id"];
          },
        ];
      };
      medai_conversations: {
        Row: {
          created_at: string;
          id: string;
          is_favourite: boolean;
          language: string;
          shared_medical_history: boolean;
          specialist: string | null;
          title: string;
          updated_at: string;
          urgency: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_favourite?: boolean;
          language?: string;
          shared_medical_history?: boolean;
          specialist?: string | null;
          title?: string;
          updated_at?: string;
          urgency?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_favourite?: boolean;
          language?: string;
          shared_medical_history?: boolean;
          specialist?: string | null;
          title?: string;
          updated_at?: string;
          urgency?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      medai_messages: {
        Row: {
          content: string;
          conversation_id: string;
          created_at: string;
          has_image: boolean;
          id: string;
          role: string;
          specialist: string | null;
          urgency: string | null;
          user_id: string;
        };
        Insert: {
          content: string;
          conversation_id: string;
          created_at?: string;
          has_image?: boolean;
          id?: string;
          role?: string;
          specialist?: string | null;
          urgency?: string | null;
          user_id: string;
        };
        Update: {
          content?: string;
          conversation_id?: string;
          created_at?: string;
          has_image?: boolean;
          id?: string;
          role?: string;
          specialist?: string | null;
          urgency?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "medai_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "medai_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          category: string;
          created_at: string;
          id: string;
          read: boolean;
          title: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          category?: string;
          created_at?: string;
          id?: string;
          read?: boolean;
          title: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          category?: string;
          created_at?: string;
          id?: string;
          read?: boolean;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      preparedness_tasks: {
        Row: {
          category: string;
          completed_at: string | null;
          created_at: string;
          done: boolean;
          id: string;
          label: string;
          task_key: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          category?: string;
          completed_at?: string | null;
          created_at?: string;
          done?: boolean;
          id?: string;
          label: string;
          task_key: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          category?: string;
          completed_at?: string | null;
          created_at?: string;
          done?: boolean;
          id?: string;
          label?: string;
          task_key?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          allergies: string | null;
          approval_status: Database["public"]["Enums"]["approval_status"];
          approved_at: string | null;
          approved_by: string | null;
          avatar_url: string | null;
          blood_group: string | null;
          crash_detection: boolean;
          created_at: string;
          current_city: string | null;
          date_of_birth: string | null;
          email: string | null;
          full_name: string | null;
          gender: string | null;
          home_address: string | null;
          id: string;
          language: string;
          location_sharing: boolean;
          medical_conditions: string | null;
          medications: string | null;
          notify_emergency: boolean;
          notify_push: boolean;
          notify_safety_tips: boolean;
          notify_system: boolean;
          onboarding_completed: boolean;
          phone: string | null;
          preferred_hospital: string | null;
          safety_score: number;
          share_medical_in_alerts: boolean;
          theme: string;
          updated_at: string;
        };
        Insert: {
          allergies?: string | null;
          approval_status?: Database["public"]["Enums"]["approval_status"];
          approved_at?: string | null;
          approved_by?: string | null;
          avatar_url?: string | null;
          blood_group?: string | null;
          crash_detection?: boolean;
          created_at?: string;
          current_city?: string | null;
          date_of_birth?: string | null;
          email?: string | null;
          full_name?: string | null;
          gender?: string | null;
          home_address?: string | null;
          id: string;
          language?: string;
          location_sharing?: boolean;
          medical_conditions?: string | null;
          medications?: string | null;
          notify_emergency?: boolean;
          notify_push?: boolean;
          notify_safety_tips?: boolean;
          notify_system?: boolean;
          onboarding_completed?: boolean;
          phone?: string | null;
          preferred_hospital?: string | null;
          safety_score?: number;
          share_medical_in_alerts?: boolean;
          theme?: string;
          updated_at?: string;
        };
        Update: {
          allergies?: string | null;
          approval_status?: Database["public"]["Enums"]["approval_status"];
          approved_at?: string | null;
          approved_by?: string | null;
          avatar_url?: string | null;
          blood_group?: string | null;
          crash_detection?: boolean;
          created_at?: string;
          current_city?: string | null;
          date_of_birth?: string | null;
          email?: string | null;
          full_name?: string | null;
          gender?: string | null;
          home_address?: string | null;
          id?: string;
          language?: string;
          location_sharing?: boolean;
          medical_conditions?: string | null;
          medications?: string | null;
          notify_emergency?: boolean;
          notify_push?: boolean;
          notify_safety_tips?: boolean;
          notify_system?: boolean;
          onboarding_completed?: boolean;
          phone?: string | null;
          preferred_hospital?: string | null;
          safety_score?: number;
          share_medical_in_alerts?: boolean;
          theme?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      push_tokens: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          last_seen_at: string;
          platform: string;
          token: string;
          updated_at: string;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          last_seen_at?: string;
          platform?: string;
          token: string;
          updated_at?: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          last_seen_at?: string;
          platform?: string;
          token?: string;
          updated_at?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      responder_profiles: {
        Row: {
          active: boolean;
          availability: string;
          created_at: string;
          full_name: string;
          id: string;
          latitude: number | null;
          location_updated_at: string | null;
          longitude: number | null;
          organisation: string | null;
          phone: string | null;
          responder_type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          active?: boolean;
          availability?: string;
          created_at?: string;
          full_name: string;
          id?: string;
          latitude?: number | null;
          location_updated_at?: string | null;
          longitude?: number | null;
          organisation?: string | null;
          phone?: string | null;
          responder_type?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          active?: boolean;
          availability?: string;
          created_at?: string;
          full_name?: string;
          id?: string;
          latitude?: number | null;
          location_updated_at?: string | null;
          longitude?: number | null;
          organisation?: string | null;
          phone?: string | null;
          responder_type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      response_resources: {
        Row: {
          active: boolean;
          assigned_emergency_id: string | null;
          base_location: string | null;
          capacity: number;
          created_at: string;
          id: string;
          identifier: string | null;
          is_simulation: boolean;
          latitude: number | null;
          longitude: number | null;
          name: string;
          organisation: string | null;
          resource_type: string;
          responder_user_id: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          assigned_emergency_id?: string | null;
          base_location?: string | null;
          capacity?: number;
          created_at?: string;
          id?: string;
          identifier?: string | null;
          is_simulation?: boolean;
          latitude?: number | null;
          longitude?: number | null;
          name: string;
          organisation?: string | null;
          resource_type?: string;
          responder_user_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          assigned_emergency_id?: string | null;
          base_location?: string | null;
          capacity?: number;
          created_at?: string;
          id?: string;
          identifier?: string | null;
          is_simulation?: boolean;
          latitude?: number | null;
          longitude?: number | null;
          name?: string;
          organisation?: string | null;
          resource_type?: string;
          responder_user_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "response_resources_assigned_emergency_id_fkey";
            columns: ["assigned_emergency_id"];
            isOneToOne: false;
            referencedRelation: "emergencies";
            referencedColumns: ["id"];
          },
        ];
      };
      resqr_ids: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          id: string;
          regenerated_count: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          id?: string;
          regenerated_count?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          id?: string;
          regenerated_count?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      safety_checkins: {
        Row: {
          confirmed_at: string | null;
          created_at: string;
          due_at: string;
          emergency_id: string | null;
          id: string;
          label: string;
          note: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          confirmed_at?: string | null;
          created_at?: string;
          due_at: string;
          emergency_id?: string | null;
          id?: string;
          label: string;
          note?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          confirmed_at?: string | null;
          created_at?: string;
          due_at?: string;
          emergency_id?: string | null;
          id?: string;
          label?: string;
          note?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "safety_checkins_emergency_id_fkey";
            columns: ["emergency_id"];
            isOneToOne: false;
            referencedRelation: "emergencies";
            referencedColumns: ["id"];
          },
        ];
      };
      security_events: {
        Row: {
          created_at: string;
          detail: string | null;
          event: string;
          id: string;
          metadata: Json;
          user_agent: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          detail?: string | null;
          event: string;
          id?: string;
          metadata?: Json;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          detail?: string | null;
          event?: string;
          id?: string;
          metadata?: Json;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      share_links: {
        Row: {
          active: boolean;
          created_at: string;
          emergency_id: string | null;
          expires_at: string | null;
          id: string;
          kind: string;
          token: string;
          user_id: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          emergency_id?: string | null;
          expires_at?: string | null;
          id?: string;
          kind?: string;
          token: string;
          user_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          emergency_id?: string | null;
          expires_at?: string | null;
          id?: string;
          kind?: string;
          token?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "share_links_emergency_id_fkey";
            columns: ["emergency_id"];
            isOneToOne: false;
            referencedRelation: "emergencies";
            referencedColumns: ["id"];
          },
        ];
      };
      sms_webhook_events: {
        Row: {
          body: string | null;
          command: string | null;
          emergency_id: string | null;
          error: string | null;
          id: string;
          matched_user_id: string | null;
          payload_hash: string;
          processed_at: string | null;
          provider: string;
          provider_message_id: string;
          received_at: string;
          reply: string | null;
          sender_phone: string;
          status: string;
        };
        Insert: {
          body?: string | null;
          command?: string | null;
          emergency_id?: string | null;
          error?: string | null;
          id?: string;
          matched_user_id?: string | null;
          payload_hash: string;
          processed_at?: string | null;
          provider: string;
          provider_message_id: string;
          received_at?: string;
          reply?: string | null;
          sender_phone: string;
          status?: string;
        };
        Update: {
          body?: string | null;
          command?: string | null;
          emergency_id?: string | null;
          error?: string | null;
          id?: string;
          matched_user_id?: string | null;
          payload_hash?: string;
          processed_at?: string | null;
          provider?: string;
          provider_message_id?: string;
          received_at?: string;
          reply?: string | null;
          sender_phone?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sms_webhook_events_emergency_id_fkey";
            columns: ["emergency_id"];
            isOneToOne: false;
            referencedRelation: "emergencies";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      volunteer_incident_matches: {
        Row: {
          assistance_required: string[];
          completed_at: string | null;
          created_at: string;
          distance_km: number | null;
          emergency_id: string;
          emergency_type: string | null;
          exclusive: boolean;
          id: string;
          offered_at: string;
          responded_at: string | null;
          status: string;
          updated_at: string;
          victim_user_id: string | null;
          volunteer_id: string;
          volunteer_user_id: string;
        };
        Insert: {
          assistance_required?: string[];
          completed_at?: string | null;
          created_at?: string;
          distance_km?: number | null;
          emergency_id: string;
          emergency_type?: string | null;
          exclusive?: boolean;
          id?: string;
          offered_at?: string;
          responded_at?: string | null;
          status?: string;
          updated_at?: string;
          victim_user_id?: string | null;
          volunteer_id: string;
          volunteer_user_id: string;
        };
        Update: {
          assistance_required?: string[];
          completed_at?: string | null;
          created_at?: string;
          distance_km?: number | null;
          emergency_id?: string;
          emergency_type?: string | null;
          exclusive?: boolean;
          id?: string;
          offered_at?: string;
          responded_at?: string | null;
          status?: string;
          updated_at?: string;
          victim_user_id?: string | null;
          volunteer_id?: string;
          volunteer_user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "volunteer_incident_matches_emergency_id_fkey";
            columns: ["emergency_id"];
            isOneToOne: false;
            referencedRelation: "emergencies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "volunteer_incident_matches_volunteer_id_fkey";
            columns: ["volunteer_id"];
            isOneToOne: false;
            referencedRelation: "volunteer_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      volunteer_profiles: {
        Row: {
          active: boolean;
          availability: string;
          created_at: string;
          experience: string | null;
          full_name: string;
          id: string;
          latitude: number | null;
          location_updated_at: string | null;
          longitude: number | null;
          phone: string;
          radius_km: number;
          share_location: boolean;
          skills: string[];
          updated_at: string;
          user_id: string;
          verification_note: string | null;
          verification_status: Database["public"]["Enums"]["volunteer_status"];
        };
        Insert: {
          active?: boolean;
          availability?: string;
          created_at?: string;
          experience?: string | null;
          full_name: string;
          id?: string;
          latitude?: number | null;
          location_updated_at?: string | null;
          longitude?: number | null;
          phone: string;
          radius_km?: number;
          share_location?: boolean;
          skills?: string[];
          updated_at?: string;
          user_id: string;
          verification_note?: string | null;
          verification_status?: Database["public"]["Enums"]["volunteer_status"];
        };
        Update: {
          active?: boolean;
          availability?: string;
          created_at?: string;
          experience?: string | null;
          full_name?: string;
          id?: string;
          latitude?: number | null;
          location_updated_at?: string | null;
          longitude?: number | null;
          phone?: string;
          radius_km?: number;
          share_location?: boolean;
          skills?: string[];
          updated_at?: string;
          user_id?: string;
          verification_note?: string | null;
          verification_status?: Database["public"]["Enums"]["volunteer_status"];
        };
        Relationships: [];
      };
      volunteer_verifications: {
        Row: {
          created_at: string;
          decided_by: string | null;
          id: string;
          note: string | null;
          status: Database["public"]["Enums"]["volunteer_status"];
          user_id: string;
          volunteer_id: string;
        };
        Insert: {
          created_at?: string;
          decided_by?: string | null;
          id?: string;
          note?: string | null;
          status: Database["public"]["Enums"]["volunteer_status"];
          user_id: string;
          volunteer_id: string;
        };
        Update: {
          created_at?: string;
          decided_by?: string | null;
          id?: string;
          note?: string | null;
          status?: Database["public"]["Enums"]["volunteer_status"];
          user_id?: string;
          volunteer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "volunteer_verifications_volunteer_id_fkey";
            columns: ["volunteer_id"];
            isOneToOne: false;
            referencedRelation: "volunteer_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_guardian_note: {
        Args: { _emergency_id: string; _note: string; _token: string };
        Returns: Json;
      };
      bystander_activate_emergency: {
        Args: {
          _accuracy?: number;
          _code: string;
          _latitude?: number;
          _longitude?: number;
          _note?: string;
        };
        Returns: Json;
      };
      dispatch_resource: {
        Args: {
          _emergency_id: string;
          _eta_minutes?: number;
          _notes?: string;
          _resource_id: string;
        };
        Returns: Json;
      };
      emergency_phase_rank: { Args: { _phase: string }; Returns: number };
      emergency_volunteers: {
        Args: { _emergency_id: string };
        Returns: {
          distance_km: number;
          match_id: string;
          responded_at: string;
          skills: string[];
          status: string;
          volunteer_name: string;
          volunteer_phone: string;
        }[];
      };
      escalate_unacknowledged: {
        Args: { _emergency_id: string };
        Returns: Json;
      };
      get_donor_phone: { Args: { _donor_id: string }; Returns: string };
      get_guardian_relay: {
        Args: { _emergency_id: string; _token: string };
        Returns: Json;
      };
      get_guardian_view: {
        Args: { _emergency_id: string; _token: string };
        Returns: Json;
      };
      get_resqr_summary: { Args: { _code: string }; Returns: Json };
      get_shared_location: { Args: { _token: string }; Returns: Json };
      get_shared_profile: { Args: { _token: string }; Returns: Json };
      get_shared_track: {
        Args: { _token: string };
        Returns: {
          accuracy: number;
          battery_level: number;
          created_at: string;
          latitude: number;
          longitude: number;
          speed: number;
        }[];
      };
      guardian_acknowledge: {
        Args: { _emergency_id: string; _token: string };
        Returns: Json;
      };
      guardian_session_for: {
        Args: { _emergency_id: string; _token: string };
        Returns: {
          acknowledged_at: string | null;
          active: boolean;
          created_at: string;
          emergency_id: string;
          expires_at: string | null;
          guardian_contact_id: string | null;
          guardian_email: string | null;
          guardian_name: string;
          guardian_phone: string | null;
          id: string;
          opened_at: string | null;
          token: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "guardian_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_person_name: { Args: { _name: string }; Returns: boolean };
      log_guardian_access: {
        Args: { _emergency_id: string; _token: string };
        Returns: undefined;
      };
      log_security_event: {
        Args: {
          _detail?: string;
          _event: string;
          _metadata?: Json;
          _user_agent?: string;
        };
        Returns: undefined;
      };
      match_volunteers_for: {
        Args: { _assistance?: string[]; _emergency_id: string };
        Returns: number;
      };
      my_guardian_links: {
        Args: never;
        Returns: {
          emergency_id: string;
          emergency_status: string;
          started_at: string;
          token: string;
          victim_name: string;
        }[];
      };
      normalise_email: { Args: { _email: string }; Returns: string };
      normalise_mobile: { Args: { _phone: string }; Returns: string };
      normalise_phone: { Args: { _phone: string }; Returns: string };
      record_hospital_handoff: {
        Args: {
          _bed?: string;
          _department?: string;
          _emergency_id: string;
          _eta?: string;
          _hospital: string;
          _notes?: string;
        };
        Returns: Json;
      };
      replace_emergency_contacts: {
        Args: { p_contacts: Json; p_user_id: string };
        Returns: number;
      };
      request_volunteer_assistance: {
        Args: {
          _assistance?: string[];
          _emergency_id: string;
          _exclusive?: boolean;
          _radius_km?: number;
        };
        Returns: Json;
      };
      search_blood_donors: {
        Args: { _city?: string; _group?: string };
        Returns: {
          available: boolean;
          blood_group: string;
          city: string;
          full_name: string;
          id: string;
        }[];
      };
      set_guardian_task: {
        Args: {
          _done: boolean;
          _emergency_id: string;
          _label: string;
          _task_key: string;
          _token: string;
        };
        Returns: Json;
      };
      sms_ingest: {
        Args: {
          _body: string;
          _from: string;
          _message_id: string;
          _payload_hash: string;
          _provider: string;
        };
        Returns: Json;
      };
      sms_record_delivery: {
        Args: { _error?: string; _event_id: string; _status: string };
        Returns: undefined;
      };
      start_emergency_session: {
        Args: { _notes: string; _severity: string; _type: string };
        Returns: Json;
      };
      transition_emergency: {
        Args: { _emergency_id: string; _note?: string; _to_phase: string };
        Returns: Json;
      };
      update_assignment_status: {
        Args: { _assignment_id: string; _eta_minutes?: number; _status: string };
        Returns: Json;
      };
      volunteer_accepted_incidents: {
        Args: never;
        Returns: {
          address: string;
          assistance_required: string[];
          emergency_id: string;
          emergency_status: string;
          emergency_type: string;
          latitude: number;
          location_source: string;
          longitude: number;
          match_id: string;
          notes: string;
          phase: string;
          reference: string;
          responded_at: string;
          severity: string;
          status: string;
          victim_name: string;
        }[];
      };
      volunteer_complete: {
        Args: { _match_id: string; _note?: string };
        Returns: Json;
      };
      volunteer_requests: {
        Args: never;
        Returns: {
          approx_area: string;
          assistance_required: string[];
          distance_km: number;
          emergency_type: string;
          exclusive: boolean;
          match_id: string;
          offered_at: string;
          status: string;
        }[];
      };
      volunteer_respond: {
        Args: { _accept: boolean; _match_id: string };
        Returns: Json;
      };
    };
    Enums: {
      app_role: "admin" | "user" | "guardian" | "responder";
      approval_status: "pending" | "approved" | "rejected";
      volunteer_status: "pending" | "verified" | "suspended" | "expired" | "rejected";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "guardian", "responder"],
      approval_status: ["pending", "approved", "rejected"],
      volunteer_status: ["pending", "verified", "suspended", "expired", "rejected"],
    },
  },
} as const;
