import { createClient } from '@supabase/supabase-js'

// Konfiguracja klienta. Klucz "publishable"/anon jest z założenia publiczny (chroniony przez
// RLS) i może żyć w bundlu przeglądarki. Fallback poniżej sprawia, że apka działa od razu po
// sklonowaniu/deployu; można nadpisać zmiennymi środowiskowymi (VITE_SUPABASE_*).
//
// ⚠️ Uwaga bezpieczeństwa: ten projekt Supabase ma też tabele z wyłączonym RLS (dane ERP).
// Przed publicznym deployem włącz RLS na tych tabelach albo użyj osobnego projektu — inaczej
// ten klucz odsłoni te dane. Tabele wyścigowe mają RLS włączone.
const DEFAULT_URL = 'https://sebckrbvoghfdrppdxyt.supabase.co'
// legacy anon JWT (rola anon, publiczny z założenia) — zgodny ze wszystkimi wersjami supabase-js
const DEFAULT_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNlYmNrcmJ2b2doZmRycHBkeHl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyODIwMDUsImV4cCI6MjA5MTg1ODAwNX0.Ni6_5rnM4uySGkZBw37ujiiIz9-JC4izvCx2ZVt84F8'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_URL
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_ANON

export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = supabaseConfigured ? createClient(url, anonKey) : null

export const BUCKET_RAW = 'raw'
export const BUCKET_PROCESSED = 'processed'
