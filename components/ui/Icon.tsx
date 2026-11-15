import type { SVGProps } from "react";

const paths = {
  check: "m5 12 4 4L19 6", close: "m6 6 12 12M6 18 18 6",
  clock: "M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  spinner: "M22 12A10 10 0 1 1 12 2", warning: "m12 3 10 18H2L12 3Zm0 6v5m0 3h.01",
  lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3",
  flask: "M9 2h6M10 2v7l-6 10a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3L14 9V2M8 15h8",
  menu: "M4 6h16M4 12h16M4 18h16", arrow: "M5 12h14m-6-6 6 6-6 6",
  plus: "M12 5v14M5 12h14", folder: "M3 6h7l2 3h9v12H3z", home: "m3 10 9-7 9 7v11h-6v-7H9v7H3z",
  settings: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  info: "M12 11v6m0-10h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, className = "", ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`ui-icon ${className}`} {...props}><path d={paths[name]} /></svg>;
}
