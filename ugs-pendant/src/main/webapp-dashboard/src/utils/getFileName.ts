// Strips a full path down to its last segment, whichever separator it uses -
// backendAPI.getGcodeFile() gives an OS-native absolute path, so this has to
// handle both "/" (Linux/macOS, and workspace-relative paths everywhere) and
// "\" (a plain Windows path) rather than assuming one.
export const getFileName = (filePath: string): string => filePath.replace(/^.*[\\/]/, "");
