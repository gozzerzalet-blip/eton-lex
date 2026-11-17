import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config.js';
import { ApiError } from './http.js';

const ALLOWED = new Map<string, string>([
  ['application/pdf', '.pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/msword', '.doc'],
  ['text/plain', '.txt'],
  ['text/markdown', '.md'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['audio/webm', '.webm'],
  ['audio/ogg', '.ogg'],
  ['audio/mpeg', '.mp3'],
  ['audio/mp4', '.m4a'],
  ['audio/wav', '.wav'],
]);

export function storageFor(subdir: 'documents' | 'ai' | 'avatars' | 'covers' | 'voice') {
  const dir = path.join(config.paths.uploads, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = ALLOWED.get(file.mimetype) ?? path.extname(file.originalname) ?? '.bin';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  });
}

export function uploader(subdir: 'documents' | 'ai' | 'avatars' | 'covers' | 'voice') {
  return multer({
    storage: storageFor(subdir),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 5 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED.has(file.mimetype)) {
        cb(new ApiError(415, 'UNSUPPORTED_TYPE', `Tipo de archivo no permitido: ${file.mimetype}`));
        return;
      }
      cb(null, true);
    },
  });
}

export async function extractText(filePath: string, mime: string): Promise<string | null> {
  try {
    if (mime === 'application/pdf') {
      const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default as unknown as (buf: Buffer) => Promise<{ text: string }>;
      const data = await pdfParse(fs.readFileSync(filePath));
      return data.text?.trim() || null;
    }
    if (mime.includes('wordprocessingml') || mime === 'application/msword') {
      const mammoth = (await import('mammoth')).default as unknown as {
        extractRawText: (input: { path: string }) => Promise<{ value: string }>;
      };
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value?.trim() || null;
    }
    if (mime.startsWith('text/')) {
      return fs.readFileSync(filePath, 'utf8').slice(0, 500_000);
    }
  } catch (err) {
    console.warn('[files] no se pudo extraer texto:', (err as Error).message);
  }
  return null;
}

export function fileBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString('base64');
}

export function safeUnlink(filePath: string) {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}
