import Image from "next/image";
import { appConfig } from "@/lib/config/app";
import styles from "./brand-logo.module.css";

export function BrandMark({ size = 32 }: { size?: number }) {
  return <Image src={appConfig.brandMark} alt="" width={size} height={size} unoptimized className={styles.mark} />;
}

export function BrandLogo({ markSize = 32 }: { markSize?: number }) {
  return <span className={styles.logo}><BrandMark size={markSize} />{appConfig.name}</span>;
}
