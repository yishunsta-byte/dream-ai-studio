import { z } from "zod";
import { menusSchema, type MenuConfig, type Menu } from "./schema";

export const menuSnapshotSchema=z.strictObject({
  schemaVersion:z.literal(1),templateVersion:menusSchema.shape.templateVersion,
  stages:menusSchema.shape.stages,commonInputs:menusSchema.shape.commonInputs,
  commonReview:menusSchema.shape.commonReview,conditionalReview:menusSchema.shape.conditionalReview,
  menu:menusSchema.shape.menus.element,
});
export function snapshotForMenu(config:MenuConfig,menu:Menu) {
  return menuSnapshotSchema.parse({schemaVersion:config.schemaVersion,templateVersion:config.templateVersion,stages:config.stages,commonInputs:config.commonInputs,commonReview:config.commonReview,conditionalReview:config.conditionalReview,menu});
}
