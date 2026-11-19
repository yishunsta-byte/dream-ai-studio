"use client";

import { useEffect } from "react";

export function AdminProjectHeadingFocus({ title }: { title: string }) {
  useEffect(() => {
    if (window.location.hash !== "#admin-project-heading") return;
    const frame = requestAnimationFrame(() => {
      const title = document.querySelector<HTMLElement>("#admin-project-heading h1");
      if (!title) return;
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
      title.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [title]);
  return null;
}
