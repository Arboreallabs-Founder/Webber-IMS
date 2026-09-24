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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      approval_rights: {
        Row: {
          approver_order: number
          created_at: string
          created_by: string | null
          document_type: string
          id: string
          user_id: string
        }
        Insert: {
          approver_order: number
          created_at?: string
          created_by?: string | null
          document_type: string
          id?: string
          user_id: string
        }
        Update: {
          approver_order?: number
          created_at?: string
          created_by?: string | null
          document_type?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_rights_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_rights_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          id: string
          new_data: Json | null
          occurred_at: string
          old_data: Json | null
          row_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          id?: string
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          row_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          id?: string
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          row_id?: string | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_lines: {
        Row: {
          bom_id: string
          component_id: string | null
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          project_line_item_id: string | null
          required_qty: number
          source: Database["public"]["Enums"]["bom_line_source"]
          updated_at: string | null
        }
        Insert: {
          bom_id: string
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          project_line_item_id?: string | null
          required_qty?: number
          source?: Database["public"]["Enums"]["bom_line_source"]
          updated_at?: string | null
        }
        Update: {
          bom_id?: string
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          project_line_item_id?: string | null
          required_qty?: number
          source?: Database["public"]["Enums"]["bom_line_source"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_lines_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "boms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "bom_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "bom_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_project_line_item_id_fkey"
            columns: ["project_line_item_id"]
            isOneToOne: false
            referencedRelation: "project_line_items"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_template_lines: {
        Row: {
          assembly_name: string | null
          bom_template_id: string
          component_id: string | null
          created_at: string
          created_by: string | null
          id: string
          is_common: boolean
          is_variant_driven: boolean
          line_type: string | null
          note: string | null
          parent_line_id: string | null
          quantity: number
          section: string | null
          sort_order: number
          updated_at: string | null
          variant_group: string | null
          variant_rule: Json | null
          variation: string | null
        }
        Insert: {
          assembly_name?: string | null
          bom_template_id: string
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_common?: boolean
          is_variant_driven?: boolean
          line_type?: string | null
          note?: string | null
          parent_line_id?: string | null
          quantity?: number
          section?: string | null
          sort_order?: number
          updated_at?: string | null
          variant_group?: string | null
          variant_rule?: Json | null
          variation?: string | null
        }
        Update: {
          assembly_name?: string | null
          bom_template_id?: string
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_common?: boolean
          is_variant_driven?: boolean
          line_type?: string | null
          note?: string | null
          parent_line_id?: string | null
          quantity?: number
          section?: string | null
          sort_order?: number
          updated_at?: string | null
          variant_group?: string | null
          variant_rule?: Json | null
          variation?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_template_lines_bom_template_id_fkey"
            columns: ["bom_template_id"]
            isOneToOne: false
            referencedRelation: "bom_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_template_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_template_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "bom_template_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "bom_template_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_template_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_template_lines_parent_line_id_fkey"
            columns: ["parent_line_id"]
            isOneToOne: false
            referencedRelation: "bom_template_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_templates: {
        Row: {
          component_id: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          product_id: string | null
          updated_at: string | null
          version: number
        }
        Insert: {
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          product_id?: string | null
          updated_at?: string | null
          version?: number
        }
        Update: {
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          product_id?: string | null
          updated_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bom_templates_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_templates_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "bom_templates_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "bom_templates_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_templates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      boms: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          id: string
          project_id: string
          status: Database["public"]["Enums"]["bom_status"]
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          project_id: string
          status?: Database["public"]["Enums"]["bom_status"]
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          project_id?: string
          status?: Database["public"]["Enums"]["bom_status"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boms_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boms_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boms_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "boms_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          parent_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      component_inspection_field_exclusions: {
        Row: {
          component_id: string
          created_at: string
          created_by: string | null
          field_id: string
        }
        Insert: {
          component_id: string
          created_at?: string
          created_by?: string | null
          field_id: string
        }
        Update: {
          component_id?: string
          created_at?: string
          created_by?: string | null
          field_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "component_inspection_field_exclusions_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_inspection_field_exclusions_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "component_inspection_field_exclusions_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "component_inspection_field_exclusions_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_inspection_field_exclusions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "component_inspection_field_exclusions_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "inspection_template_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      components: {
        Row: {
          by_weight: boolean
          component_no: string
          created_at: string
          created_by: string | null
          cut_from_plate: boolean
          description: string | null
          grade: string | null
          id: string
          id_mm: number | null
          inspection_template_id: string | null
          is_assembly: boolean
          is_job_work: boolean
          is_serialized: boolean
          jw_rate: number | null
          jw_vendor_id: string | null
          length_mm: number | null
          mpn: string | null
          name: string
          nominal_size: string | null
          od_mm: number | null
          original_description: string | null
          parent_assembly_id: string | null
          quantity_type: Database["public"]["Enums"]["quantity_type"]
          raw_supplier_id: string | null
          reorder_level: number | null
          spec: string | null
          standard_cost: number | null
          thk_mm: number | null
          tracking_mode: Database["public"]["Enums"]["tracking_mode"]
          type: string | null
          uom: string | null
          updated_at: string | null
          weight_uom: string | null
          width_mm: number | null
        }
        Insert: {
          by_weight?: boolean
          component_no: string
          created_at?: string
          created_by?: string | null
          cut_from_plate?: boolean
          description?: string | null
          grade?: string | null
          id?: string
          id_mm?: number | null
          inspection_template_id?: string | null
          is_assembly?: boolean
          is_job_work?: boolean
          is_serialized?: boolean
          jw_rate?: number | null
          jw_vendor_id?: string | null
          length_mm?: number | null
          mpn?: string | null
          name: string
          nominal_size?: string | null
          od_mm?: number | null
          original_description?: string | null
          parent_assembly_id?: string | null
          quantity_type?: Database["public"]["Enums"]["quantity_type"]
          raw_supplier_id?: string | null
          reorder_level?: number | null
          spec?: string | null
          standard_cost?: number | null
          thk_mm?: number | null
          tracking_mode?: Database["public"]["Enums"]["tracking_mode"]
          type?: string | null
          uom?: string | null
          updated_at?: string | null
          weight_uom?: string | null
          width_mm?: number | null
        }
        Update: {
          by_weight?: boolean
          component_no?: string
          created_at?: string
          created_by?: string | null
          cut_from_plate?: boolean
          description?: string | null
          grade?: string | null
          id?: string
          id_mm?: number | null
          inspection_template_id?: string | null
          is_assembly?: boolean
          is_job_work?: boolean
          is_serialized?: boolean
          jw_rate?: number | null
          jw_vendor_id?: string | null
          length_mm?: number | null
          mpn?: string | null
          name?: string
          nominal_size?: string | null
          od_mm?: number | null
          original_description?: string | null
          parent_assembly_id?: string | null
          quantity_type?: Database["public"]["Enums"]["quantity_type"]
          raw_supplier_id?: string | null
          reorder_level?: number | null
          spec?: string | null
          standard_cost?: number | null
          thk_mm?: number | null
          tracking_mode?: Database["public"]["Enums"]["tracking_mode"]
          type?: string | null
          uom?: string | null
          updated_at?: string | null
          weight_uom?: string | null
          width_mm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "components_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_inspection_template_id_fkey"
            columns: ["inspection_template_id"]
            isOneToOne: false
            referencedRelation: "inspection_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_jw_vendor_id_fkey"
            columns: ["jw_vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "components_jw_vendor_id_fkey"
            columns: ["jw_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_parent_assembly_id_fkey"
            columns: ["parent_assembly_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_parent_assembly_id_fkey"
            columns: ["parent_assembly_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "components_parent_assembly_id_fkey"
            columns: ["parent_assembly_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "components_parent_assembly_id_fkey"
            columns: ["parent_assembly_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_raw_supplier_id_fkey"
            columns: ["raw_supplier_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "components_raw_supplier_id_fkey"
            columns: ["raw_supplier_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          contact: string | null
          created_at: string
          created_by: string | null
          delivery_address: string | null
          email: string | null
          gst_no: string | null
          id: string
          name: string
          phone_country_code: string | null
          phone_number: string | null
          registered_address: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          contact?: string | null
          created_at?: string
          created_by?: string | null
          delivery_address?: string | null
          email?: string | null
          gst_no?: string | null
          id?: string
          name: string
          phone_country_code?: string | null
          phone_number?: string | null
          registered_address?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          contact?: string | null
          created_at?: string
          created_by?: string | null
          delivery_address?: string | null
          email?: string | null
          gst_no?: string | null
          id?: string
          name?: string
          phone_country_code?: string | null
          phone_number?: string | null
          registered_address?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_signatures: {
        Row: {
          document_id: string
          document_type: string
          id: string
          signature_image_data_url: string
          signed_at: string
          slot: number
          user_id: string
        }
        Insert: {
          document_id: string
          document_type: string
          id?: string
          signature_image_data_url: string
          signed_at?: string
          slot: number
          user_id: string
        }
        Update: {
          document_id?: string
          document_type?: string
          id?: string
          signature_image_data_url?: string
          signed_at?: string
          slot?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_signatures_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finished_goods: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          product_id: string | null
          project_line_item_id: string | null
          serial_no: string
          status: Database["public"]["Enums"]["fg_status"]
          updated_at: string | null
          variant_selections: Json | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string | null
          project_line_item_id?: string | null
          serial_no: string
          status?: Database["public"]["Enums"]["fg_status"]
          updated_at?: string | null
          variant_selections?: Json | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string | null
          project_line_item_id?: string | null
          serial_no?: string
          status?: Database["public"]["Enums"]["fg_status"]
          updated_at?: string | null
          variant_selections?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "finished_goods_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finished_goods_project_line_item_id_fkey"
            columns: ["project_line_item_id"]
            isOneToOne: false
            referencedRelation: "project_line_items"
            referencedColumns: ["id"]
          },
        ]
      }
      grn_lines: {
        Row: {
          component_id: string | null
          created_at: string
          created_by: string | null
          grn_id: string
          id: string
          is_untagged: boolean
          jw_line_id: string | null
          po_line_id: string | null
          project_id: string | null
          qty_received: number
          target_lot_id: string | null
          unit_cost: number | null
          updated_at: string | null
        }
        Insert: {
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          grn_id: string
          id?: string
          is_untagged?: boolean
          jw_line_id?: string | null
          po_line_id?: string | null
          project_id?: string | null
          qty_received?: number
          target_lot_id?: string | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          grn_id?: string
          id?: string
          is_untagged?: boolean
          jw_line_id?: string | null
          po_line_id?: string | null
          project_id?: string | null
          qty_received?: number
          target_lot_id?: string | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grn_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "grn_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "grn_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "grns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_jw_line_id_fkey"
            columns: ["jw_line_id"]
            isOneToOne: false
            referencedRelation: "job_work_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "po_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "v_po_lines_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "v_po_overdue"
            referencedColumns: ["po_line_id"]
          },
          {
            foreignKeyName: "grn_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "grn_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_target_lot_id_fkey"
            columns: ["target_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_target_lot_id_fkey"
            columns: ["target_lot_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_lots_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_target_lot_id_fkey"
            columns: ["target_lot_id"]
            isOneToOne: false
            referencedRelation: "v_stale_stock"
            referencedColumns: ["lot_id"]
          },
        ]
      }
      grns: {
        Row: {
          challan_no: string | null
          created_at: string
          created_by: string | null
          grn_no: string
          id: string
          invoice_no: string | null
          is_job_work: boolean
          po_id: string | null
          received_at: string
          received_by: string | null
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          challan_no?: string | null
          created_at?: string
          created_by?: string | null
          grn_no: string
          id?: string
          invoice_no?: string | null
          is_job_work?: boolean
          po_id?: string | null
          received_at?: string
          received_by?: string | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          challan_no?: string | null
          created_at?: string
          created_by?: string | null
          grn_no?: string
          id?: string
          invoice_no?: string | null
          is_job_work?: boolean
          po_id?: string | null
          received_at?: string
          received_by?: string | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grns_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grns_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_orders_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grns_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grns_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "grns_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_template_fields: {
        Row: {
          created_at: string
          created_by: string | null
          field_type: Database["public"]["Enums"]["irn_field_type"]
          id: string
          is_active: boolean
          is_required: boolean
          label: string
          options: Json | null
          show_on_printout: boolean
          sort_order: number
          template_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          field_type: Database["public"]["Enums"]["irn_field_type"]
          id?: string
          is_active?: boolean
          is_required?: boolean
          label: string
          options?: Json | null
          show_on_printout?: boolean
          sort_order?: number
          template_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          field_type?: Database["public"]["Enums"]["irn_field_type"]
          id?: string
          is_active?: boolean
          is_required?: boolean
          label?: string
          options?: Json | null
          show_on_printout?: boolean
          sort_order?: number
          template_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_template_fields_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_template_fields_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "inspection_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_lots: {
        Row: {
          component_id: string | null
          container_no: string | null
          created_at: string
          created_by: string | null
          grn_line_id: string | null
          id: string
          is_serialized: boolean
          jw_stage: Database["public"]["Enums"]["jw_stage"] | null
          location: string | null
          lot_code: string
          parent_lot_id: string | null
          piece_weight: number | null
          project_id: string | null
          qty_initial: number
          qty_on_hand: number
          status: Database["public"]["Enums"]["lot_status"]
          unit_cost: number | null
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          component_id?: string | null
          container_no?: string | null
          created_at?: string
          created_by?: string | null
          grn_line_id?: string | null
          id?: string
          is_serialized?: boolean
          jw_stage?: Database["public"]["Enums"]["jw_stage"] | null
          location?: string | null
          lot_code: string
          parent_lot_id?: string | null
          piece_weight?: number | null
          project_id?: string | null
          qty_initial?: number
          qty_on_hand?: number
          status?: Database["public"]["Enums"]["lot_status"]
          unit_cost?: number | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          component_id?: string | null
          container_no?: string | null
          created_at?: string
          created_by?: string | null
          grn_line_id?: string | null
          id?: string
          is_serialized?: boolean
          jw_stage?: Database["public"]["Enums"]["jw_stage"] | null
          location?: string | null
          lot_code?: string
          parent_lot_id?: string | null
          piece_weight?: number | null
          project_id?: string | null
          qty_initial?: number
          qty_on_hand?: number
          status?: Database["public"]["Enums"]["lot_status"]
          unit_cost?: number | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lots_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "inventory_lots_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "inventory_lots_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "grn_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "v_grn_lines_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "v_untagged_receipts"
            referencedColumns: ["grn_line_id"]
          },
          {
            foreignKeyName: "inventory_lots_parent_lot_id_fkey"
            columns: ["parent_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_parent_lot_id_fkey"
            columns: ["parent_lot_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_lots_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_parent_lot_id_fkey"
            columns: ["parent_lot_id"]
            isOneToOne: false
            referencedRelation: "v_stale_stock"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "inventory_lots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "inventory_lots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "inventory_lots_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      irn_answers: {
        Row: {
          choice_value: string | null
          created_at: string
          created_by: string | null
          field_id: string
          id: string
          irn_id: string
          number_value: number | null
          text_value: string | null
          updated_at: string | null
        }
        Insert: {
          choice_value?: string | null
          created_at?: string
          created_by?: string | null
          field_id: string
          id?: string
          irn_id: string
          number_value?: number | null
          text_value?: string | null
          updated_at?: string | null
        }
        Update: {
          choice_value?: string | null
          created_at?: string
          created_by?: string | null
          field_id?: string
          id?: string
          irn_id?: string
          number_value?: number | null
          text_value?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "irn_answers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irn_answers_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "inspection_template_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irn_answers_irn_id_fkey"
            columns: ["irn_id"]
            isOneToOne: false
            referencedRelation: "irns"
            referencedColumns: ["id"]
          },
        ]
      }
      irns: {
        Row: {
          approval_remarks: string | null
          approved_at: string | null
          approved_by: string | null
          component_id: string
          created_at: string
          created_by: string | null
          generated_at: string
          generated_by: string
          grn_id: string
          grn_line_id: string | null
          id: string
          irn_no: string
          jw_line_id: string | null
          piece_count: number | null
          piece_length: number | null
          piece_weight: number | null
          piece_width: number | null
          po_line_id: string | null
          project_id: string | null
          qty: number
          rejection_reason: string | null
          status: Database["public"]["Enums"]["irn_status"]
          supersedes_irn_id: string | null
          target_lot_id: string | null
          template_id: string
          unit_cost: number | null
          updated_at: string | null
        }
        Insert: {
          approval_remarks?: string | null
          approved_at?: string | null
          approved_by?: string | null
          component_id: string
          created_at?: string
          created_by?: string | null
          generated_at?: string
          generated_by: string
          grn_id: string
          grn_line_id?: string | null
          id?: string
          irn_no: string
          jw_line_id?: string | null
          piece_count?: number | null
          piece_length?: number | null
          piece_weight?: number | null
          piece_width?: number | null
          po_line_id?: string | null
          project_id?: string | null
          qty: number
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["irn_status"]
          supersedes_irn_id?: string | null
          target_lot_id?: string | null
          template_id: string
          unit_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          approval_remarks?: string | null
          approved_at?: string | null
          approved_by?: string | null
          component_id?: string
          created_at?: string
          created_by?: string | null
          generated_at?: string
          generated_by?: string
          grn_id?: string
          grn_line_id?: string | null
          id?: string
          irn_no?: string
          jw_line_id?: string | null
          piece_count?: number | null
          piece_length?: number | null
          piece_weight?: number | null
          piece_width?: number | null
          po_line_id?: string | null
          project_id?: string | null
          qty?: number
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["irn_status"]
          supersedes_irn_id?: string | null
          target_lot_id?: string | null
          template_id?: string
          unit_cost?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "irns_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "irns_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "irns_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "grns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "grn_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "v_grn_lines_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "v_untagged_receipts"
            referencedColumns: ["grn_line_id"]
          },
          {
            foreignKeyName: "irns_jw_line_id_fkey"
            columns: ["jw_line_id"]
            isOneToOne: false
            referencedRelation: "job_work_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "po_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "v_po_lines_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "v_po_overdue"
            referencedColumns: ["po_line_id"]
          },
          {
            foreignKeyName: "irns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "irns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_supersedes_irn_id_fkey"
            columns: ["supersedes_irn_id"]
            isOneToOne: false
            referencedRelation: "irns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_target_lot_id_fkey"
            columns: ["target_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_target_lot_id_fkey"
            columns: ["target_lot_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_lots_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "irns_target_lot_id_fkey"
            columns: ["target_lot_id"]
            isOneToOne: false
            referencedRelation: "v_stale_stock"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "irns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "inspection_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      job_work_lines: {
        Row: {
          completed_lot_id: string | null
          component_id: string | null
          created_at: string
          created_by: string | null
          id: string
          jw_order_id: string
          jw_rate: number | null
          qty_returned: number
          qty_sent: number
          raw_lot_id: string | null
          updated_at: string | null
        }
        Insert: {
          completed_lot_id?: string | null
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          jw_order_id: string
          jw_rate?: number | null
          qty_returned?: number
          qty_sent?: number
          raw_lot_id?: string | null
          updated_at?: string | null
        }
        Update: {
          completed_lot_id?: string | null
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          jw_order_id?: string
          jw_rate?: number | null
          qty_returned?: number
          qty_sent?: number
          raw_lot_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_work_lines_completed_lot_id_fkey"
            columns: ["completed_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_work_lines_completed_lot_id_fkey"
            columns: ["completed_lot_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_lots_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_work_lines_completed_lot_id_fkey"
            columns: ["completed_lot_id"]
            isOneToOne: false
            referencedRelation: "v_stale_stock"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "job_work_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_work_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "job_work_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "job_work_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_work_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_work_lines_jw_order_id_fkey"
            columns: ["jw_order_id"]
            isOneToOne: false
            referencedRelation: "job_work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_work_lines_raw_lot_id_fkey"
            columns: ["raw_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_work_lines_raw_lot_id_fkey"
            columns: ["raw_lot_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_lots_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_work_lines_raw_lot_id_fkey"
            columns: ["raw_lot_id"]
            isOneToOne: false
            referencedRelation: "v_stale_stock"
            referencedColumns: ["lot_id"]
          },
        ]
      }
      job_work_orders: {
        Row: {
          created_at: string
          created_by: string | null
          expected_date: string | null
          id: string
          jw_no: string
          project_id: string | null
          revision_no: number
          root_jw_id: string | null
          sent_date: string | null
          status: string
          superseded_by: string | null
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expected_date?: string | null
          id?: string
          jw_no: string
          project_id?: string | null
          revision_no?: number
          root_jw_id?: string | null
          sent_date?: string | null
          status?: string
          superseded_by?: string | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expected_date?: string | null
          id?: string
          jw_no?: string
          project_id?: string | null
          revision_no?: number
          root_jw_id?: string | null
          sent_date?: string | null
          status?: string
          superseded_by?: string | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_work_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_work_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_work_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "job_work_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_work_orders_root_jw_id_fkey"
            columns: ["root_jw_id"]
            isOneToOne: false
            referencedRelation: "job_work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_work_orders_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "job_work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_work_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "job_work_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_reads: {
        Row: {
          notification_id: string
          profile_id: string
          read_at: string
        }
        Insert: {
          notification_id: string
          profile_id: string
          read_at?: string
        }
        Update: {
          notification_id?: string
          profile_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_reads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          link_path: string | null
          message: string
          project_id: string | null
          recipient_id: string | null
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          link_path?: string | null
          message: string
          project_id?: string | null
          recipient_id?: string | null
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          link_path?: string | null
          message?: string
          project_id?: string | null
          recipient_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      po_lines: {
        Row: {
          amount: number | null
          approval_signature_data_url: string | null
          approval_status: Database["public"]["Enums"]["po_line_approval_status"]
          approved_at: string | null
          approved_by: string | null
          component_id: string | null
          created_at: string
          created_by: string | null
          expected_date: string | null
          id: string
          line_status: Database["public"]["Enums"]["po_line_status"]
          po_id: string
          project_id: string | null
          qty_ordered: number
          qty_received: number
          rate: number | null
          rejection_reason: string | null
          requisition_line_id: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          approval_signature_data_url?: string | null
          approval_status?: Database["public"]["Enums"]["po_line_approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          expected_date?: string | null
          id?: string
          line_status?: Database["public"]["Enums"]["po_line_status"]
          po_id: string
          project_id?: string | null
          qty_ordered?: number
          qty_received?: number
          rate?: number | null
          rejection_reason?: string | null
          requisition_line_id?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          approval_signature_data_url?: string | null
          approval_status?: Database["public"]["Enums"]["po_line_approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          expected_date?: string | null
          id?: string
          line_status?: Database["public"]["Enums"]["po_line_status"]
          po_id?: string
          project_id?: string | null
          qty_ordered?: number
          qty_received?: number
          rate?: number | null
          rejection_reason?: string | null
          requisition_line_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "po_lines_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_orders_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "po_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_requisition_line_id_fkey"
            columns: ["requisition_line_id"]
            isOneToOne: false
            referencedRelation: "requisition_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variant_params: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          input_type: Database["public"]["Enums"]["input_type"]
          max_value: number | null
          min_value: number | null
          name: string
          options: Json | null
          product_id: string
          sort_order: number
          uom: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          input_type?: Database["public"]["Enums"]["input_type"]
          max_value?: number | null
          min_value?: number | null
          name: string
          options?: Json | null
          product_id: string
          sort_order?: number
          uom?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          input_type?: Database["public"]["Enums"]["input_type"]
          max_value?: number | null
          min_value?: number | null
          name?: string
          options?: Json | null
          product_id?: string
          sort_order?: number
          uom?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variant_params_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variant_params_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          base_image: string | null
          category_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_serialized: boolean
          model_name: string
          sku_code: string
          updated_at: string | null
        }
        Insert: {
          base_image?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_serialized?: boolean
          model_name: string
          sku_code: string
          updated_at?: string | null
        }
        Update: {
          base_image?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_serialized?: boolean
          model_name?: string
          sku_code?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          created_by: string | null
          full_name: string | null
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["role"]
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["role"]
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["role"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_activities: {
        Row: {
          activity: string
          actual_date: string | null
          corrective_action: string | null
          created_at: string
          created_by: string | null
          delay_reason: string | null
          id: string
          material_available: boolean | null
          planned_date: string | null
          po_released: boolean | null
          project_id: string
          responsibility: string | null
          sort_order: number
          status: string | null
          updated_at: string | null
          variance_days: number | null
        }
        Insert: {
          activity: string
          actual_date?: string | null
          corrective_action?: string | null
          created_at?: string
          created_by?: string | null
          delay_reason?: string | null
          id?: string
          material_available?: boolean | null
          planned_date?: string | null
          po_released?: boolean | null
          project_id: string
          responsibility?: string | null
          sort_order?: number
          status?: string | null
          updated_at?: string | null
          variance_days?: number | null
        }
        Update: {
          activity?: string
          actual_date?: string | null
          corrective_action?: string | null
          created_at?: string
          created_by?: string | null
          delay_reason?: string | null
          id?: string
          material_available?: boolean | null
          planned_date?: string | null
          po_released?: boolean | null
          project_id?: string
          responsibility?: string | null
          sort_order?: number
          status?: string | null
          updated_at?: string | null
          variance_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      project_documents: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          doc_type: Database["public"]["Enums"]["doc_type"]
          file_path: string | null
          id: string
          project_id: string
          status: Database["public"]["Enums"]["doc_status"]
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          doc_type?: Database["public"]["Enums"]["doc_type"]
          file_path?: string | null
          id?: string
          project_id: string
          status?: Database["public"]["Enums"]["doc_status"]
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          doc_type?: Database["public"]["Enums"]["doc_type"]
          file_path?: string | null
          id?: string
          project_id?: string
          status?: Database["public"]["Enums"]["doc_status"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_documents_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      project_line_items: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          product_id: string | null
          project_id: string
          quantity: number
          updated_at: string | null
          variant_selections: Json | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string | null
          project_id: string
          quantity?: number
          updated_at?: string | null
          variant_selections?: Json | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string | null
          project_id?: string
          quantity?: number
          updated_at?: string | null
          variant_selections?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "project_line_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_line_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_line_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_line_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_line_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_po_number: string | null
          customer_po_value: number | null
          delivery_date: string | null
          dispatch_date: string | null
          id: string
          order_date: string | null
          project_no: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_po_number?: string | null
          customer_po_value?: number | null
          delivery_date?: string | null
          dispatch_date?: string | null
          id?: string
          order_date?: string | null
          project_no: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_po_number?: string | null
          customer_po_value?: number | null
          delivery_date?: string | null
          dispatch_date?: string | null
          id?: string
          order_date?: string | null
          project_no?: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          created_by: string | null
          delivery_address: string | null
          delivery_terms: string
          freight_terms: string
          gst_percent: number
          id: string
          is_informal: boolean
          payment_terms: string
          po_date: string | null
          po_no: string
          revision_no: number
          root_po_id: string | null
          source: Database["public"]["Enums"]["po_source"]
          status: Database["public"]["Enums"]["po_status"]
          superseded_by: string | null
          total_amount: number | null
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delivery_address?: string | null
          delivery_terms?: string
          freight_terms?: string
          gst_percent?: number
          id?: string
          is_informal?: boolean
          payment_terms?: string
          po_date?: string | null
          po_no: string
          revision_no?: number
          root_po_id?: string | null
          source?: Database["public"]["Enums"]["po_source"]
          status?: Database["public"]["Enums"]["po_status"]
          superseded_by?: string | null
          total_amount?: number | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delivery_address?: string | null
          delivery_terms?: string
          freight_terms?: string
          gst_percent?: number
          id?: string
          is_informal?: boolean
          payment_terms?: string
          po_date?: string | null
          po_no?: string
          revision_no?: number
          root_po_id?: string | null
          source?: Database["public"]["Enums"]["po_source"]
          status?: Database["public"]["Enums"]["po_status"]
          superseded_by?: string | null
          total_amount?: number | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_root_po_id_fkey"
            columns: ["root_po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_root_po_id_fkey"
            columns: ["root_po_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_orders_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "v_purchase_orders_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      requisition_lines: {
        Row: {
          bom_line_id: string | null
          component_id: string | null
          created_at: string
          created_by: string | null
          id: string
          qty: number
          requisition_id: string
          shortfall_qty: number | null
          updated_at: string | null
        }
        Insert: {
          bom_line_id?: string | null
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          qty?: number
          requisition_id: string
          shortfall_qty?: number | null
          updated_at?: string | null
        }
        Update: {
          bom_line_id?: string | null
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          qty?: number
          requisition_id?: string
          shortfall_qty?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "requisition_lines_bom_line_id_fkey"
            columns: ["bom_line_id"]
            isOneToOne: false
            referencedRelation: "bom_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisition_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisition_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "requisition_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "requisition_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisition_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisition_lines_requisition_id_fkey"
            columns: ["requisition_id"]
            isOneToOne: false
            referencedRelation: "requisitions"
            referencedColumns: ["id"]
          },
        ]
      }
      requisitions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          project_id: string | null
          req_no: string
          requested_by: string | null
          status: Database["public"]["Enums"]["req_status"]
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          project_id?: string | null
          req_no: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["req_status"]
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          project_id?: string | null
          req_no?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["req_status"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "requisitions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisitions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisitions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "requisitions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisitions_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      signatures: {
        Row: {
          created_at: string
          id: string
          image_data_url: string
          is_default: boolean
          label: string | null
          method: string
          typed_font: string | null
          typed_text: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_data_url: string
          is_default?: boolean
          label?: string | null
          method: string
          typed_font?: string | null
          typed_text?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_data_url?: string
          is_default?: boolean
          label?: string | null
          method?: string
          typed_font?: string | null
          typed_text?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signatures_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      site_purchases: {
        Row: {
          bom_line_id: string | null
          component_id: string
          created_at: string
          created_by: string | null
          id: string
          lot_id: string | null
          note: string | null
          project_id: string
          purchase_no: string
          purchased_at: string
          qty: number
          unit_cost: number | null
          vendor_id: string | null
          vendor_name: string | null
        }
        Insert: {
          bom_line_id?: string | null
          component_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          lot_id?: string | null
          note?: string | null
          project_id: string
          purchase_no: string
          purchased_at?: string
          qty: number
          unit_cost?: number | null
          vendor_id?: string | null
          vendor_name?: string | null
        }
        Update: {
          bom_line_id?: string | null
          component_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lot_id?: string | null
          note?: string | null
          project_id?: string
          purchase_no?: string
          purchased_at?: string
          qty?: number
          unit_cost?: number | null
          vendor_id?: string | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_purchases_bom_line_id_fkey"
            columns: ["bom_line_id"]
            isOneToOne: false
            referencedRelation: "bom_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_purchases_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_purchases_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "site_purchases_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "site_purchases_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_purchases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_purchases_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_purchases_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_lots_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_purchases_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "v_stale_stock"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "site_purchases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_purchases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "site_purchases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_purchases_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "site_purchases_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          component_id: string | null
          created_at: string
          created_by: string | null
          id: string
          lot_id: string | null
          movement_type: Database["public"]["Enums"]["movement_type"]
          note: string | null
          performed_at: string
          performed_by: string | null
          project_id: string | null
          qty: number
          reference_id: string | null
          reference_type: string | null
          updated_at: string | null
        }
        Insert: {
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lot_id?: string | null
          movement_type: Database["public"]["Enums"]["movement_type"]
          note?: string | null
          performed_at?: string
          performed_by?: string | null
          project_id?: string | null
          qty: number
          reference_id?: string | null
          reference_type?: string | null
          updated_at?: string | null
        }
        Update: {
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lot_id?: string | null
          movement_type?: Database["public"]["Enums"]["movement_type"]
          note?: string | null
          performed_at?: string
          performed_by?: string | null
          project_id?: string | null
          qty?: number
          reference_id?: string | null
          reference_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "stock_movements_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "stock_movements_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_lots_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "v_stale_stock"
            referencedColumns: ["lot_id"]
          },
          {
            foreignKeyName: "stock_movements_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "stock_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_components: {
        Row: {
          component_id: string
          created_at: string
          created_by: string | null
          id: string
          lead_time_days: number | null
          price: number | null
          updated_at: string | null
          vendor_id: string
          vendor_part_code: string | null
        }
        Insert: {
          component_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_time_days?: number | null
          price?: number | null
          updated_at?: string | null
          vendor_id: string
          vendor_part_code?: string | null
        }
        Update: {
          component_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_time_days?: number | null
          price?: number | null
          updated_at?: string | null
          vendor_id?: string
          vendor_part_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_components_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_components_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "vendor_components_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "vendor_components_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_components_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_components_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_components_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: string | null
          avg_lead_time_days: number | null
          contact: string | null
          created_at: string
          created_by: string | null
          email: string | null
          gst_no: string | null
          id: string
          is_active: boolean
          name: string
          pan: string | null
          rating: number | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          avg_lead_time_days?: number | null
          contact?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          gst_no?: string | null
          id?: string
          is_active?: boolean
          name: string
          pan?: string | null
          rating?: number | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          avg_lead_time_days?: number | null
          contact?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          gst_no?: string | null
          id?: string
          is_active?: boolean
          name?: string
          pan?: string | null
          rating?: number | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendors_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_activity_log: {
        Row: {
          action: string | null
          actor_id: string | null
          category: string | null
          detail: Json | null
          link_path: string | null
          occurred_at: string | null
          row_id: string | null
          source_table: string | null
          subject_label: string | null
        }
        Relationships: []
      }
      v_bom_variance: {
        Row: {
          component_id: string | null
          consumed_qty: number | null
          on_hand_qty: number | null
          order_gap: number | null
          ordered_qty: number | null
          project_id: string | null
          receive_gap: number | null
          received_qty: number | null
          required_qty: number | null
          uncovered_qty: number | null
        }
        Relationships: []
      }
      v_component_on_hand: {
        Row: {
          component_id: string | null
          component_no: string | null
          has_stock_history: boolean | null
          lot_count: number | null
          name: string | null
          qty_on_hand: number | null
          stock_value: number | null
          uom: string | null
        }
        Relationships: []
      }
      v_component_on_hand_safe: {
        Row: {
          component_id: string | null
          component_no: string | null
          has_stock_history: boolean | null
          lot_count: number | null
          name: string | null
          qty_on_hand: number | null
          uom: string | null
        }
        Relationships: []
      }
      v_components_safe: {
        Row: {
          by_weight: boolean | null
          component_no: string | null
          created_at: string | null
          created_by: string | null
          cut_from_plate: boolean | null
          description: string | null
          grade: string | null
          id: string | null
          id_mm: number | null
          inspection_template_id: string | null
          is_assembly: boolean | null
          is_job_work: boolean | null
          is_serialized: boolean | null
          jw_vendor_id: string | null
          length_mm: number | null
          mpn: string | null
          name: string | null
          nominal_size: string | null
          od_mm: number | null
          original_description: string | null
          parent_assembly_id: string | null
          quantity_type: Database["public"]["Enums"]["quantity_type"] | null
          raw_supplier_id: string | null
          reorder_level: number | null
          spec: string | null
          thk_mm: number | null
          tracking_mode: Database["public"]["Enums"]["tracking_mode"] | null
          type: string | null
          uom: string | null
          updated_at: string | null
          weight_uom: string | null
          width_mm: number | null
        }
        Insert: {
          by_weight?: boolean | null
          component_no?: string | null
          created_at?: string | null
          created_by?: string | null
          cut_from_plate?: boolean | null
          description?: string | null
          grade?: string | null
          id?: string | null
          id_mm?: number | null
          inspection_template_id?: string | null
          is_assembly?: boolean | null
          is_job_work?: boolean | null
          is_serialized?: boolean | null
          jw_vendor_id?: string | null
          length_mm?: number | null
          mpn?: string | null
          name?: string | null
          nominal_size?: string | null
          od_mm?: number | null
          original_description?: string | null
          parent_assembly_id?: string | null
          quantity_type?: Database["public"]["Enums"]["quantity_type"] | null
          raw_supplier_id?: string | null
          reorder_level?: number | null
          spec?: string | null
          thk_mm?: number | null
          tracking_mode?: Database["public"]["Enums"]["tracking_mode"] | null
          type?: string | null
          uom?: string | null
          updated_at?: string | null
          weight_uom?: string | null
          width_mm?: number | null
        }
        Update: {
          by_weight?: boolean | null
          component_no?: string | null
          created_at?: string | null
          created_by?: string | null
          cut_from_plate?: boolean | null
          description?: string | null
          grade?: string | null
          id?: string | null
          id_mm?: number | null
          inspection_template_id?: string | null
          is_assembly?: boolean | null
          is_job_work?: boolean | null
          is_serialized?: boolean | null
          jw_vendor_id?: string | null
          length_mm?: number | null
          mpn?: string | null
          name?: string | null
          nominal_size?: string | null
          od_mm?: number | null
          original_description?: string | null
          parent_assembly_id?: string | null
          quantity_type?: Database["public"]["Enums"]["quantity_type"] | null
          raw_supplier_id?: string | null
          reorder_level?: number | null
          spec?: string | null
          thk_mm?: number | null
          tracking_mode?: Database["public"]["Enums"]["tracking_mode"] | null
          type?: string | null
          uom?: string | null
          updated_at?: string | null
          weight_uom?: string | null
          width_mm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "components_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_inspection_template_id_fkey"
            columns: ["inspection_template_id"]
            isOneToOne: false
            referencedRelation: "inspection_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_jw_vendor_id_fkey"
            columns: ["jw_vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "components_jw_vendor_id_fkey"
            columns: ["jw_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_parent_assembly_id_fkey"
            columns: ["parent_assembly_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_parent_assembly_id_fkey"
            columns: ["parent_assembly_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "components_parent_assembly_id_fkey"
            columns: ["parent_assembly_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "components_parent_assembly_id_fkey"
            columns: ["parent_assembly_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_raw_supplier_id_fkey"
            columns: ["raw_supplier_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "components_raw_supplier_id_fkey"
            columns: ["raw_supplier_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      v_grn_lines_safe: {
        Row: {
          component_id: string | null
          created_at: string | null
          created_by: string | null
          grn_id: string | null
          id: string | null
          is_untagged: boolean | null
          po_line_id: string | null
          project_id: string | null
          qty_received: number | null
          updated_at: string | null
        }
        Insert: {
          component_id?: string | null
          created_at?: string | null
          created_by?: string | null
          grn_id?: string | null
          id?: string | null
          is_untagged?: boolean | null
          po_line_id?: string | null
          project_id?: string | null
          qty_received?: number | null
          updated_at?: string | null
        }
        Update: {
          component_id?: string | null
          created_at?: string | null
          created_by?: string | null
          grn_id?: string | null
          id?: string | null
          is_untagged?: boolean | null
          po_line_id?: string | null
          project_id?: string | null
          qty_received?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grn_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "grn_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "grn_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "grns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "po_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "v_po_lines_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "v_po_overdue"
            referencedColumns: ["po_line_id"]
          },
          {
            foreignKeyName: "grn_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "grn_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      v_inventory_lots_safe: {
        Row: {
          component_id: string | null
          created_at: string | null
          created_by: string | null
          grn_line_id: string | null
          id: string | null
          is_serialized: boolean | null
          location: string | null
          lot_code: string | null
          project_id: string | null
          qty_initial: number | null
          qty_on_hand: number | null
          status: Database["public"]["Enums"]["lot_status"] | null
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          component_id?: string | null
          created_at?: string | null
          created_by?: string | null
          grn_line_id?: string | null
          id?: string | null
          is_serialized?: boolean | null
          location?: string | null
          lot_code?: string | null
          project_id?: string | null
          qty_initial?: number | null
          qty_on_hand?: number | null
          status?: Database["public"]["Enums"]["lot_status"] | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          component_id?: string | null
          created_at?: string | null
          created_by?: string | null
          grn_line_id?: string | null
          id?: string | null
          is_serialized?: boolean | null
          location?: string | null
          lot_code?: string | null
          project_id?: string | null
          qty_initial?: number | null
          qty_on_hand?: number | null
          status?: Database["public"]["Enums"]["lot_status"] | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lots_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "inventory_lots_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "inventory_lots_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "grn_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "v_grn_lines_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "v_untagged_receipts"
            referencedColumns: ["grn_line_id"]
          },
          {
            foreignKeyName: "inventory_lots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "inventory_lots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "inventory_lots_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      v_last_component_rate: {
        Row: {
          component_id: string | null
          rate: number | null
        }
        Relationships: [
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      v_missing_po: {
        Row: {
          component_id: string | null
          component_name: string | null
          component_no: string | null
          consumed_qty: number | null
          on_hand_qty: number | null
          order_gap: number | null
          ordered_qty: number | null
          project_id: string | null
          received_qty: number | null
          required_qty: number | null
          uncovered_qty: number | null
        }
        Relationships: []
      }
      v_po_lines_safe: {
        Row: {
          component_id: string | null
          created_at: string | null
          created_by: string | null
          expected_date: string | null
          id: string | null
          line_status: Database["public"]["Enums"]["po_line_status"] | null
          po_id: string | null
          project_id: string | null
          qty_ordered: number | null
          qty_received: number | null
          requisition_line_id: string | null
          updated_at: string | null
        }
        Insert: {
          component_id?: string | null
          created_at?: string | null
          created_by?: string | null
          expected_date?: string | null
          id?: string | null
          line_status?: Database["public"]["Enums"]["po_line_status"] | null
          po_id?: string | null
          project_id?: string | null
          qty_ordered?: number | null
          qty_received?: number | null
          requisition_line_id?: string | null
          updated_at?: string | null
        }
        Update: {
          component_id?: string | null
          created_at?: string | null
          created_by?: string | null
          expected_date?: string | null
          id?: string | null
          line_status?: Database["public"]["Enums"]["po_line_status"] | null
          po_id?: string | null
          project_id?: string | null
          qty_ordered?: number | null
          qty_received?: number | null
          requisition_line_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_orders_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "po_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_requisition_line_id_fkey"
            columns: ["requisition_line_id"]
            isOneToOne: false
            referencedRelation: "requisition_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      v_po_overdue: {
        Row: {
          component_id: string | null
          component_name: string | null
          component_no: string | null
          days_overdue: number | null
          expected_date: string | null
          po_id: string | null
          po_line_id: string | null
          po_no: string | null
          project_id: string | null
          project_no: string | null
          qty_ordered: number | null
          qty_received: number | null
          vendor_id: string | null
          vendor_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "po_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_orders_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "po_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      v_project_consumption: {
        Row: {
          component_id: string | null
          consumed_qty: number | null
          consumption_value: number | null
          project_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "stock_movements_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "stock_movements_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_schedule"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "stock_movements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_projects_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      v_project_schedule: {
        Row: {
          completed_activities: number | null
          delivery_date: string | null
          dispatch_date: string | null
          material_ready: boolean | null
          next_planned_date: string | null
          overdue_activities: number | null
          po_released: boolean | null
          project_id: string | null
          project_no: string | null
          status: Database["public"]["Enums"]["project_status"] | null
          total_activities: number | null
        }
        Relationships: []
      }
      v_project_shortfall: {
        Row: {
          component_id: string | null
          consumed_qty: number | null
          on_hand: number | null
          ordered_qty: number | null
          project_id: string | null
          required_qty: number | null
          sent_to_jw_qty: number | null
          shortfall_qty: number | null
        }
        Relationships: []
      }
      v_projects_safe: {
        Row: {
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          customer_po_number: string | null
          delivery_date: string | null
          dispatch_date: string | null
          id: string | null
          order_date: string | null
          project_no: string | null
          status: Database["public"]["Enums"]["project_status"] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          customer_po_number?: string | null
          delivery_date?: string | null
          dispatch_date?: string | null
          id?: string | null
          order_date?: string | null
          project_no?: string | null
          status?: Database["public"]["Enums"]["project_status"] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          customer_po_number?: string | null
          delivery_date?: string | null
          dispatch_date?: string | null
          id?: string | null
          order_date?: string | null
          project_no?: string | null
          status?: Database["public"]["Enums"]["project_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_purchase_orders_safe: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string | null
          is_informal: boolean | null
          po_date: string | null
          po_no: string | null
          source: Database["public"]["Enums"]["po_source"] | null
          status: Database["public"]["Enums"]["po_status"] | null
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          is_informal?: boolean | null
          po_date?: string | null
          po_no?: string | null
          source?: Database["public"]["Enums"]["po_source"] | null
          status?: Database["public"]["Enums"]["po_status"] | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          is_informal?: boolean | null
          po_date?: string | null
          po_no?: string | null
          source?: Database["public"]["Enums"]["po_source"] | null
          status?: Database["public"]["Enums"]["po_status"] | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      v_stale_stock: {
        Row: {
          age_days: number | null
          component_id: string | null
          component_name: string | null
          component_no: string | null
          created_at: string | null
          lot_code: string | null
          lot_id: string | null
          qty_on_hand: number | null
          unit_cost: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lots_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "inventory_lots_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "inventory_lots_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      v_supplier_kpi: {
        Row: {
          avg_lead_time_days: number | null
          completed_pos: number | null
          name: string | null
          open_pos: number | null
          rating: number | null
          received_lines: number | null
          total_lines: number | null
          total_pos: number | null
          vendor_id: string | null
        }
        Relationships: []
      }
      v_untagged_receipts: {
        Row: {
          challan_no: string | null
          component_id: string | null
          component_name: string | null
          component_no: string | null
          grn_id: string | null
          grn_line_id: string | null
          grn_no: string | null
          qty_received: number | null
          received_at: string | null
          unit_cost: number | null
          vendor_id: string | null
          vendor_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grn_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "grn_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "grn_lines_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "grns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grns_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "grns_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      v_vendor_components_safe: {
        Row: {
          component_id: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          lead_time_days: number | null
          updated_at: string | null
          vendor_id: string | null
          vendor_part_code: string | null
        }
        Insert: {
          component_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          lead_time_days?: number | null
          updated_at?: string | null
          vendor_id?: string | null
          vendor_part_code?: string | null
        }
        Update: {
          component_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          lead_time_days?: number | null
          updated_at?: string | null
          vendor_id?: string | null
          vendor_part_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_components_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_components_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "vendor_components_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_component_on_hand_safe"
            referencedColumns: ["component_id"]
          },
          {
            foreignKeyName: "vendor_components_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "v_components_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_components_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_components_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_kpi"
            referencedColumns: ["vendor_id"]
          },
          {
            foreignKeyName: "vendor_components_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _record_signature: {
        Args: {
          p_actor: string
          p_document_id: string
          p_document_type: string
          p_signature_id: string
        }
        Returns: Json
      }
      admin_list_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["role"]
        }[]
      }
      approve_irn: {
        Args: {
          p_approver_id: string
          p_irn_id: string
          p_remarks?: string
          p_signature_id: string
        }
        Returns: Json
      }
      approve_po_line: {
        Args: { p_actor: string; p_line_id: string; p_signature_id: string }
        Returns: Json
      }
      auth_is_staff: { Args: never; Returns: boolean }
      auth_role: { Args: never; Returns: Database["public"]["Enums"]["role"] }
      backfill_signature: {
        Args: {
          p_actor: string
          p_document_id: string
          p_document_type: string
          p_signature_id: string
        }
        Returns: Json
      }
      clone_jw_revision: {
        Args: {
          p_actor: string
          p_kind: string
          p_line_id: string
          p_old_jw_id: string
          p_patch: Json
        }
        Returns: Json
      }
      clone_po_revision: {
        Args: {
          p_actor: string
          p_kind: string
          p_line_id: string
          p_old_po_id: string
          p_patch: Json
        }
        Returns: Json
      }
      create_site_purchase: {
        Args: {
          p_component: string
          p_note: string
          p_project: string
          p_qty: number
          p_unit_cost: number
          p_user_id: string
          p_vendor: string
          p_vendor_name: string
        }
        Returns: Json
      }
      dispatch_job_work: {
        Args: { p_order_id: string; p_user_id: string }
        Returns: Json
      }
      document_fully_signed: {
        Args: { p_document_id: string; p_document_type: string }
        Returns: boolean
      }
      dump_migrations: {
        Args: never
        Returns: {
          name: string
          statements: string[]
          version: string
        }[]
      }
      duplicate_product_bom: {
        Args: { p_model: string; p_sku: string; p_src_template: string }
        Returns: string
      }
      fiscal_year_label: { Args: { d?: string }; Returns: string }
      get_lot_traceability: { Args: { p_lot_code: string }; Returns: Json }
      issue_requisition: {
        Args: { p_req_id: string; p_user_id: string }
        Returns: Json
      }
      next_grn_no: { Args: never; Returns: string }
      next_irn_no: { Args: never; Returns: string }
      next_jw_grn_no: { Args: never; Returns: string }
      next_jw_no: { Args: never; Returns: string }
      next_po_no: { Args: never; Returns: string }
      next_req_no: { Args: never; Returns: string }
      next_site_purchase_no: { Args: never; Returns: string }
      notify_grn_missing_invoice: {
        Args: { p_grn_id: string; p_user_id: string }
        Returns: undefined
      }
      peek_next_po_no: { Args: never; Returns: string }
      project_shortfall: {
        Args: { p_project: string }
        Returns: {
          component_id: string
          consumed_qty: number
          on_hand: number
          ordered_qty: number
          project_id: string
          required_qty: number
          sent_to_jw_qty: number
          shortfall_qty: number
        }[]
      }
      promote_assembly_line: {
        Args: { p_component_no?: string; p_line: string }
        Returns: string
      }
      receive_job_work: {
        Args: {
          p_answers?: Json
          p_grn_id: string
          p_line_id: string
          p_qty: number
          p_signature_id?: string
          p_user_id: string
        }
        Returns: Json
      }
      recompute_po_status: { Args: { p_po: string }; Returns: undefined }
      reject_irn: {
        Args: { p_approver_id: string; p_irn_id: string; p_reason: string }
        Returns: Json
      }
      reject_po_line: {
        Args: { p_approver_id: string; p_line_id: string; p_reason: string }
        Returns: Json
      }
      resubmit_irn: {
        Args: { p_answers: Json; p_irn_id: string; p_submitter_id: string }
        Returns: Json
      }
      sign_grn: {
        Args: { p_actor: string; p_grn_id: string; p_signature_id: string }
        Returns: Json
      }
      sign_job_work: {
        Args: { p_actor: string; p_jw_id: string; p_signature_id: string }
        Returns: Json
      }
      sign_po: {
        Args: { p_actor: string; p_po_id: string; p_signature_id: string }
        Returns: Json
      }
      submit_irn: {
        Args: {
          p_answers: Json
          p_component_id: string
          p_grn_id: string
          p_jw_line_id?: string
          p_piece_count: number
          p_piece_length: number
          p_piece_weight?: number
          p_piece_width: number
          p_po_line_id: string
          p_project_id: string
          p_qty: number
          p_signature_id?: string
          p_submitter_id: string
          p_target_lot_id?: string
          p_unit_cost: number
        }
        Returns: Json
      }
    }
    Enums: {
      bom_line_source: "template" | "manual" | "site_purchase"
      bom_status: "draft" | "approved"
      doc_status: "pending" | "approved" | "rejected"
      doc_type: "qap" | "drawing" | "spec" | "other"
      fg_status: "in_production" | "ready" | "dispatched"
      input_type: "dropdown" | "number" | "text"
      irn_field_type: "text" | "number" | "choice" | "checkbox" | "link"
      irn_status: "pending_approval" | "approved" | "rejected"
      jw_stage: "raw" | "completed"
      lot_status: "open" | "issued" | "consumed"
      movement_type: "receipt" | "issue" | "adjustment" | "transfer" | "return"
      po_line_approval_status: "pending_approval" | "approved" | "rejected"
      po_line_status: "pending" | "partial" | "received" | "cancelled"
      po_source: "system" | "phone"
      po_status:
        | "draft"
        | "sent"
        | "partial"
        | "completed"
        | "cancelled"
        | "superseded"
        | "pending_signature"
      project_status:
        | "planning"
        | "doc_approval"
        | "procurement"
        | "production"
        | "dispatched"
        | "closed"
        | "on_hold"
      quantity_type: "nos" | "length" | "area" | "weight"
      req_status: "open" | "partially_ordered" | "ordered" | "closed"
      role: "admin" | "founder" | "team_lead" | "team_member"
      tracking_mode: "item" | "box" | "bulk"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      bom_line_source: ["template", "manual", "site_purchase"],
      bom_status: ["draft", "approved"],
      doc_status: ["pending", "approved", "rejected"],
      doc_type: ["qap", "drawing", "spec", "other"],
      fg_status: ["in_production", "ready", "dispatched"],
      input_type: ["dropdown", "number", "text"],
      irn_field_type: ["text", "number", "choice", "checkbox", "link"],
      irn_status: ["pending_approval", "approved", "rejected"],
      jw_stage: ["raw", "completed"],
      lot_status: ["open", "issued", "consumed"],
      movement_type: ["receipt", "issue", "adjustment", "transfer", "return"],
      po_line_approval_status: ["pending_approval", "approved", "rejected"],
      po_line_status: ["pending", "partial", "received", "cancelled"],
      po_source: ["system", "phone"],
      po_status: [
        "draft",
        "sent",
        "partial",
        "completed",
        "cancelled",
        "superseded",
        "pending_signature",
      ],
      project_status: [
        "planning",
        "doc_approval",
        "procurement",
        "production",
        "dispatched",
        "closed",
        "on_hold",
      ],
      quantity_type: ["nos", "length", "area", "weight"],
      req_status: ["open", "partially_ordered", "ordered", "closed"],
      role: ["admin", "founder", "team_lead", "team_member"],
      tracking_mode: ["item", "box", "bulk"],
    },
  },
} as const
