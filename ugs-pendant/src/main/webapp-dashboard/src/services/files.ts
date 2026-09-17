import { FileStatus } from "../model/FileStatus";
import { WorkspaceFileList } from "../model/WorkspaceFileList";

// fetch() only rejects on a genuine network failure - an HTTP error status
// (a backend exception, e.g.) still resolves normally, so every one of these
// used to silently treat a failed request as a success. Confirmed that's not
// hypothetical: a failed open/upload with nothing checking response.ok left
// the dashboard looking like it just did nothing (or showed stale state)
// with no way to tell a real backend error happened at all, let alone what
// it was.
async function checkOk(response: Response): Promise<void> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Request to ${response.url} failed (${response.status})${body ? `: ${body}` : ""}`);
  }
}

export const getFileStatus = () => {
  return fetch("/api/v1/files/getFileStatus")
    .then((response) => response.text())
    .then((text) => {
      // Workaround for a quirk where the backend returns "NaN" if it is not a number
      let convertedText = text.replaceAll('"NaN"', "null");
      return JSON.parse(convertedText) as FileStatus;
    })
    .then((response) => {
      return response;
    });
};

export const send = () => {
  const url = "/api/v1/files/send";
  const request = {
    method: "POST",
  };

  return fetch(url, request).then(checkOk);
};

// Only primes the backend to skip to this line next time send() is called -
// doesn't itself start anything. line <= 0 clears it back to a normal full run.
export const runFromLine = (line: number): Promise<void> => {
  const request = {
    method: "POST",
  };
  return fetch(`/api/v1/files/runFromLine?line=${line}`, request).then(checkOk);
};

export const stop = () => {
  return fetch("/api/v1/files/cancel").then(checkOk);
};

export const pause = () => {
  return fetch("/api/v1/files/pause").then(checkOk);
};

export const getWorkspaceFileList = (): Promise<WorkspaceFileList> => {
  return fetch("/api/v1/files/getWorkspaceFileList").then((response) =>
    response.json()
  );
};

export const openWorkspaceFile = (relativePath: string): Promise<void> => {
  const request = {
    method: "POST",
  };
  // Encoded - relativePath can now contain "/" (a subfolder path from the
  // recursive workspace listing) as well as spaces/unicode in real job
  // names, none of which were ever safe unencoded in a query string.
  return fetch(
    `/api/v1/files/openWorkspaceFile?file=${encodeURIComponent(relativePath)}`,
    request
  ).then(checkOk);
};

export const createWorkspaceFolder = (relativePath: string): Promise<void> => {
  const request = {
    method: "POST",
  };
  return fetch(
    `/api/v1/files/createWorkspaceFolder?path=${encodeURIComponent(relativePath)}`,
    request
  ).then(checkOk);
};

export const closeFile = (): Promise<void> => {
  const request = {
    method: "POST",
  };
  return fetch("/api/v1/files/closeFile", request).then(checkOk);
};

export const uploadAndOpen = (file: File): Promise<void> => {
  let formData: FormData = new FormData();
  formData.append("file", file, file.name);

  const request = {
    method: "POST",
    body: formData,
  };
  return fetch(`/api/v1/files/uploadAndOpen`, request).then(checkOk);
};
