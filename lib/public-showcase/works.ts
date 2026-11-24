// T-240 공개 메인(NEON SCREEN) 작품 자료.
// 공개하기로 선택된 완성 작품만 이 모양으로 넘긴다. 개인 프로젝트·초안·저장 파일을 여기서 읽지 않는다.
// 지금 들어 있는 6개는 화면 소개용 예시(sample: true)이고, 재생할 수 있는 미디어는 연결돼 있지 않다(media: null).

export const SHOWCASE_KINDS = ["영상", "음악", "광고", "여행"] as const;
export type ShowcaseKind = (typeof SHOWCASE_KINDS)[number];
export const SHOWCASE_FILTERS = ["전체", ...SHOWCASE_KINDS] as const;
export type ShowcaseFilter = (typeof SHOWCASE_FILTERS)[number];

export type ShowcaseImage = { src: string; width: number; height: number };

// 재생 가능한 공개 파일이 실제로 생기기 전까지는 null로 둔다. 화면은 null이면 정지 이미지와 안내만 보여 준다.
export type ShowcaseMedia = { kind: "video" | "audio"; src: string } | null;

export type ShowcaseWork = {
  id: string;
  title: string;
  subtitle: string;
  creator: string;
  kind: ShowcaseKind;
  genre: string;
  format: string;
  description: string;
  image: ShowcaseImage;
  sample: boolean;
  media: ShowcaseMedia;
};

const IMAGE_ROOT = "/showcase/t240";
const wide = (name: string): ShowcaseImage => ({ src: `${IMAGE_ROOT}/${name}.png`, width: 1672, height: 941 });
const square = (name: string): ShowcaseImage => ({ src: `${IMAGE_ROOT}/${name}.png`, width: 1254, height: 1254 });

const SAMPLE_LIST: ShowcaseWork[] = [
  { id: "neon-after-hours", title: "NEON AFTER HOURS", subtitle: "도시가 잠든 뒤, 시작되는 리듬", creator: "DREAM ORIGINALS", kind: "영상", genre: "일렉트로닉", format: "뮤직 필름", description: "네온빛 도시와 사운드의 에너지를 담은 공연 필름이에요.", image: wide("neon-rooftop"), sample: true, media: null },
  { id: "desert-motion", title: "DESERT MOTION", subtitle: "오렌지빛 속도로 달리다", creator: "MOTION LAB", kind: "광고", genre: "팝", format: "브랜드 필름", description: "선명한 컬러와 사막 풍경으로 꾸민 자동차 광고예요.", image: wide("desert-motion"), sample: true, media: null },
  { id: "the-wild-coast", title: "THE WILD COAST", subtitle: "파도가 들려주는 또 다른 세계", creator: "FIELD NOTES", kind: "여행", genre: "앰비언트", format: "트래블 필름", description: "거대한 해안 풍경을 담은 여행 영상이에요.", image: wide("wild-coast"), sample: true, media: null },
  { id: "liquid-bloom", title: "LIQUID BLOOM", subtitle: "소리로 피어나는 새로운 감각", creator: "WAVE ROOM", kind: "음악", genre: "일렉트로닉", format: "일렉트로닉", description: "반짝이는 질감과 몽환적인 색을 주제로 한 일렉트로닉 앨범이에요.", image: square("orchid"), sample: true, media: null },
  { id: "celestial-drift", title: "CELESTIAL DRIFT", subtitle: "푸른 밤을 떠다니는 멜로디", creator: "ORBIT SOUND", kind: "음악", genre: "앰비언트", format: "앰비언트", description: "우주와 바다의 경계를 상상한 앰비언트 앨범이에요.", image: square("celestial"), sample: true, media: null },
  { id: "sunglass", title: "SUNGLASS", subtitle: "하루의 온도를 바꾸는 컬러", creator: "STUDIO SOL", kind: "음악", genre: "팝", format: "얼터너티브 팝", description: "유리 꽃과 선명한 오렌지 컬러를 쓴 팝 앨범이에요.", image: square("sunflower"), sample: true, media: null },
];
export const SAMPLE_WORKS: readonly ShowcaseWork[] = Object.freeze(SAMPLE_LIST.map((work) => Object.freeze(work)));

export function isShowcaseFilter(value: unknown): value is ShowcaseFilter {
  return typeof value === "string" && (SHOWCASE_FILTERS as readonly string[]).includes(value);
}

// 종류와 검색어를 함께 적용한다. 검색은 제목·부제·크리에이터·종류·장르·형식에서 대소문자 없이 찾는다.
export function filterWorks(works: readonly ShowcaseWork[], filter: ShowcaseFilter, query: string): ShowcaseWork[] {
  const needle = query.trim().toLocaleLowerCase("ko-KR");
  return works.filter((work) => {
    if (filter !== "전체" && work.kind !== filter) return false;
    if (!needle) return true;
    return [work.title, work.subtitle, work.creator, work.kind, work.genre, work.format].join(" ").toLocaleLowerCase("ko-KR").includes(needle);
  });
}

export function creatorInitials(creator: string): string {
  return creator.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
}
