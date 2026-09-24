export type GcodeReviewDiagnostic = {
  lineNumber: number;
  severity: "ERROR" | "WARNING";
  message: string;
  source: string;
};

export type GcodeReviewResult = {
  fileName: string;
  lineCount: number;
  diagnostics: GcodeReviewDiagnostic[];
};

export const reviewGcode = (content: string): Promise<GcodeReviewResult> => {
  return fetch("/api/v1/review", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: content,
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Couldn't review G-code (${response.status})`);
    }
    return response.json();
  });
};
