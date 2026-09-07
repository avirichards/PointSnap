export function authConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return (
    !!url && !url.includes("<") && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
