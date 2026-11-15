import { getMenuConfig } from "@/lib/menus/server";
import { Badge, Card, Callout, PageHeader } from "@/components/ui/primitives";
export default function SettingsPage() { const config=getMenuConfig(); return <><PageHeader title="설정" description="작업 환경과 앱 정보를 살펴봐요." /><Callout title="설정 기능을 준비하고 있어요.">실제 AI 연결은 이후 단계에서 제공해요. 지금은 계정 연결이나 유료 생성을 실행하지 않아요.</Callout><Card><h2>앱 정보</h2><div className="cluster"><Badge>앱 0.1.0</Badge><Badge>템플릿 {config.templateVersion}</Badge></div></Card></>; }
