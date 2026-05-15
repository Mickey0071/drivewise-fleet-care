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
      drivers: {
        Row: {
          created_at: string
          date_added: string
          email: string
          full_name: string
          id: string
          insurance_on_file: boolean
          license_expiry: string
          license_number: string
          phone: string
          rideshare: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_added?: string
          email: string
          full_name: string
          id: string
          insurance_on_file?: boolean
          license_expiry: string
          license_number: string
          phone: string
          rideshare?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_added?: string
          email?: string
          full_name?: string
          id?: string
          insurance_on_file?: boolean
          license_expiry?: string
          license_number?: string
          phone?: string
          rideshare?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      inspections: {
        Row: {
          completed_by: string
          created_at: string
          damage_noted: boolean
          date: string
          fuel_level: number
          id: string
          mileage: number
          rental_id: string
          type: string
          vehicle_id: string
        }
        Insert: {
          completed_by: string
          created_at?: string
          damage_noted?: boolean
          date: string
          fuel_level?: number
          id: string
          mileage?: number
          rental_id: string
          type: string
          vehicle_id: string
        }
        Update: {
          completed_by?: string
          created_at?: string
          damage_noted?: boolean
          date?: string
          fuel_level?: number
          id?: string
          mileage?: number
          rental_id?: string
          type?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspections_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          driver_id: string
          due_date: string
          id: string
          method: string | null
          paid_date: string | null
          rental_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          driver_id: string
          due_date: string
          id: string
          method?: string | null
          paid_date?: string | null
          rental_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          driver_id?: string
          due_date?: string
          id?: string
          method?: string | null
          paid_date?: string | null
          rental_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          driver_ref: string | null
          full_name: string | null
          id: string
          phone: string | null
          staff_ref: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          driver_ref?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          staff_ref?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          driver_ref?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          staff_ref?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reminder_log: {
        Row: {
          id: string
          message: string | null
          phone: string | null
          reminder_type: string
          rental_id: string
          sent_at: string
          target_date: string
        }
        Insert: {
          id?: string
          message?: string | null
          phone?: string | null
          reminder_type: string
          rental_id: string
          sent_at?: string
          target_date: string
        }
        Update: {
          id?: string
          message?: string | null
          phone?: string | null
          reminder_type?: string
          rental_id?: string
          sent_at?: string
          target_date?: string
        }
        Relationships: []
      }
      rental_extensions: {
        Row: {
          additional_amount: number
          agreement_version: string | null
          created_at: string
          extended_at: string
          id: string
          new_end_date: string
          payment_id: string | null
          period_label: string
          periods: number
          previous_end_date: string | null
          rental_id: string
          signature_data_url: string | null
          signed_by: string | null
        }
        Insert: {
          additional_amount?: number
          agreement_version?: string | null
          created_at?: string
          extended_at?: string
          id: string
          new_end_date: string
          payment_id?: string | null
          period_label: string
          periods: number
          previous_end_date?: string | null
          rental_id: string
          signature_data_url?: string | null
          signed_by?: string | null
        }
        Update: {
          additional_amount?: number
          agreement_version?: string | null
          created_at?: string
          extended_at?: string
          id?: string
          new_end_date?: string
          payment_id?: string | null
          period_label?: string
          periods?: number
          previous_end_date?: string | null
          rental_id?: string
          signature_data_url?: string | null
          signed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rental_extensions_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rentals: {
        Row: {
          agreement_version: string | null
          billing_period: string | null
          client_signature_url: string | null
          client_signed_at: string | null
          created_at: string
          deposit_paid: number
          driver_id: string
          end_date: string | null
          id: string
          license_image_url: string | null
          notes: string | null
          payment_received: boolean
          payment_status: string
          pending_created_at: string | null
          rate: number | null
          reservation_status: string | null
          selfie_image_url: string | null
          sign_token: string | null
          signature_data_url: string | null
          signed_at: string | null
          signed_by: string | null
          start_date: string
          updated_at: string
          vehicle_id: string
          weekly_rate: number
        }
        Insert: {
          agreement_version?: string | null
          billing_period?: string | null
          client_signature_url?: string | null
          client_signed_at?: string | null
          created_at?: string
          deposit_paid?: number
          driver_id: string
          end_date?: string | null
          id: string
          license_image_url?: string | null
          notes?: string | null
          payment_received?: boolean
          payment_status?: string
          pending_created_at?: string | null
          rate?: number | null
          reservation_status?: string | null
          selfie_image_url?: string | null
          sign_token?: string | null
          signature_data_url?: string | null
          signed_at?: string | null
          signed_by?: string | null
          start_date: string
          updated_at?: string
          vehicle_id: string
          weekly_rate?: number
        }
        Update: {
          agreement_version?: string | null
          billing_period?: string | null
          client_signature_url?: string | null
          client_signed_at?: string | null
          created_at?: string
          deposit_paid?: number
          driver_id?: string
          end_date?: string | null
          id?: string
          license_image_url?: string | null
          notes?: string | null
          payment_received?: boolean
          payment_status?: string
          pending_created_at?: string | null
          rate?: number | null
          reservation_status?: string | null
          selfie_image_url?: string | null
          sign_token?: string | null
          signature_data_url?: string | null
          signed_at?: string | null
          signed_by?: string | null
          start_date?: string
          updated_at?: string
          vehicle_id?: string
          weekly_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "rentals_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount_cents: number | null
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          kind: string
          price_id: string | null
          product_id: string | null
          rental_id: string | null
          status: string
          stripe_customer_id: string
          stripe_session_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount_cents?: number | null
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          kind?: string
          price_id?: string | null
          product_id?: string | null
          rental_id?: string | null
          status?: string
          stripe_customer_id: string
          stripe_session_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number | null
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          kind?: string
          price_id?: string | null
          product_id?: string | null
          rental_id?: string | null
          status?: string
          stripe_customer_id?: string
          stripe_session_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          user_id?: string
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
      vehicles: {
        Row: {
          created_at: string
          daily_rate: number
          id: string
          image_url: string | null
          make: string
          mileage: number
          model: string
          next_service_due: string | null
          notes: string | null
          plate: string
          risk_tier: string
          status: string
          updated_at: string
          vin: string
          weekly_rate: number
          year: number
        }
        Insert: {
          created_at?: string
          daily_rate?: number
          id: string
          image_url?: string | null
          make: string
          mileage?: number
          model: string
          next_service_due?: string | null
          notes?: string | null
          plate: string
          risk_tier?: string
          status?: string
          updated_at?: string
          vin: string
          weekly_rate?: number
          year: number
        }
        Update: {
          created_at?: string
          daily_rate?: number
          id?: string
          image_url?: string | null
          make?: string
          mileage?: number
          model?: string
          next_service_due?: string | null
          notes?: string | null
          plate?: string
          risk_tier?: string
          status?: string
          updated_at?: string
          vin?: string
          weekly_rate?: number
          year?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "runner" | "driver"
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
      app_role: ["admin", "runner", "driver"],
    },
  },
} as const
