import { shortsIdeaSelection } from "./shorts-ideas-contract";

export const shortsCreativeSelectedIdea = shortsIdeaSelection.pick({ title: true, openingHook: true });
export const hasEnglishPromptText = (text: string) => /[A-Za-z]{2,}/.test(text) && !/[^\p{Script=Latin}\P{L}]/u.test(text);
