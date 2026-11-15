import { PageHeader } from "@/components/ui/primitives";
import { LibraryBrowser } from "@/components/library-browser";
import { readLibrary } from "@/lib/services/library";
export default function LibraryPage() {return <><PageHeader title="자료·캐릭터" description="작품에 쓸 원본과 고정 설정을 한곳에 보관해요." /><LibraryBrowser data={readLibrary()} /></>;}
