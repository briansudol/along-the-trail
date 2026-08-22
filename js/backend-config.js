/**
 * Public backend config for Along the Trail.
 *
 * Leave these empty to use the local admin_server.py APIs (when running
 * `python3 admin_server.py`) and fall back to localStorage for demos.
 *
 * For GitHub Pages / production:
 *   1. Create a Supabase project and run supabase/schema.sql
 *   2. Paste the project URL and anon key below (the anon key is public)
 *   3. Optional: Formspree endpoint for newsletter-only persistence
 *
 * moderateSecret is only used from localhost admin to approve/reject
 * Supabase uploads. Do not treat it as a public API key.
 */
window.TRAIL_BACKEND = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  formspreeNewsletter: "",
  moderateSecret: "",
};
