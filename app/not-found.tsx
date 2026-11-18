import Link from "next/link";
export default function NotFound() { return <main className="content"><h1>찾는 화면이 없어요</h1><p>주소를 확인하거나 작업실에서 분야를 다시 골라 주세요.</p><Link href="/studio">작업실로 돌아가기 →</Link></main>; }
