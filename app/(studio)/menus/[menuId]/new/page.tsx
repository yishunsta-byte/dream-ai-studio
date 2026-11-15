import Link from "next/link";
import { notFound } from "next/navigation";
import { getMenuConfig } from "@/lib/menus/server";
import { Callout, PageHeader } from "@/components/ui/primitives";

export default async function NewProjectPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const menu = getMenuConfig().menus.find((entry)=>entry.id===menuId);
  if (!menu || menu.availability !== "active") notFound();
  return <><PageHeader title="새 프로젝트 준비" description={`${menu.label}에 필요한 자료를 준비해 주세요.`} /><Callout title="프로젝트 등록 기능을 준비하고 있어요.">자료를 저장하는 기능은 다음 단계에서 연결돼요. 지금은 분야 소개에서 필요한 내용을 살펴볼 수 있어요.</Callout><Link href={`/menus/${menu.id}`}>분야 소개로 돌아가기 →</Link></>;
}
