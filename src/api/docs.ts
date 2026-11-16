import type { DocFile, DocFolder } from "../types/agent";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export interface DocsTree {
  folders: DocFolder[];
  files: DocFile[];
}

export interface UploadDocsResult {
  files: DocFile[];
  indexed: number;
  errors: string[];
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { detail?: string };
    if (parsed.detail) return parsed.detail;
  } catch {
    /* plain */
  }
  return text || `Ошибка ${res.status}`;
}

export async function fetchDocsTree(): Promise<DocsTree> {
  const res = await fetch(`${API_BASE}/api/docs/tree`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function createDocsFolder(
  name: string,
  description = "",
): Promise<DocFolder> {
  const res = await fetch(`${API_BASE}/api/docs/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateDocsFolder(
  folderId: string,
  partial: { name?: string; description?: string },
): Promise<DocFolder> {
  const res = await fetch(`${API_BASE}/api/docs/folders/${encodeURIComponent(folderId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(partial),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteDocsFolder(folderId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/docs/folders/${encodeURIComponent(folderId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function uploadDocsFiles(
  folderId: string,
  files: FileList | File[],
): Promise<UploadDocsResult> {
  const form = new FormData();
  for (const file of Array.from(files)) {
    form.append("files", file);
  }
  const res = await fetch(
    `${API_BASE}/api/docs/folders/${encodeURIComponent(folderId)}/files`,
    { method: "POST", body: form },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteDocsFile(folderId: string, filename: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/docs/folders/${encodeURIComponent(folderId)}/files/${encodeURIComponent(filename)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await readError(res));
}

export async function reindexDocs(): Promise<{ documents: number; errors: string[] }> {
  const res = await fetch(`${API_BASE}/api/docs/reindex`, { method: "POST" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export interface EtlCollectionInfo {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  createdAt: string;
}

export interface EtlRunRequest {
  etlRunExtract: boolean;
  etlRunEnrich: boolean;
  etlRunIndex: boolean;
  etlRunContext: boolean;
  etlDocFolderIds: string[];
  etlSkipBold: boolean;
  etlSkipHierarchy: boolean;
  etlSkipSummary: boolean;
  etlForce: boolean;
  etlKeepSourcePdf: boolean;
  etlCollection: string;
}

export interface EtlJob {
  jobId: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  params: Record<string, unknown>;
  pdfCount: number;
  docxCount?: number;
  skippedNonPdf: string[];
  pid: number | null;
  exitCode: number | null;
  active: boolean;
  logTail?: string;
}

export async function startEtlJob(body: EtlRunRequest): Promise<EtlJob> {
  const res = await fetch(`${API_BASE}/api/docs/etl/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchEtlJob(jobId: string): Promise<EtlJob> {
  const res = await fetch(`${API_BASE}/api/docs/etl/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchEtlJobs(limit = 10): Promise<{
  jobs: EtlJob[];
  activeJobId: string | null;
}> {
  const res = await fetch(`${API_BASE}/api/docs/etl/jobs?limit=${limit}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function cancelEtlJob(jobId: string): Promise<EtlJob> {
  const res = await fetch(
    `${API_BASE}/api/docs/etl/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchEtlCollections(): Promise<EtlCollectionInfo[]> {
  const res = await fetch(`${API_BASE}/api/docs/etl/collections`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function createEtlCollection(body: {
  name: string;
  id?: string;
  description?: string;
}): Promise<EtlCollectionInfo> {
  const res = await fetch(`${API_BASE}/api/docs/etl/collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteEtlCollection(collectionId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/docs/etl/collections/${encodeURIComponent(collectionId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await readError(res));
}

export interface ChromaStatus {
  path: string;
  exists: boolean;
  etlActiveJobId: string | null;
  writable: boolean;
  writing: boolean;
}

export interface ChromaCollectionInfo {
  id: string;
  name: string;
  count: number;
  metadata: Record<string, unknown>;
  /** job — прогон «Базы документов», corpus — база знаний, data — прежняя база. */
  source?: "job" | "corpus" | "data";
  collection?: string;
  busy?: boolean;
}

export interface ChromaDocument {
  id: string;
  field: string;
  value: string;
  title: string;
  chunkCount: number;
}

export interface ChromaDocumentList {
  collectionId: string;
  total: number;
  chunkTotal: number;
  q: string;
  items: ChromaDocument[];
  writable: boolean;
}

export interface ChromaChunk {
  id: string;
  document: string;
  preview: string;
  metadata: Record<string, unknown>;
  writable?: boolean | null;
  previewBbox?: number[] | null;
  previewLabel?: string;
  extractWarning?: string;
  textUpdated?: boolean | null;
}

export interface ChromaChunkList {
  collectionId: string;
  total: number;
  filteredTotal: number;
  offset: number;
  limit: number;
  q: string;
  pageNumber?: number | null;
  items: ChromaChunk[];
  writable: boolean;
}

export interface ChromaDocumentPages {
  collectionId: string;
  pages: number[];
  pageCount: number;
  pdfAvailable: boolean;
  pdfName: string;
  sourceKind?: string;
  previewError?: string;
  bboxDpi: number;
  renderDpi: number;
}

export async function fetchChromaStatus(): Promise<ChromaStatus> {
  const res = await fetch(`${API_BASE}/api/docs/chroma/status`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchChromaCollections(): Promise<ChromaCollectionInfo[]> {
  const res = await fetch(`${API_BASE}/api/docs/chroma/collections`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchChromaDocuments(
  collectionId: string,
  opts: { q?: string } = {},
): Promise<ChromaDocumentList> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  const qs = params.toString();
  const res = await fetch(
    `${API_BASE}/api/docs/chroma/collections/${encodeURIComponent(collectionId)}/documents${qs ? `?${qs}` : ""}`,
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchChromaChunks(
  collectionId: string,
  opts: {
    offset?: number;
    limit?: number;
    q?: string;
    docField?: string;
    docValue?: string;
    pageNumber?: number | null;
  } = {},
): Promise<ChromaChunkList> {
  const params = new URLSearchParams();
  if (opts.offset != null) params.set("offset", String(opts.offset));
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.q) params.set("q", opts.q);
  if (opts.docField) {
    params.set("doc_field", opts.docField);
    params.set("doc_value", opts.docValue ?? "");
  }
  if (opts.pageNumber != null) params.set("page_number", String(opts.pageNumber));
  const qs = params.toString();
  const res = await fetch(
    `${API_BASE}/api/docs/chroma/collections/${encodeURIComponent(collectionId)}/chunks${qs ? `?${qs}` : ""}`,
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchChromaDocumentPages(
  collectionId: string,
  opts: { docField: string; docValue: string },
): Promise<ChromaDocumentPages> {
  const params = new URLSearchParams();
  params.set("doc_field", opts.docField);
  params.set("doc_value", opts.docValue);
  const res = await fetch(
    `${API_BASE}/api/docs/chroma/collections/${encodeURIComponent(collectionId)}/pages?${params}`,
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export function chromaPagePreviewUrl(
  collectionId: string,
  opts: { docField: string; docValue: string; page: number; dpi?: number },
): string {
  const params = new URLSearchParams();
  params.set("doc_field", opts.docField);
  params.set("doc_value", opts.docValue);
  params.set("page", String(opts.page));
  if (opts.dpi != null) params.set("dpi", String(opts.dpi));
  return `${API_BASE}/api/docs/chroma/collections/${encodeURIComponent(collectionId)}/page-preview?${params}`;
}

export async function fetchChromaChunk(
  collectionId: string,
  chunkId: string,
): Promise<ChromaChunk> {
  const res = await fetch(
    `${API_BASE}/api/docs/chroma/collections/${encodeURIComponent(collectionId)}/chunks/${encodeURIComponent(chunkId)}`,
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateChromaChunk(
  collectionId: string,
  chunkId: string,
  body: {
    document?: string;
    metadata?: Record<string, unknown>;
    bbox?: number[];
    reextract?: boolean;
  },
): Promise<ChromaChunk> {
  const res = await fetch(
    `${API_BASE}/api/docs/chroma/collections/${encodeURIComponent(collectionId)}/chunks/${encodeURIComponent(chunkId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function createChromaChunk(
  collectionId: string,
  body: {
    bbox: number[];
    type: string;
    pageNumber: number;
    templateMetadata?: Record<string, unknown>;
    document?: string;
  },
): Promise<ChromaChunk> {
  const res = await fetch(
    `${API_BASE}/api/docs/chroma/collections/${encodeURIComponent(collectionId)}/chunks`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function filenameFromDisposition(header: string, fallback: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  const plain = /filename="([^"]+)"/i.exec(header)?.[1];
  return decodeURIComponent(encoded || plain || fallback);
}

export async function downloadChromaCollectionParquets(
  collectionId: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/docs/chroma/collections/${encodeURIComponent(collectionId)}/parquets.zip`,
  );
  if (!res.ok) throw new Error(await readError(res));
  const blob = await res.blob();
  const filename = filenameFromDisposition(
    res.headers.get("content-disposition") ?? "",
    `${collectionId}_parquets.zip`,
  );
  saveBlob(blob, filename);
}

export async function downloadChromaDocumentParquet(
  collectionId: string,
  opts: { docField: string; docValue: string },
): Promise<void> {
  const params = new URLSearchParams();
  params.set("doc_field", opts.docField);
  params.set("doc_value", opts.docValue);
  const res = await fetch(
    `${API_BASE}/api/docs/chroma/collections/${encodeURIComponent(collectionId)}/parquet?${params}`,
  );
  if (!res.ok) throw new Error(await readError(res));
  const blob = await res.blob();
  const filename = filenameFromDisposition(
    res.headers.get("content-disposition") ?? "",
    "document.parquet",
  );
  saveBlob(blob, filename);
}

export async function deleteChromaDocument(
  collectionId: string,
  opts: { docField: string; docValue: string },
): Promise<{ ok: boolean; collectionId: string; deleted: number }> {
  const params = new URLSearchParams();
  params.set("doc_field", opts.docField);
  params.set("doc_value", opts.docValue);
  const res = await fetch(
    `${API_BASE}/api/docs/chroma/collections/${encodeURIComponent(collectionId)}/documents?${params}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteChromaChunk(
  collectionId: string,
  chunkId: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/docs/chroma/collections/${encodeURIComponent(collectionId)}/chunks/${encodeURIComponent(chunkId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await readError(res));
}

export async function clearChromaCollection(
  collectionId: string,
): Promise<{ ok: boolean; collectionId: string; deleted: number }> {
  const res = await fetch(
    `${API_BASE}/api/docs/chroma/collections/${encodeURIComponent(collectionId)}/chunks`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteChromaCollection(
  collectionId: string,
): Promise<{ ok: boolean; collectionId: string }> {
  const res = await fetch(
    `${API_BASE}/api/docs/chroma/collections/${encodeURIComponent(collectionId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
