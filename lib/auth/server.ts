import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublicConfig } from "./config";

// 서버 컴포넌트·라우트에서 쓰는 Supabase 연결(로그인 세션 쿠키 사용, 비밀키 없음).
export async function createSupabaseServer(options?: Readonly<{
  fetch?: typeof fetch;
  cookieWrites?: "disabled" | Readonly<{ onError: () => void; onWritten: () => void }>;
}>) {
  const config = supabasePublicConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.anonKey, {
    ...(options?.fetch && { global: { fetch: options.fetch } }),
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 세션 갱신은 proxy가 맡는다.
        const policy = options?.cookieWrites;
        if (policy === "disabled") return;
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
          if (list.length) policy?.onWritten();
        } catch { policy?.onError(); }
      },
    },
  });
}
