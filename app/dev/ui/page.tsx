import { notFound } from "next/navigation";
import { UiGallery } from "./ui-gallery";

export default function UiPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <UiGallery />;
}
