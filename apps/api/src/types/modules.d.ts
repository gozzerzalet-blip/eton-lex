declare module 'pdf-parse' {
  interface PdfData { text: string; numpages: number; info: unknown }
  function pdfParse(buffer: Buffer, options?: Record<string, unknown>): Promise<PdfData>;
  export default pdfParse;
}

declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfData { text: string; numpages: number; info: unknown }
  function pdfParse(buffer: Buffer, options?: Record<string, unknown>): Promise<PdfData>;
  export default pdfParse;
}

declare module 'mammoth' {
  interface MammothResult { value: string; messages: unknown[] }
  function extractRawText(input: { path?: string; buffer?: Buffer }): Promise<MammothResult>;
  const mammoth: { extractRawText: typeof extractRawText };
  export default mammoth;
}

declare module 'node-cron' {
  interface ScheduledTask { start(): void; stop(): void; }
  function schedule(
    expression: string,
    task: () => void | Promise<void>,
    options?: Record<string, unknown>,
  ): ScheduledTask;
  const cron: { schedule: typeof schedule };
  export default cron;
}
