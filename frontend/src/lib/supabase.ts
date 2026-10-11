import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    "Supabase env vars are missing. Copy .env.example to .env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
  );
}

/**
 * Browser Supabase client. Respects Row Level Security — every query runs as
 * the signed-in (possibly anonymous) user/team.
 */
export const supabase = createClient(url, anonKey);

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
