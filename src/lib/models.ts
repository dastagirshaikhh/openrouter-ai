export type FallbackModel = {
  id: string;
  label: string;
};

export const DEFAULT_FALLBACK_CHAIN: FallbackModel[] = [
  { id: "inclusionai/ling-3.0-flash-fin:free", label: "Ling 3.0 Flash Fin" },
  { id: "nex-agi/nex-n2.5-mini:free", label: "Nex N2.5 Mini" },
  { id: "inclusionai/ling-3.0-flash-sante:free", label: "Ling 3.0 Flash Sante" },
  { id: "nvidia/nemotron-3.5-content-safety:free", label: "Nemotron 3.5 Content Safety" },
  { id: "nex-agi/nex-n2.5-pro:free", label: "Nex N2.5 Pro (secondary)" },
];

export const FORCE_SWITCH_CHAIN: FallbackModel[] = [
  { id: "inclusionai/does-not-exist:free", label: "Broken #1 (typo to force switch)" },
  { id: "nex-agi/also-not-real:free", label: "Broken #2 (typo to force switch)" },
  { id: "nex-agi/nex-n2.5-mini:free", label: "Nex N2.5 Mini (real fallback)" },
];

export const DEFAULT_PROMPT = "How many r's are in the word 'strawberry'?";
