// Shared by browser and server. No secrets here.

export type RuntimeSettings = {
  maintenanceEnabled: boolean;
  maintenanceMessage: string;
  generationEnabled: boolean;
};

export const MESSAGE_MAX = 200;

export const DEFAULT_SETTINGS: RuntimeSettings = {
  maintenanceEnabled: false,
  maintenanceMessage: "",
  generationEnabled: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lenient read of stored data: anything unexpected falls back to the default. */
export function parseSettings(value: unknown): RuntimeSettings {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS;
  }
  return {
    maintenanceEnabled: value.maintenanceEnabled === true,
    maintenanceMessage:
      typeof value.maintenanceMessage === "string"
        ? value.maintenanceMessage.slice(0, MESSAGE_MAX)
        : "",
    generationEnabled: value.generationEnabled !== false,
  };
}

/** Strict check of what an admin submits. */
export function validateSettingsInput(
  value: unknown,
): { ok: true; value: RuntimeSettings } | { ok: false; message: string } {
  if (
    !isRecord(value) ||
    typeof value.maintenanceEnabled !== "boolean" ||
    typeof value.generationEnabled !== "boolean" ||
    typeof value.maintenanceMessage !== "string"
  ) {
    return { ok: false, message: "The settings were not in the expected format." };
  }
  const message = value.maintenanceMessage.replace(/\s+/g, " ").trim();
  if (message.length > MESSAGE_MAX) {
    return { ok: false, message: `The message can have at most ${MESSAGE_MAX} characters.` };
  }
  return {
    ok: true,
    value: {
      maintenanceEnabled: value.maintenanceEnabled,
      maintenanceMessage: message,
      generationEnabled: value.generationEnabled,
    },
  };
}