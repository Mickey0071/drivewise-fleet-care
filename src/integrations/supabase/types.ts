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
      auto_extension_offers: {
        Row: {
          auto_pay_enabled: boolean
          cancelled_at: string | null
          consumed_at: string | null
          created_at: string
          expires_at: string
          extension_choice: string | null
          extension_token: string | null
          id: string
          offer_type: string
          opened_at: string | null
          rental_id: string
          resent_count: number
          sent_at: string
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          auto_pay_enabled?: boolean
          cancelled_at?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          extension_choice?: string | null
          extension_token?: string | null
          id?: string
          offer_type?: string
          opened_at?: string | null
          rental_id: string
          resent_count?: number
          sent_at?: string
          status?: string
          token: string
          updated_at?: string
        }
        Update: {
          auto_pay_enabled?: boolean
          cancelled_at?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          extension_choice?: string | null
          extension_token?: string | null
          id?: string
          offer_type?: string
          opened_at?: string | null
          rental_id?: string
          resent_count?: number
          sent_at?: string
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      drivers: {
        Row: {
          address: string | null
          alt_contact_name: string | null
          alt_contact_phone: string | null
          apt_unit: string | null
          auto_pay_cadence: string | null
          auto_pay_enabled: boolean
          auto_pay_started_date: string | null
          block_reason: string | null
          blocked: boolean
          blocked_at: string | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_saved_at: string | null
          city: string | null
          created_at: string
          date_added: string
          date_of_birth: string | null
          dl_state: string | null
          email: string
          first_name: string | null
          full_name: string
          id: string
          insurance_on_file: boolean
          last_name: string | null
          license_expiry: string
          license_number: string
          middle_initial: string | null
          next_auto_charge_date: string | null
          phone: string
          rideshare: string
          state: string | null
          status: string
          street_address: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          alt_contact_name?: string | null
          alt_contact_phone?: string | null
          apt_unit?: string | null
          auto_pay_cadence?: string | null
          auto_pay_enabled?: boolean
          auto_pay_started_date?: string | null
          block_reason?: string | null
          blocked?: boolean
          blocked_at?: string | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_saved_at?: string | null
          city?: string | null
          created_at?: string
          date_added?: string
          date_of_birth?: string | null
          dl_state?: string | null
          email: string
          first_name?: string | null
          full_name: string
          id: string
          insurance_on_file?: boolean
          last_name?: string | null
          license_expiry: string
          license_number: string
          middle_initial?: string | null
          next_auto_charge_date?: string | null
          phone: string
          rideshare?: string
          state?: string | null
          status?: string
          street_address?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          alt_contact_name?: string | null
          alt_contact_phone?: string | null
          apt_unit?: string | null
          auto_pay_cadence?: string | null
          auto_pay_enabled?: boolean
          auto_pay_started_date?: string | null
          block_reason?: string | null
          blocked?: boolean
          blocked_at?: string | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_saved_at?: string | null
          city?: string | null
          created_at?: string
          date_added?: string
          date_of_birth?: string | null
          dl_state?: string | null
          email?: string
          first_name?: string | null
          full_name?: string
          id?: string
          insurance_on_file?: boolean
          last_name?: string | null
          license_expiry?: string
          license_number?: string
          middle_initial?: string | null
          next_auto_charge_date?: string | null
          phone?: string
          rideshare?: string
          state?: string | null
          status?: string
          street_address?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string | null
          date: string
          id: string
          notes: string | null
          receipt_url: string | null
          updated_at: string
          vehicle_id: string | null
          vendor: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          notes?: string | null
          receipt_url?: string | null
          updated_at?: string
          vehicle_id?: string | null
          vendor?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          notes?: string | null
          receipt_url?: string | null
          updated_at?: string
          vehicle_id?: string | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      extension_requests: {
        Row: {
          additional_amount: number
          agreement_version: string | null
          cardholder_name: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          name_match_score: number | null
          name_match_status: string | null
          new_end_date: string
          paid_at: string | null
          payment_id: string | null
          payment_link_url: string | null
          period_label: string
          periods: number
          previous_end_date: string | null
          rental_extension_id: string | null
          rental_id: string
          signature_data_url: string | null
          signed_at: string | null
          signed_by: string | null
          status: string
          stripe_payment_link_id: string | null
          stripe_session_id: string | null
          token: string
          updated_at: string
        }
        Insert: {
          additional_amount?: number
          agreement_version?: string | null
          cardholder_name?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          name_match_score?: number | null
          name_match_status?: string | null
          new_end_date: string
          paid_at?: string | null
          payment_id?: string | null
          payment_link_url?: string | null
          period_label?: string
          periods: number
          previous_end_date?: string | null
          rental_extension_id?: string | null
          rental_id: string
          signature_data_url?: string | null
          signed_at?: string | null
          signed_by?: string | null
          status?: string
          stripe_payment_link_id?: string | null
          stripe_session_id?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          additional_amount?: number
          agreement_version?: string | null
          cardholder_name?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          name_match_score?: number | null
          name_match_status?: string | null
          new_end_date?: string
          paid_at?: string | null
          payment_id?: string | null
          payment_link_url?: string | null
          period_label?: string
          periods?: number
          previous_end_date?: string | null
          rental_extension_id?: string | null
          rental_id?: string
          signature_data_url?: string | null
          signed_at?: string | null
          signed_by?: string | null
          status?: string
          stripe_payment_link_id?: string | null
          stripe_session_id?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      ezpass_batch_items: {
        Row: {
          affidavit_pdf_url: string | null
          amount: number
          batch_id: string
          candidates: Json | null
          created_at: string
          driver_id: string | null
          driver_name: string | null
          id: string
          location: string | null
          match_status: string
          plate: string | null
          rental_id: string | null
          updated_at: string
          vehicle_id: string | null
          violation_date: string | null
          violation_id: string | null
          violation_time: string | null
        }
        Insert: {
          affidavit_pdf_url?: string | null
          amount?: number
          batch_id: string
          candidates?: Json | null
          created_at?: string
          driver_id?: string | null
          driver_name?: string | null
          id?: string
          location?: string | null
          match_status?: string
          plate?: string | null
          rental_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
          violation_date?: string | null
          violation_id?: string | null
          violation_time?: string | null
        }
        Update: {
          affidavit_pdf_url?: string | null
          amount?: number
          batch_id?: string
          candidates?: Json | null
          created_at?: string
          driver_id?: string | null
          driver_name?: string | null
          id?: string
          location?: string | null
          match_status?: string
          plate?: string | null
          rental_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
          violation_date?: string | null
          violation_id?: string | null
          violation_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ezpass_batch_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ezpass_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      ezpass_batches: {
        Row: {
          created_at: string
          created_by: string | null
          file_url: string | null
          id: string
          matched_count: number
          source_filename: string | null
          status: string
          total_amount: number
          total_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          file_url?: string | null
          id: string
          matched_count?: number
          source_filename?: string | null
          status?: string
          total_amount?: number
          total_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          file_url?: string | null
          id?: string
          matched_count?: number
          source_filename?: string | null
          status?: string
          total_amount?: number
          total_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      inspections: {
        Row: {
          checklist_data: Json | null
          checklist_items: Json | null
          completed_by: string
          created_at: string
          damage_noted: boolean
          date: string
          fuel_level: string
          id: string
          inspector_name: string | null
          is_return_inspection: boolean
          issues_found: Json | null
          job_type: string | null
          mileage: number
          notes: string | null
          ready_to_rent: boolean | null
          rental_id: string | null
          runner_id: string | null
          submitted_at: string | null
          task_id: string | null
          type: string
          vehicle_id: string
        }
        Insert: {
          checklist_data?: Json | null
          checklist_items?: Json | null
          completed_by: string
          created_at?: string
          damage_noted?: boolean
          date: string
          fuel_level: string
          id: string
          inspector_name?: string | null
          is_return_inspection?: boolean
          issues_found?: Json | null
          job_type?: string | null
          mileage?: number
          notes?: string | null
          ready_to_rent?: boolean | null
          rental_id?: string | null
          runner_id?: string | null
          submitted_at?: string | null
          task_id?: string | null
          type: string
          vehicle_id: string
        }
        Update: {
          checklist_data?: Json | null
          checklist_items?: Json | null
          completed_by?: string
          created_at?: string
          damage_noted?: boolean
          date?: string
          fuel_level?: string
          id?: string
          inspector_name?: string | null
          is_return_inspection?: boolean
          issues_found?: Json | null
          job_type?: string | null
          mileage?: number
          notes?: string | null
          ready_to_rent?: boolean | null
          rental_id?: string | null
          runner_id?: string | null
          submitted_at?: string | null
          task_id?: string | null
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
      insurance_claim_checklist: {
        Row: {
          amount: number | null
          created_at: string
          document_name: string | null
          document_url: string | null
          done: boolean
          entry_id: string
          id: string
          label: string
          notes: string | null
          requires_amount: boolean
          requires_document: boolean
          sort_order: number
        }
        Insert: {
          amount?: number | null
          created_at?: string
          document_name?: string | null
          document_url?: string | null
          done?: boolean
          entry_id: string
          id?: string
          label: string
          notes?: string | null
          requires_amount?: boolean
          requires_document?: boolean
          sort_order?: number
        }
        Update: {
          amount?: number | null
          created_at?: string
          document_name?: string | null
          document_url?: string | null
          done?: boolean
          entry_id?: string
          id?: string
          label?: string
          notes?: string | null
          requires_amount?: boolean
          requires_document?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "insurance_claim_checklist_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "insurance_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_entries: {
        Row: {
          amount: number
          claim_number: string | null
          claim_type: string | null
          company: string | null
          created_at: string
          created_by: string | null
          date: string
          description: string
          id: string
          notes: string | null
          policy_number: string | null
          renter_name: string | null
          renter_phone: string | null
          status: string
          type: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          amount?: number
          claim_number?: string | null
          claim_type?: string | null
          company?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string
          id?: string
          notes?: string | null
          policy_number?: string | null
          renter_name?: string | null
          renter_phone?: string | null
          status?: string
          type: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          amount?: number
          claim_number?: string | null
          claim_type?: string | null
          company?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string
          id?: string
          notes?: string | null
          policy_number?: string | null
          renter_name?: string | null
          renter_phone?: string | null
          status?: string
          type?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: []
      }
      maintenance: {
        Row: {
          amount_paid: number
          approval_date: string | null
          approval_status: string | null
          approved_by: string | null
          balance: number
          completed_by: string | null
          completion_date: string | null
          cost: number
          created_at: string
          created_from_issue: boolean
          customer_notes: string | null
          date_completed: string | null
          deposit_amount: number | null
          deposit_date: string | null
          deposit_processed: boolean | null
          deposit_required: number | null
          diagnosis_notes: string | null
          down_payment: number
          id: string
          inspection_id: string | null
          is_rental_blocking: boolean
          issue_description: string | null
          labor_cost: number
          mechanic_name: string | null
          mechanic_notes: string | null
          mechanic_phone: string | null
          mechanic_shop: string | null
          mileage_at_service: number
          next_service_due: string
          notes: string | null
          parts_cost: number
          parts_list: Json | null
          repair_request_notes: string | null
          runner_id: string | null
          selected_solution: Json | null
          service_type: string
          solutions: Json | null
          source: string
          source_inspection_id: string | null
          status: string | null
          updated_at: string
          vehicle_id: string
          vendor: string
        }
        Insert: {
          amount_paid?: number
          approval_date?: string | null
          approval_status?: string | null
          approved_by?: string | null
          balance?: number
          completed_by?: string | null
          completion_date?: string | null
          cost?: number
          created_at?: string
          created_from_issue?: boolean
          customer_notes?: string | null
          date_completed?: string | null
          deposit_amount?: number | null
          deposit_date?: string | null
          deposit_processed?: boolean | null
          deposit_required?: number | null
          diagnosis_notes?: string | null
          down_payment?: number
          id: string
          inspection_id?: string | null
          is_rental_blocking?: boolean
          issue_description?: string | null
          labor_cost?: number
          mechanic_name?: string | null
          mechanic_notes?: string | null
          mechanic_phone?: string | null
          mechanic_shop?: string | null
          mileage_at_service?: number
          next_service_due?: string
          notes?: string | null
          parts_cost?: number
          parts_list?: Json | null
          repair_request_notes?: string | null
          runner_id?: string | null
          selected_solution?: Json | null
          service_type: string
          solutions?: Json | null
          source?: string
          source_inspection_id?: string | null
          status?: string | null
          updated_at?: string
          vehicle_id: string
          vendor: string
        }
        Update: {
          amount_paid?: number
          approval_date?: string | null
          approval_status?: string | null
          approved_by?: string | null
          balance?: number
          completed_by?: string | null
          completion_date?: string | null
          cost?: number
          created_at?: string
          created_from_issue?: boolean
          customer_notes?: string | null
          date_completed?: string | null
          deposit_amount?: number | null
          deposit_date?: string | null
          deposit_processed?: boolean | null
          deposit_required?: number | null
          diagnosis_notes?: string | null
          down_payment?: number
          id?: string
          inspection_id?: string | null
          is_rental_blocking?: boolean
          issue_description?: string | null
          labor_cost?: number
          mechanic_name?: string | null
          mechanic_notes?: string | null
          mechanic_phone?: string | null
          mechanic_shop?: string | null
          mileage_at_service?: number
          next_service_due?: string
          notes?: string | null
          parts_cost?: number
          parts_list?: Json | null
          repair_request_notes?: string | null
          runner_id?: string | null
          selected_solution?: Json | null
          service_type?: string
          solutions?: Json | null
          source?: string
          source_inspection_id?: string | null
          status?: string | null
          updated_at?: string
          vehicle_id?: string
          vendor?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_source_inspection_id_fkey"
            columns: ["source_inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      mechanic_jobs: {
        Row: {
          additional_context: string | null
          checklist_items: Json
          checklist_results: Json | null
          created_at: string
          created_by_admin: string | null
          estimated_hours: number | null
          id: string
          issue_description: string | null
          labour_cost: number
          maintenance_id: string
          mechanic_name: string
          mechanic_notes: string | null
          mechanic_phone: string
          mechanic_shop: string | null
          parts_list: Json | null
          sent_at: string
          status: string
          submitted_at: string | null
          token: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          additional_context?: string | null
          checklist_items?: Json
          checklist_results?: Json | null
          created_at?: string
          created_by_admin?: string | null
          estimated_hours?: number | null
          id?: string
          issue_description?: string | null
          labour_cost?: number
          maintenance_id: string
          mechanic_name: string
          mechanic_notes?: string | null
          mechanic_phone: string
          mechanic_shop?: string | null
          parts_list?: Json | null
          sent_at?: string
          status?: string
          submitted_at?: string | null
          token: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          additional_context?: string | null
          checklist_items?: Json
          checklist_results?: Json | null
          created_at?: string
          created_by_admin?: string | null
          estimated_hours?: number | null
          id?: string
          issue_description?: string | null
          labour_cost?: number
          maintenance_id?: string
          mechanic_name?: string
          mechanic_notes?: string | null
          mechanic_phone?: string
          mechanic_shop?: string | null
          parts_list?: Json | null
          sent_at?: string
          status?: string
          submitted_at?: string | null
          token?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: []
      }
      notification_settings: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          link_template: string | null
          message_template: string | null
          notification_type: string
          recipient_number: string | null
          recipient_type: string
          send_time: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          link_template?: string | null
          message_template?: string | null
          notification_type: string
          recipient_number?: string | null
          recipient_type?: string
          send_time?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          link_template?: string | null
          message_template?: string | null
          notification_type?: string
          recipient_number?: string | null
          recipient_type?: string
          send_time?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payment_link_logs: {
        Row: {
          amount_cents: number
          channels: string[]
          created_at: string
          custom_message: string | null
          id: string
          link_url: string | null
          reason: string | null
          rental_id: string
        }
        Insert: {
          amount_cents: number
          channels?: string[]
          created_at?: string
          custom_message?: string | null
          id?: string
          link_url?: string | null
          reason?: string | null
          rental_id: string
        }
        Update: {
          amount_cents?: number
          channels?: string[]
          created_at?: string
          custom_message?: string | null
          id?: string
          link_url?: string | null
          reason?: string | null
          rental_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          driver_id: string
          due_date: string
          id: string
          method: string | null
          note: string | null
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
          note?: string | null
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
          note?: string | null
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
      payroll_lines: {
        Row: {
          created_at: string
          gross: number
          hours: number
          id: string
          net: number
          run_id: string
          sort_order: number
          staff_id: string
          status: string
          vehicles: number
        }
        Insert: {
          created_at?: string
          gross?: number
          hours?: number
          id?: string
          net?: number
          run_id: string
          sort_order?: number
          staff_id: string
          status?: string
          vehicles?: number
        }
        Update: {
          created_at?: string
          gross?: number
          hours?: number
          id?: string
          net?: number
          run_id?: string
          sort_order?: number
          staff_id?: string
          status?: string
          vehicles?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_lines_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          created_at: string
          id: string
          period_end: string
          period_start: string
          run_date: string
          status: string
          total_payout: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          period_end: string
          period_start: string
          run_date?: string
          status?: string
          total_payout?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
          run_date?: string
          status?: string
          total_payout?: number
          updated_at?: string
        }
        Relationships: []
      }
      pending_inspections: {
        Row: {
          created_at: string
          rental_id: string
          runner_phone: string | null
          token: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          rental_id: string
          runner_phone?: string | null
          token: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          rental_id?: string
          runner_phone?: string | null
          token?: string
          vehicle_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          driver_ref: string | null
          email: string | null
          first_name: string | null
          full_name: string | null
          id: string
          last_name: string | null
          must_reset_password: boolean
          phone: string | null
          real_email: string | null
          staff_ref: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          created_at?: string
          driver_ref?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id: string
          last_name?: string | null
          must_reset_password?: boolean
          phone?: string | null
          real_email?: string | null
          staff_ref?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          driver_ref?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_name?: string | null
          must_reset_password?: boolean
          phone?: string | null
          real_email?: string | null
          staff_ref?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      refund_requests: {
        Row: {
          amount: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          denial_reason: string | null
          error: string | null
          id: string
          payment_id: string | null
          reason: string | null
          rental_id: string
          requested_by: string | null
          requester_name: string | null
          requester_role: string
          status: string
          stripe_charge_id: string | null
          stripe_payment_intent_id: string | null
          stripe_refund_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          denial_reason?: string | null
          error?: string | null
          id?: string
          payment_id?: string | null
          reason?: string | null
          rental_id: string
          requested_by?: string | null
          requester_name?: string | null
          requester_role: string
          status?: string
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          denial_reason?: string | null
          error?: string | null
          id?: string
          payment_id?: string | null
          reason?: string | null
          rental_id?: string
          requested_by?: string | null
          requester_name?: string | null
          requester_role?: string
          status?: string
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
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
      rental_charges: {
        Row: {
          amount: number
          charge_date: string
          created_at: string
          environment: string
          error_msg: string | null
          id: string
          period_label: string | null
          rental_id: string
          status: string
          stripe_payment_intent_id: string | null
        }
        Insert: {
          amount?: number
          charge_date?: string
          created_at?: string
          environment?: string
          error_msg?: string | null
          id?: string
          period_label?: string | null
          rental_id: string
          status: string
          stripe_payment_intent_id?: string | null
        }
        Update: {
          amount?: number
          charge_date?: string
          created_at?: string
          environment?: string
          error_msg?: string | null
          id?: string
          period_label?: string | null
          rental_id?: string
          status?: string
          stripe_payment_intent_id?: string | null
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
      rental_share_links: {
        Row: {
          billing_period: string
          consumed_at: string | null
          consumed_rental_id: string | null
          created_at: string
          created_by: string | null
          daily_rate: number
          expires_at: string
          notes: string | null
          rate: number
          start_date: string
          token: string
          vehicle_id: string
          weekly_rate: number
        }
        Insert: {
          billing_period?: string
          consumed_at?: string | null
          consumed_rental_id?: string | null
          created_at?: string
          created_by?: string | null
          daily_rate?: number
          expires_at?: string
          notes?: string | null
          rate?: number
          start_date: string
          token: string
          vehicle_id: string
          weekly_rate?: number
        }
        Update: {
          billing_period?: string
          consumed_at?: string | null
          consumed_rental_id?: string | null
          created_at?: string
          created_by?: string | null
          daily_rate?: number
          expires_at?: string
          notes?: string | null
          rate?: number
          start_date?: string
          token?: string
          vehicle_id?: string
          weekly_rate?: number
        }
        Relationships: []
      }
      rentals: {
        Row: {
          activated_at: string | null
          agreement_pdf_generated_at: string | null
          agreement_pdf_url: string | null
          agreement_version: string | null
          auto_renew: boolean
          billing_cadence: string | null
          billing_period: string | null
          card_owner_id_url: string | null
          card_owner_name: string | null
          card_owner_selfie_url: string | null
          cardholder_name: string | null
          client_signature_url: string | null
          client_signed_at: string | null
          created_at: string
          current_period_end: string | null
          deposit_paid: number
          driver_id: string
          end_date: string | null
          extension_link_sent: boolean
          extension_link_sent_date: string | null
          final_charge_amount: number | null
          final_charge_breakdown: Json | null
          id: string
          license_image_url: string | null
          mileage_in: number | null
          mileage_out: number | null
          name_match_score: number | null
          name_match_status: string | null
          notes: string | null
          payer_id_image_url: string | null
          payer_name_extracted: string | null
          payer_phone: string | null
          payment_link_auto_sent_at: string | null
          payment_received: boolean
          payment_status: string
          pending_created_at: string | null
          portal_link_sends: Json
          rate: number | null
          rate_amount: number | null
          receipt_pdf_generated_at: string | null
          receipt_pdf_url: string | null
          reservation_status: string | null
          return_inspection_id: string | null
          returned_at: string | null
          selfie_image_url: string | null
          sign_token: string | null
          signature_data_url: string | null
          signed_at: string | null
          signed_by: string | null
          skip_daily_minimum: boolean
          staff_review_status: string | null
          start_date: string
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          third_party_payer: boolean
          updated_at: string
          vehicle_id: string
          verification_status: string | null
          verification_timestamp: string | null
          weekly_rate: number
        }
        Insert: {
          activated_at?: string | null
          agreement_pdf_generated_at?: string | null
          agreement_pdf_url?: string | null
          agreement_version?: string | null
          auto_renew?: boolean
          billing_cadence?: string | null
          billing_period?: string | null
          card_owner_id_url?: string | null
          card_owner_name?: string | null
          card_owner_selfie_url?: string | null
          cardholder_name?: string | null
          client_signature_url?: string | null
          client_signed_at?: string | null
          created_at?: string
          current_period_end?: string | null
          deposit_paid?: number
          driver_id: string
          end_date?: string | null
          extension_link_sent?: boolean
          extension_link_sent_date?: string | null
          final_charge_amount?: number | null
          final_charge_breakdown?: Json | null
          id: string
          license_image_url?: string | null
          mileage_in?: number | null
          mileage_out?: number | null
          name_match_score?: number | null
          name_match_status?: string | null
          notes?: string | null
          payer_id_image_url?: string | null
          payer_name_extracted?: string | null
          payer_phone?: string | null
          payment_link_auto_sent_at?: string | null
          payment_received?: boolean
          payment_status?: string
          pending_created_at?: string | null
          portal_link_sends?: Json
          rate?: number | null
          rate_amount?: number | null
          receipt_pdf_generated_at?: string | null
          receipt_pdf_url?: string | null
          reservation_status?: string | null
          return_inspection_id?: string | null
          returned_at?: string | null
          selfie_image_url?: string | null
          sign_token?: string | null
          signature_data_url?: string | null
          signed_at?: string | null
          signed_by?: string | null
          skip_daily_minimum?: boolean
          staff_review_status?: string | null
          start_date: string
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          third_party_payer?: boolean
          updated_at?: string
          vehicle_id: string
          verification_status?: string | null
          verification_timestamp?: string | null
          weekly_rate?: number
        }
        Update: {
          activated_at?: string | null
          agreement_pdf_generated_at?: string | null
          agreement_pdf_url?: string | null
          agreement_version?: string | null
          auto_renew?: boolean
          billing_cadence?: string | null
          billing_period?: string | null
          card_owner_id_url?: string | null
          card_owner_name?: string | null
          card_owner_selfie_url?: string | null
          cardholder_name?: string | null
          client_signature_url?: string | null
          client_signed_at?: string | null
          created_at?: string
          current_period_end?: string | null
          deposit_paid?: number
          driver_id?: string
          end_date?: string | null
          extension_link_sent?: boolean
          extension_link_sent_date?: string | null
          final_charge_amount?: number | null
          final_charge_breakdown?: Json | null
          id?: string
          license_image_url?: string | null
          mileage_in?: number | null
          mileage_out?: number | null
          name_match_score?: number | null
          name_match_status?: string | null
          notes?: string | null
          payer_id_image_url?: string | null
          payer_name_extracted?: string | null
          payer_phone?: string | null
          payment_link_auto_sent_at?: string | null
          payment_received?: boolean
          payment_status?: string
          pending_created_at?: string | null
          portal_link_sends?: Json
          rate?: number | null
          rate_amount?: number | null
          receipt_pdf_generated_at?: string | null
          receipt_pdf_url?: string | null
          reservation_status?: string | null
          return_inspection_id?: string | null
          returned_at?: string | null
          selfie_image_url?: string | null
          sign_token?: string | null
          signature_data_url?: string | null
          signed_at?: string | null
          signed_by?: string | null
          skip_daily_minimum?: boolean
          staff_review_status?: string | null
          start_date?: string
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          third_party_payer?: boolean
          updated_at?: string
          vehicle_id?: string
          verification_status?: string | null
          verification_timestamp?: string | null
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
      repair_history: {
        Row: {
          completed_by: string | null
          created_at: string
          id: string
          issue: string | null
          labor_cost: number
          maintenance_id: string | null
          mechanic_name: string | null
          mechanic_phone: string | null
          mechanic_shop: string | null
          notes: string | null
          parts: string | null
          parts_cost: number
          parts_list: Json | null
          repair_date: string
          total_cost: number
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          completed_by?: string | null
          created_at?: string
          id?: string
          issue?: string | null
          labor_cost?: number
          maintenance_id?: string | null
          mechanic_name?: string | null
          mechanic_phone?: string | null
          mechanic_shop?: string | null
          notes?: string | null
          parts?: string | null
          parts_cost?: number
          parts_list?: Json | null
          repair_date: string
          total_cost?: number
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          completed_by?: string | null
          created_at?: string
          id?: string
          issue?: string | null
          labor_cost?: number
          maintenance_id?: string | null
          mechanic_name?: string | null
          mechanic_phone?: string | null
          mechanic_shop?: string | null
          notes?: string | null
          parts?: string | null
          parts_cost?: number
          parts_list?: Json | null
          repair_date?: string
          total_cost?: number
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: []
      }
      repair_scorecard: {
        Row: {
          cost: number
          created_at: string
          days_in_repair: number
          id: string
          issue_category: string | null
          maintenance_id: string | null
          repair_date: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          cost?: number
          created_at?: string
          days_in_repair?: number
          id?: string
          issue_category?: string | null
          maintenance_id?: string | null
          repair_date: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          cost?: number
          created_at?: string
          days_in_repair?: number
          id?: string
          issue_category?: string | null
          maintenance_id?: string | null
          repair_date?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: []
      }
      repair_types: {
        Row: {
          created_at: string
          description: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      rm_cards: {
        Row: {
          created_at: string
          created_by_admin: string | null
          id: string
          inspector_name: string | null
          inspector_phone: string | null
          inspector_type: string
          items_checked: Json
          mileage_at_inspection: number | null
          overall_notes: string | null
          status: string
          submitted_at: string | null
          token: string | null
          token_expires_at: string | null
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          created_by_admin?: string | null
          id?: string
          inspector_name?: string | null
          inspector_phone?: string | null
          inspector_type?: string
          items_checked?: Json
          mileage_at_inspection?: number | null
          overall_notes?: string | null
          status?: string
          submitted_at?: string | null
          token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          created_by_admin?: string | null
          id?: string
          inspector_name?: string | null
          inspector_phone?: string | null
          inspector_type?: string
          items_checked?: Json
          mileage_at_inspection?: number | null
          overall_notes?: string | null
          status?: string
          submitted_at?: string | null
          token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: []
      }
      runner_tasks: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          checklist: Json
          checklist_results: Json | null
          completed_at: string | null
          completion: Json | null
          created_at: string
          customer_id: string | null
          details: Json
          due_date: string | null
          forced: boolean
          id: string
          instructions: string | null
          location: string | null
          mileage: number | null
          notes: string | null
          photo_urls: string[]
          photos_count_required: number
          priority: string
          requires_photos: boolean
          review_action: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          runner_id: string | null
          runner_name: string | null
          runner_notes: string | null
          runner_phone: string | null
          scheduled_at: string | null
          sent_at: string | null
          status: string
          submitted_at: string | null
          title: string | null
          token: string | null
          token_expires_at: string | null
          type: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          checklist?: Json
          checklist_results?: Json | null
          completed_at?: string | null
          completion?: Json | null
          created_at?: string
          customer_id?: string | null
          details?: Json
          due_date?: string | null
          forced?: boolean
          id?: string
          instructions?: string | null
          location?: string | null
          mileage?: number | null
          notes?: string | null
          photo_urls?: string[]
          photos_count_required?: number
          priority?: string
          requires_photos?: boolean
          review_action?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          runner_id?: string | null
          runner_name?: string | null
          runner_notes?: string | null
          runner_phone?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          submitted_at?: string | null
          title?: string | null
          token?: string | null
          token_expires_at?: string | null
          type?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          checklist?: Json
          checklist_results?: Json | null
          completed_at?: string | null
          completion?: Json | null
          created_at?: string
          customer_id?: string | null
          details?: Json
          due_date?: string | null
          forced?: boolean
          id?: string
          instructions?: string | null
          location?: string | null
          mileage?: number | null
          notes?: string | null
          photo_urls?: string[]
          photos_count_required?: number
          priority?: string
          requires_photos?: boolean
          review_action?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          runner_id?: string | null
          runner_name?: string | null
          runner_notes?: string | null
          runner_phone?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          submitted_at?: string | null
          title?: string | null
          token?: string | null
          token_expires_at?: string | null
          type?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: []
      }
      service_types: {
        Row: {
          created_at: string
          description: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      share_link_sms_log: {
        Row: {
          attempted_by: string | null
          created_at: string
          error_message: string | null
          id: string
          phone: string
          recipient_name: string | null
          status: string
          token: string
          vehicle_id: string | null
        }
        Insert: {
          attempted_by?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          phone: string
          recipient_name?: string | null
          status: string
          token: string
          vehicle_id?: string | null
        }
        Update: {
          attempted_by?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          phone?: string
          recipient_name?: string | null
          status?: string
          token?: string
          vehicle_id?: string | null
        }
        Relationships: []
      }
      staff: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          pay_rate: number
          pay_type: string
          phone: string
          role: string
          status: string
          stripe_connected: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string
          full_name: string
          id: string
          pay_rate?: number
          pay_type?: string
          phone?: string
          role?: string
          status?: string
          stripe_connected?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          pay_rate?: number
          pay_type?: string
          phone?: string
          role?: string
          status?: string
          stripe_connected?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      staff_setup_tokens: {
        Row: {
          consumed_at: string | null
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          first_name: string | null
          last_name: string | null
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          token: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          first_name?: string | null
          last_name?: string | null
          phone?: string | null
          role: Database["public"]["Enums"]["app_role"]
          token: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          first_name?: string | null
          last_name?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
        }
        Relationships: []
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
      vehicle_photos: {
        Row: {
          caption: string | null
          created_at: string
          created_by: string | null
          id: string
          sort_order: number
          url: string
          vehicle_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          sort_order?: number
          url: string
          vehicle_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          sort_order?: number
          url?: string
          vehicle_id?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          color: string | null
          created_at: string
          current_location: string | null
          daily_rate: number
          ez_pass_tag: string | null
          fuel_level_pickup: string | null
          fuel_type: string | null
          has_open_issues: boolean
          id: string
          image_url: string | null
          inspection_sticker_expiry: string | null
          insurance_expiry: string | null
          last_dmv_service_at: string | null
          last_inspection_at: string | null
          last_inspection_mileage: number | null
          last_rm_date: string | null
          last_rm_mileage: number | null
          last_transport_at: string | null
          maintenance_settings: Json
          make: string
          mileage: number
          model: string
          next_service_due: string | null
          notes: string | null
          plate: string
          registration_expiry: string | null
          repo_date: string | null
          repo_location: string | null
          risk_tier: string
          rm_history: Json
          seats: number | null
          shop_dropoff_at: string | null
          shop_est_return: string | null
          shop_vendor: string | null
          status: string
          transmission: string | null
          updated_at: string
          vin: string
          weekly_rate: number
          year: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          current_location?: string | null
          daily_rate?: number
          ez_pass_tag?: string | null
          fuel_level_pickup?: string | null
          fuel_type?: string | null
          has_open_issues?: boolean
          id: string
          image_url?: string | null
          inspection_sticker_expiry?: string | null
          insurance_expiry?: string | null
          last_dmv_service_at?: string | null
          last_inspection_at?: string | null
          last_inspection_mileage?: number | null
          last_rm_date?: string | null
          last_rm_mileage?: number | null
          last_transport_at?: string | null
          maintenance_settings?: Json
          make: string
          mileage?: number
          model: string
          next_service_due?: string | null
          notes?: string | null
          plate: string
          registration_expiry?: string | null
          repo_date?: string | null
          repo_location?: string | null
          risk_tier?: string
          rm_history?: Json
          seats?: number | null
          shop_dropoff_at?: string | null
          shop_est_return?: string | null
          shop_vendor?: string | null
          status?: string
          transmission?: string | null
          updated_at?: string
          vin: string
          weekly_rate?: number
          year: number
        }
        Update: {
          color?: string | null
          created_at?: string
          current_location?: string | null
          daily_rate?: number
          ez_pass_tag?: string | null
          fuel_level_pickup?: string | null
          fuel_type?: string | null
          has_open_issues?: boolean
          id?: string
          image_url?: string | null
          inspection_sticker_expiry?: string | null
          insurance_expiry?: string | null
          last_dmv_service_at?: string | null
          last_inspection_at?: string | null
          last_inspection_mileage?: number | null
          last_rm_date?: string | null
          last_rm_mileage?: number | null
          last_transport_at?: string | null
          maintenance_settings?: Json
          make?: string
          mileage?: number
          model?: string
          next_service_due?: string | null
          notes?: string | null
          plate?: string
          registration_expiry?: string | null
          repo_date?: string | null
          repo_location?: string | null
          risk_tier?: string
          rm_history?: Json
          seats?: number | null
          shop_dropoff_at?: string | null
          shop_est_return?: string | null
          shop_vendor?: string | null
          status?: string
          transmission?: string | null
          updated_at?: string
          vin?: string
          weekly_rate?: number
          year?: number
        }
        Relationships: []
      }
      vendors: {
        Row: {
          address: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string
          reference_number: string | null
          service_type: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone: string
          reference_number?: string | null
          service_type?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string
          reference_number?: string | null
          service_type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      violation_status_history: {
        Row: {
          changed_by: string | null
          changed_by_name: string | null
          created_at: string
          from_status: string | null
          id: string
          reason: string | null
          to_status: string
          violation_id: string
        }
        Insert: {
          changed_by?: string | null
          changed_by_name?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          to_status: string
          violation_id: string
        }
        Update: {
          changed_by?: string | null
          changed_by_name?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          to_status?: string
          violation_id?: string
        }
        Relationships: []
      }
      violations: {
        Row: {
          amount: number
          confirmation_number: string | null
          created_at: string
          created_by: string | null
          customer_token: string | null
          customer_token_expires_at: string | null
          date_issued: string
          description: string | null
          driver_id: string | null
          extracted_confidence: number | null
          fee: number
          id: string
          license_plate: string | null
          notes: string | null
          paid_at: string | null
          payment_link_url: string | null
          payment_method: string | null
          photo_url: string | null
          reminder_sent_at: string | null
          rental_id: string | null
          resolution_choice: string | null
          resolution_notes: string | null
          resolution_reason: string | null
          resolved_at: string | null
          sent_to_customer_at: string | null
          signature_url: string | null
          signed_at: string | null
          signed_ip: string | null
          signed_name: string | null
          signed_pdf_url: string | null
          signed_user_agent: string | null
          status: string
          stripe_payment_intent_id: string | null
          stripe_payment_link_id: string | null
          submission_method: string | null
          submission_notes: string | null
          submitted_to: string | null
          submitted_to_authority_at: string | null
          total_amount: number
          type: string
          updated_at: string
          vehicle_id: string
          viewed_at: string | null
        }
        Insert: {
          amount?: number
          confirmation_number?: string | null
          created_at?: string
          created_by?: string | null
          customer_token?: string | null
          customer_token_expires_at?: string | null
          date_issued?: string
          description?: string | null
          driver_id?: string | null
          extracted_confidence?: number | null
          fee?: number
          id: string
          license_plate?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_link_url?: string | null
          payment_method?: string | null
          photo_url?: string | null
          reminder_sent_at?: string | null
          rental_id?: string | null
          resolution_choice?: string | null
          resolution_notes?: string | null
          resolution_reason?: string | null
          resolved_at?: string | null
          sent_to_customer_at?: string | null
          signature_url?: string | null
          signed_at?: string | null
          signed_ip?: string | null
          signed_name?: string | null
          signed_pdf_url?: string | null
          signed_user_agent?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_payment_link_id?: string | null
          submission_method?: string | null
          submission_notes?: string | null
          submitted_to?: string | null
          submitted_to_authority_at?: string | null
          total_amount?: number
          type?: string
          updated_at?: string
          vehicle_id: string
          viewed_at?: string | null
        }
        Update: {
          amount?: number
          confirmation_number?: string | null
          created_at?: string
          created_by?: string | null
          customer_token?: string | null
          customer_token_expires_at?: string | null
          date_issued?: string
          description?: string | null
          driver_id?: string | null
          extracted_confidence?: number | null
          fee?: number
          id?: string
          license_plate?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_link_url?: string | null
          payment_method?: string | null
          photo_url?: string | null
          reminder_sent_at?: string | null
          rental_id?: string | null
          resolution_choice?: string | null
          resolution_notes?: string | null
          resolution_reason?: string | null
          resolved_at?: string | null
          sent_to_customer_at?: string | null
          signature_url?: string | null
          signed_at?: string | null
          signed_ip?: string | null
          signed_name?: string | null
          signed_pdf_url?: string | null
          signed_user_agent?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_payment_link_id?: string | null
          submission_method?: string | null
          submission_notes?: string | null
          submitted_to?: string | null
          submitted_to_authority_at?: string | null
          total_amount?: number
          type?: string
          updated_at?: string
          vehicle_id?: string
          viewed_at?: string | null
        }
        Relationships: []
      }
      work_orders: {
        Row: {
          actual_cost: number | null
          admin_signature: string | null
          admin_signed_at: string | null
          assigned_to: string | null
          completed_date: string | null
          completion_notes: string | null
          created_at: string
          created_by: string | null
          description: string
          estimated_cost: number
          field_submitted_at: string | null
          field_token: string | null
          id: string
          mechanic_signature: string | null
          mechanic_signed_at: string | null
          parts_used: string | null
          priority: string
          reviewed_by: string | null
          scheduled_date: string
          service_type: string
          signed_doc_url: string | null
          status: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          actual_cost?: number | null
          admin_signature?: string | null
          admin_signed_at?: string | null
          assigned_to?: string | null
          completed_date?: string | null
          completion_notes?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          estimated_cost?: number
          field_submitted_at?: string | null
          field_token?: string | null
          id: string
          mechanic_signature?: string | null
          mechanic_signed_at?: string | null
          parts_used?: string | null
          priority?: string
          reviewed_by?: string | null
          scheduled_date?: string
          service_type: string
          signed_doc_url?: string | null
          status?: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          actual_cost?: number | null
          admin_signature?: string | null
          admin_signed_at?: string | null
          assigned_to?: string | null
          completed_date?: string | null
          completion_notes?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          estimated_cost?: number
          field_submitted_at?: string | null
          field_token?: string | null
          id?: string
          mechanic_signature?: string | null
          mechanic_signed_at?: string | null
          parts_used?: string | null
          priority?: string
          reviewed_by?: string | null
          scheduled_date?: string
          service_type?: string
          signed_doc_url?: string | null
          status?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_driver_id: { Args: never; Returns: string }
      get_auto_extension_offer_public: {
        Args: { _token: string }
        Returns: {
          billing_period: string
          consumed_at: string
          current_end_date: string
          driver_full_name: string
          expires_at: string
          extension_token: string
          offer_type: string
          rental_id: string
          rental_rate: number
          rental_weekly_rate: number
          status: string
          token: string
          vehicle_daily_rate: number
          vehicle_make: string
          vehicle_model: string
          vehicle_plate: string
          vehicle_weekly_rate: number
          vehicle_year: number
        }[]
      }
      get_extension_request_public: {
        Args: { _token: string }
        Returns: {
          additional_amount: number
          billing_period: string
          driver_full_name: string
          expires_at: string
          new_end_date: string
          paid_at: string
          period_label: string
          periods: number
          previous_end_date: string
          rate: number
          rental_id: string
          signed_at: string
          status: string
          token: string
          vehicle_make: string
          vehicle_model: string
          vehicle_plate: string
          vehicle_year: number
          weekly_rate: number
        }[]
      }
      get_share_link_public: {
        Args: { _token: string }
        Returns: {
          billing_period: string
          consumed: boolean
          daily_rate: number
          expires_at: string
          notes: string
          rate: number
          start_date: string
          token: string
          vehicle_id: string
          vehicle_image_url: string
          vehicle_make: string
          vehicle_model: string
          vehicle_year: number
          weekly_rate: number
        }[]
      }
      get_violation_public: {
        Args: { _token: string }
        Returns: {
          amount: number
          date_issued: string
          description: string
          driver_full_name: string
          id: string
          license_plate: string
          paid_at: string
          rental_end_date: string
          rental_start_date: string
          resolution_choice: string
          signed_at: string
          status: string
          total_amount: number
          vehicle_make: string
          vehicle_model: string
          vehicle_plate: string
          vehicle_year: number
          viewed_at: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "runner" | "driver" | "va"
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
      app_role: ["admin", "runner", "driver", "va"],
    },
  },
} as const
