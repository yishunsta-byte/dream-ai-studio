import { appConfig } from "@/lib/config/app";

export default function Home() {
  return (
    <main>
      <h1>{appConfig.name}</h1>
      <p>작업실을 준비하고 있습니다.</p>
    </main>
  );
}
