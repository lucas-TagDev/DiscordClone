import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import busboy from "busboy";

export type ParsedFile = {
  name: string;
  size: number;
  mimeType: string;
  buffer: Buffer;
};

export type ParsedFormData = {
  fields: Record<string, string>;
  files: ParsedFile[];
};

/**
 * Parse multipart form data from a Request using busboy (streaming).
 * Bypasses the default request.formData() size limit in Next.js.
 */
export async function parseMultipartFormData(
  request: Request,
  maxFileSizeBytes: number,
): Promise<ParsedFormData> {
  const contentType = request.headers.get("content-type") ?? "";

  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const files: ParsedFile[] = [];

    const bb = busboy({
      headers: { "content-type": contentType },
      limits: {
        fileSize: maxFileSizeBytes,
        files: 10,
      },
    });

    bb.on("field", (name: string, value: string) => {
      fields[name] = value;
    });

    bb.on("file", (name: string, stream: NodeJS.ReadableStream, info: { filename: string; encoding: string; mimeType: string }) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;

      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        chunks.push(chunk);
      });

      stream.on("limit", () => {
        truncated = true;
      });

      stream.on("end", () => {
        if (truncated) {
          return; // Skip files that exceed the limit
        }
        if (info.filename && size > 0) {
          files.push({
            name: info.filename,
            size,
            mimeType: info.mimeType,
            buffer: Buffer.concat(chunks),
          });
        }
      });
    });

    bb.on("finish", () => {
      resolve({ fields, files });
    });

    bb.on("error", (error: Error) => {
      reject(error);
    });

    // Convert the Web ReadableStream to a Node.js Readable and pipe to busboy
    const body = request.body;
    if (!body) {
      resolve({ fields, files: [] });
      return;
    }

    const nodeStream = Readable.fromWeb(body as import("stream/web").ReadableStream);
    nodeStream.pipe(bb);
  });
}

/**
 * Save a parsed file to disk and return its metadata.
 */
export async function saveParsedFile(
  file: ParsedFile,
  uploadsSubDir: string,
): Promise<{ name: string; size: number; url: string }> {
  if (file.size <= 0) {
    throw new Error("Arquivo vazio não é permitido.");
  }

  const uploadsDir = path.join(process.cwd(), "public", "uploads", uploadsSubDir);
  await mkdir(uploadsDir, { recursive: true });

  const extension = path.extname(file.name);
  const baseName = path.basename(file.name, extension);
  const safeBaseName = baseName
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 120) || "arquivo";
  const finalFileName = `${Date.now()}-${randomUUID()}-${safeBaseName}${extension}`;
  const finalPath = path.join(uploadsDir, finalFileName);

  await writeFile(finalPath, file.buffer);

  return {
    name: file.name,
    size: file.size,
    url: `/uploads/${uploadsSubDir}/${finalFileName}`,
  };
}
