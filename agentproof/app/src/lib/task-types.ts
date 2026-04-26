export const TASK_TYPES = [
  { value: "SOLANA_SWAP",        label: "Solana Swap" },
  { value: "DATA_ANALYSIS",      label: "Data Analysis" },
  { value: "REPORT_GENERATION",  label: "Report Generation" },
  { value: "DEFI_OPERATION",     label: "DeFi Operation" },
  { value: "CUSTOM",             label: "Custom" },
] as const;

export type TaskType = typeof TASK_TYPES[number]["value"];
