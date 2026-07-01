import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** true gdy env skonfigurowane — pozwala aplikacji działać lokalnie bez chmury. */
export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = supabaseConfigured
  ? createClient(url!, anonKey!)
  : null

export const BUCKET_RAW = 'raw'
export const BUCKET_PROCESSED = 'processed'
