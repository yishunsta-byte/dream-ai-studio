export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getMenuConfigState } = await import("./lib/menus/server");
    const result = getMenuConfigState();
    if (!result.ok) {
      console.error("메뉴 설정 검증 실패:", result.issues);
    }
  }
}
