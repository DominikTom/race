import { supabase } from './supabase'

export interface AdminUser {
  id: string
  email: string | null
  created_at: string
  last_sign_in_at: string | null
  is_admin: boolean
}

/** Czy zalogowany użytkownik jest adminem (RPC is_admin). */
export async function checkIsAdmin(): Promise<boolean> {
  if (!supabase) return false
  const { data, error } = await supabase.rpc('is_admin')
  if (error) return false
  return Boolean(data)
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase nie skonfigurowany')
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    // spróbuj wyciągnąć komunikat z odpowiedzi funkcji
    const ctx = (error as { context?: { body?: unknown } }).context
    throw new Error((ctx?.body as { error?: string })?.error ?? error.message)
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error)
  return data as T
}

export function adminListUsers(): Promise<{ users: AdminUser[] }> {
  return invoke({ action: 'list' })
}

export function adminCreateUser(
  email: string,
  password: string,
  isAdmin: boolean,
): Promise<{ user: { id: string; email: string } }> {
  return invoke({ action: 'create', email, password, is_admin: isAdmin })
}

export function adminDeleteUser(id: string): Promise<{ ok: boolean }> {
  return invoke({ action: 'delete', id })
}
