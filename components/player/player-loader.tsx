"use client";
import dynamic from "next/dynamic";
import type { CSSProperties } from "react";
import type { PlayerPanelProps } from "./player-panel";
import styles from "./player-panel.module.css";

// Client only (T-067 3.6): the Player is never part of the server HTML. Until it arrives the slot is empty and CSS
// shows the "loading" box in the saved aspect, so the page does not jump when the Player comes in (T-072 C-4).
const PlayerPanel=dynamic(()=>import("./player-panel").then(module=>module.PlayerPanel),{ssr:false,loading:()=>null});
export function PlayerLoader(props:PlayerPanelProps){
  return <div className={styles.slot} data-loading="미리보기를 준비하고 있어요." style={{"--slot-ratio":props.savedAspect.replace(":"," / ")} as CSSProperties}><PlayerPanel {...props}/></div>;
}
