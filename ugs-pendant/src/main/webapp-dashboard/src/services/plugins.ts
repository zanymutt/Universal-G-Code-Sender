export type PluginInfo = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  // Pre-resolved by the backend (PluginsResource) to this plugin's actual
  // /api/v1/plugins/{id}/files/... route - callers never reconstruct a
  // plugin's file paths themselves.
  entryUrl: string;
  iconUrl?: string;
  allowMultipleInstances?: boolean;
};

export const listPlugins = (): Promise<PluginInfo[]> => {
  return fetch("/api/v1/plugins/list").then((response) => {
    if (!response.ok) {
      throw new Error(`Couldn't load the plugin list (${response.status})`);
    }
    return response.json();
  });
};

export const getPluginSettings = (id: string): Promise<Record<string, unknown>> => {
  return fetch(`/api/v1/plugins/${encodeURIComponent(id)}/settings`).then((response) => {
    if (!response.ok) {
      throw new Error(`Couldn't load settings for plugin "${id}" (${response.status})`);
    }
    return response.json();
  });
};

export const savePluginSettings = (id: string, data: unknown): Promise<void> => {
  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data ?? {}),
  };

  return fetch(`/api/v1/plugins/${encodeURIComponent(id)}/settings`, request).then((response) => {
    if (!response.ok) {
      throw new Error(`Couldn't save settings for plugin "${id}" (${response.status})`);
    }
  });
};
