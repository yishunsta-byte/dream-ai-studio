export function localProjectFormEnabled() {
  return process.env.NODE_ENV !== "production" && !process.env.VERCEL &&
      process.env.DREAM_PRIVATE_UPLOAD_BACKEND === "owned-pg17" &&
      process.env.DREAM_PROJECT_CREATE_BACKEND === "owned-pg17" &&
      /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
}
