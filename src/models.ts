// The Whisper models Blab can run, and the settings that pick between them.
//
// Every model is fetched once, at setup time (`npm run setup`), and lives in
// public/models for the rest of the app's life. The app itself never
// downloads: choosing a model here only decides which already-installed
// weights the worker loads.

export type ModelId = "base" | "small" | "medium";

export type ModelInfo = {
  id: ModelId;
  label: string;
  hint: string;
  /** HuggingFace repo; also the folder name under models/, because the
   * onnxruntime loading in the worker keys on exactly this string. */
  repo: string;
  /** Approximate download size, for the picker. */
  size: string;
  /** Whose machine can run it without the wait becoming the feature. */
  cpu: "any" | "modern" | "strong";
};

export const MODELS: ModelInfo[] = [
  {
    id: "base",
    label: "Fast",
    hint: "good on any laptop",
    repo: "Xenova/whisper-base",
    size: "~75 MB",
    cpu: "any",
  },
  {
    id: "small",
    label: "Balanced",
    hint: "more accurate, slower",
    repo: "Xenova/whisper-small",
    size: "~240 MB",
    cpu: "modern",
  },
  {
    id: "medium",
    label: "Best",
    hint: "most accurate, slow on CPU",
    repo: "Xenova/whisper-medium",
    size: "~770 MB",
    cpu: "strong",
  },
];

export const DEFAULT_MODEL: ModelId = "base";

export function modelById(id: string | null): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

// ------------------------------------------------------------------ settings
//
// Plain strings, so localStorage is enough; the handles store (src/store.ts)
// exists for the one thing that cannot be stringified. Both keys were chosen
// to survive a future Blab that wants different defaults: explicit "on"/"off"
// rather than presence.

const MODEL_KEY = "blab-model";
const SYSTEM_KEY = "blab-capture-system";

/** The model the user last chose, or the fast default. */
export function savedModel(): ModelId {
  const v = localStorage.getItem(MODEL_KEY);
  return v === "base" || v === "small" || v === "medium" ? v : DEFAULT_MODEL;
}

export function saveModel(id: ModelId): void {
  localStorage.setItem(MODEL_KEY, id);
}

/** Whether the user wants computer audio captured too, last time they said. */
export function savedSystemCapture(): boolean {
  return localStorage.getItem(SYSTEM_KEY) === "on";
}

export function saveSystemCapture(on: boolean): void {
  localStorage.setItem(SYSTEM_KEY, on ? "on" : "off");
}
