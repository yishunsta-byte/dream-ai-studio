import { PageHeader } from "@/components/ui/primitives";
import { LibraryBrowser } from "@/components/library-browser";
import { readLibrary } from "@/lib/services/library";
import { legacyPageGate } from "@/lib/auth/legacy-page-gate";
export default async function LibraryPage() {
 const blocked=await legacyPageGate();if(blocked)return blocked;return <><PageHeader title="자료·캐릭터" description="작품에 쓸 원본과 고정 설정을 한곳에 보관해요." /><LibraryBrowser data={readLibrary()} /></>;}
