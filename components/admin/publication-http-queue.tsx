"use client";

import { useState } from "react";
import type { PublicationList } from "./publication-model";
import { createHttpPublicationProvider } from "./publication-http-provider";
import { PublicationQueue } from "./publication-queue";

// T297: 실제 /admin에서 쓰는 게시 큐. 첫 목록은 서버 화면이 인증 뒤 읽어 넘기고, 이후 조회·쓰기는 동일 출처 API로 한다.
// 공급자는 한 번만 만든다(같은 load·apply 참조 유지 → 큐의 공급자 세대가 바뀌지 않음).
export function PublicationHttpQueue({ initial }: Readonly<{ initial: PublicationList }>) {
  const [provider] = useState(createHttpPublicationProvider);
  return <PublicationQueue source="server" initial={initial} load={provider.list} apply={provider.apply} />;
}
