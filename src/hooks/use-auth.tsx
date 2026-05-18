import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import type { Session, User } from "@supabase/supabase-js";

export type AppRole = "admin" | "runner" | "driver";

type AuthCtx = {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  loading: boolean;
  roleLoading: boolean;
  roleError: string | null;
  mustResetPassword: boolean;
  refreshMustReset: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signInWithGoogle: () => Promise<{ error?: string }>;
  resetPassword: (email: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mustResetPassword, setMustResetPassword] = useState(false);

  useEffect(() => {
    let mounted = true;
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!mounted) return;
      setSession(s);
      if (s?.user) {
        setRole(null);
        setTimeout(() => { fetchRole(s.user.id); fetchMustReset(s.user.id); }, 0);
      } else {
        setRole(null);
        setRoleError(null);
        setRoleLoading(false);
        setMustResetPassword(false);
      }
    });
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) {
        await fetchRole(data.session.user.id);
        await fetchMustReset(data.session.user.id);
      }
      else setRoleLoading(false);
      setLoading(false);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  async function fetchMustReset(userId: string) {
    const { data } = await supabase.from("profiles").select("must_reset_password").eq("id", userId).maybeSingle();
    setMustResetPassword(Boolean(data?.must_reset_password));
  }

  async function fetchRole(userId: string) {
    setRoleLoading(true);
    setRoleError(null);
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (error) {
      setRole(null);
      setRoleError(error.message);
      setRoleLoading(false);
      return;
    }
    if (!data || data.length === 0) {
      setRole(null);
      setRoleLoading(false);
      return;
    }
    const roles = data.map(r => r.role as AppRole);
    if (roles.includes("admin")) setRole("admin");
    else if (roles.includes("runner")) setRole("runner");
    else if (roles.includes("driver")) setRole("driver");
    else setRole(null);
    setRoleLoading(false);
  }

  const value: AuthCtx = {
    session,
    user: session?.user ?? null,
    role,
    loading,
    roleLoading,
    roleError,
    mustResetPassword,
    async refreshMustReset() {
      if (session?.user) await fetchMustReset(session.user.id);
    },
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      return { error: error?.message };
    },
    async signInWithGoogle() {
      const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
      return { error: result.error instanceof Error ? result.error.message : undefined };
    },
    async resetPassword(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      return { error: error?.message };
    },
    async signOut() {
      setRole(null);
      setRoleError(null);
      setRoleLoading(false);
      setMustResetPassword(false);
      await supabase.auth.signOut();
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be inside AuthProvider");
  return c;
}
