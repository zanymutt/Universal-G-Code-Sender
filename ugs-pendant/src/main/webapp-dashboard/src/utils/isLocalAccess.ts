// A remote dashboard session (viewed from a different device than the one
// actually running UGS - the whole point of this dashboard) can't offer
// browser features that need a secure context (the File System Access API's
// showSaveFilePicker - see download.ts) or that only ever make sense on the
// same machine as the backend (uploading a file, which lands in a disposable
// server-side temp copy - see OpenFileModal). A plain LAN address isn't
// automatically treated as a secure context the way the literal localhost/
// loopback address always is, regardless of TLS - confirmed there's no
// equivalent exception for "same machine, but reached by its LAN IP rather
// than by that literal hostname" - so only the literal address counts here.
export const isLocalAccess = () =>
  typeof window !== "undefined" && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
