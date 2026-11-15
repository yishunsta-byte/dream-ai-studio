"use client";
import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from "react";
export type BreadcrumbValue={title:string;parent:string}|null;
export const BreadcrumbContext=createContext<Dispatch<SetStateAction<BreadcrumbValue>>>(()=>{});
export function BreadcrumbLabel({title,parent}:{title:string;parent:string}) {
 const setBreadcrumb=useContext(BreadcrumbContext);
 useEffect(()=>{setBreadcrumb({title,parent});return()=>setBreadcrumb(null);},[title,parent,setBreadcrumb]);
 return null;
}
