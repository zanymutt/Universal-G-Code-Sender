// A failed save's real cause (a locked file, a network share that dropped out,
// a full disk...) comes back from the backend as a PendantError JSON body -
// see ExceptionMapper.java. Without this, every failure collapsed into the
// same generic "(500)" message regardless of what actually went wrong, which
// left no way to tell a real problem from a transient one.
async function backendErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = await response.clone().json();
    return typeof body?.errorMessage === "string" && body.errorMessage ? body.errorMessage : null;
  } catch {
    return null;
  }
}

export const getFileContent = (): Promise<string> => {
  return fetch("/api/v1/files/getFileContent").then((response) => {
    if (!response.ok) {
      throw new Error(`Couldn't load file content (${response.status})`);
    }
    return response.text();
  });
};

export const saveFileContent = (content: string): Promise<void> => {
  const request = {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
    },
    body: content,
  };

  return fetch("/api/v1/files/saveFileContent", request).then(async (response) => {
    if (!response.ok) {
      const reason = await backendErrorMessage(response);
      throw new Error(reason ? `Couldn't save file content: ${reason}` : `Couldn't save file content (${response.status})`);
    }
  });
};

export const saveFileContentAs = (filename: string, content: string): Promise<void> => {
  const request = {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
    },
    body: content,
  };

  return fetch(
    `/api/v1/files/saveFileContentAs?filename=${encodeURIComponent(filename)}`,
    request
  ).then(async (response) => {
    if (!response.ok) {
      const reason = await backendErrorMessage(response);
      throw new Error(
        reason ? `Couldn't save file as "${filename}": ${reason}` : `Couldn't save file as "${filename}" (${response.status})`
      );
    }
  });
};
