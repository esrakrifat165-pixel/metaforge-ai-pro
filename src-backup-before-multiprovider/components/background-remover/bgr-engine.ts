// METAFORGE-BGREMOVER v1 - engine wrapper for @imgly/background-removal (runs in the browser).
// The library is imported lazily so it is never evaluated during server rendering.

export type ModelId = "isnet_quint8" | "isnet_fp16" | "isnet";

export const MODEL_OPTIONS: { id: ModelId; label: string; hint: string }[] = [
  {
    id: "isnet_quint8",
    label: "Fast",
    hint: "Smallest download and lowest memory use. May be slightly less accurate on fine edges.",
  },
  {
    id: "isnet_fp16",
    label: "Balanced",
    hint: "Default. Good accuracy at a moderate download size.",
  },
  {
    id: "isnet",
    label: "Best",
    hint: "Largest download and highest memory use. Highest accuracy of the three.",
  },
];

export const DEFAULT_MODEL: ModelId = "isnet_fp16";

type ProgressFn = (key: string, current: number, total: number) => void;

interface RemoveBackgroundConfig {
  model?: ModelId;
  output?: { format?: "image/png"; quality?: number };
  progress?: ProgressFn;
}

type RemoveBackgroundFn = (image: Blob, config?: RemoveBackgroundConfig) => Promise<Blob>;

let enginePromise: Promise<RemoveBackgroundFn> | null = null;

function loadEngine(): Promise<RemoveBackgroundFn> {
  if (!enginePromise) {
    const loading = import("@imgly/background-removal").then(
      (mod) => mod.removeBackground as unknown as RemoveBackgroundFn,
    );
    enginePromise = loading;
    // If loading fails, allow a later retry to attempt the import again.
    loading.catch(() => {
      if (enginePromise === loading) enginePromise = null;
    });
  }
  return enginePromise;
}

/**
 * Run real background removal on one image. Resolves with a PNG blob that has an alpha channel.
 * The stage callback only reports events the engine itself emits.
 */
export async function removeBackgroundFromFile(
  file: Blob,
  model: ModelId,
  onStage: (stage: string) => void,
): Promise<Blob> {
  onStage("Loading engine");
  const removeBackground = await loadEngine();
  let lastStage = "";
  const report = (stage: string) => {
    if (stage !== lastStage) {
      lastStage = stage;
      onStage(stage);
    }
  };
  report("Starting");
  return removeBackground(file, {
    model,
    output: { format: "image/png" },
    progress: (key, current, total) => {
      if (key.startsWith("fetch")) {
        const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : null;
        report(pct === null ? "Downloading model data" : `Downloading model data (${pct}%)`);
      } else if (key.startsWith("compute")) {
        const step = key.includes(":") ? key.slice(key.indexOf(":") + 1) : "";
        report(step ? `Working: ${step}` : "Working");
      } else {
        report("Processing");
      }
    },
  });
}