"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/ui/primitives";

type Brief = { title: string; goal: string; target: string; product: string | null; facts: string | null;
  sources: string | null; rights: string | null; aspect: string; lengthSec: number; revision: number;
  stages: { intake: string; brief: string; plan: string } };

export function ProjectBrief({ projectId }: { projectId: string }) {
  const endpoint = `/api/projects/${projectId}/brief`;
  const plan = `/cloud/projects/${projectId}/plan`;
  const router = useRouter();
  const [data, setData] = useState<Brief>();
  const [error, setError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const writing = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const snapshot: Brief = await response.json();
        if (!controller.signal.aborted) setData(snapshot);
      } catch {
        if (!controller.signal.aborted) setError("브리프를 불러오지 못했어요.");
      }
    }
    void load();
    return () => controller.abort();
  }, [endpoint, attempt]);

  async function approve() {
    if (!acknowledged || !data || writing.current) return;
    writing.current = true;
    setPending(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged, revision: data.revision }) });
      if (!response.ok) throw new Error();
      router.push(plan);
      router.refresh();
    } catch {
      setError("승인 결과를 확인해 주세요. 현재 상태를 다시 불러올 수 있어요.");
      setAcknowledged(false);
    } finally { writing.current = false; setPending(false); }
  }

  return <Card><h2>브리프 확인</h2>
    {error ? <><p role="alert">{error}</p><Button onClick={() => {
      setError(""); setData(undefined); setAttempt(value => value + 1); router.refresh();
    }}>현재 상태 다시 확인</Button></> : !data ? <p role="status">브리프를 불러오는 중이에요.</p>
      : data.stages.brief === "approved" ? <><p>브리프가 승인됐어요.</p><Link href={plan}>기획 단계로 이동</Link></>
      : <><dl>{[["목표",data.goal],["대상",data.target],["제품",data.product],["장점",data.facts],
        ["장점 출처",data.sources],["이미지 사용권",data.rights],["영상 형식",`${data.aspect} · ${data.lengthSec}초`]].map(([label,value]) =>
        <div key={label}><dt>{label}</dt><dd>{value || "미입력"}</dd></div>)}</dl>
        <label><input type="checkbox" disabled={pending} checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />입력 내용과 미확인 항목을 검토했어요.</label>
        <Button loading={pending} disabled={!acknowledged || data.stages.intake !== "approved" || data.stages.brief !== "todo" || data.stages.plan !== "locked"}
          onClick={approve}>브리프 승인하고 기획 단계로 이동</Button>
      </>}
  </Card>;
}
