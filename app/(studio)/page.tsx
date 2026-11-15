import Link from "next/link";
import { getMenuConfig } from "@/lib/menus/server";
import { Badge, Card, EmptyState, PageHeader, PhaseChip } from "@/components/ui/primitives";

export default function Home() {
  const config = getMenuConfig();
  return (
    <><PageHeader title="작업실" description="아이디어를 작품으로, 한 단계씩 완성해요." chips={<Badge tone="accent">나만의 AI 콘텐츠 작업실</Badge>} />
      <Card><EmptyState title="첫 작품을 준비해 볼까요?" description="아직 등록한 프로젝트가 없어요. 만들고 싶은 분야를 먼저 둘러보세요." action={<Link href="/menus/shopping-shorts">쇼핑숏츠 둘러보기 →</Link>} /></Card>
      <section className="stack" aria-labelledby="fields-heading"><div><h2 id="fields-heading">어떤 작품을 만들까요?</h2><p className="muted">지금 시작할 수 있는 분야부터, 앞으로 열릴 작업까지 살펴보세요.</p></div><div className="grid">{config.groups.slice().sort((a,b)=>a.order-b.order).flatMap((group)=>config.menus.filter((menu)=>menu.group===group.id).map((menu)=><Card key={menu.id}><div className="stack"><div className="cluster"><Badge>{group.label}</Badge><PhaseChip phase={Number(menu.phase.slice(1)) as 0|1|2|3|4|5|6|7|8} /></div><h3>{menu.label}</h3><p className="muted">{menu.description}</p><Link href={`/menus/${menu.id}`}>{menu.availability === "active" ? "분야 살펴보기" : "준비 중인 분야 둘러보기"} →</Link></div></Card>))}</div></section>
    </>
  );
}
