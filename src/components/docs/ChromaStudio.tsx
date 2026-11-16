import { useCallback, useEffect, useRef, useState } from "react";
import { randomId } from "../../randomId";
import {
  chromaPagePreviewUrl,
  clearChromaCollection,
  createChromaChunk,
  deleteChromaChunk,
  deleteChromaCollection,
  deleteChromaDocument,
  downloadChromaCollectionParquets,
  downloadChromaDocumentParquet,
  fetchChromaChunks,
  fetchChromaCollections,
  fetchChromaDocumentPages,
  fetchChromaDocuments,
  fetchChromaStatus,
  updateChromaChunk,
  type ChromaChunk,
  type ChromaCollectionInfo,
  type ChromaDocument,
  type ChromaStatus,
} from "../../api/docs";
import {
  ChromaPagePreview,
  chunkBbox,
  chunkLabel,
  colorForLabel,
  formatBbox,
  parseBbox,
  queryChunkEl,
  scrollChildIntoNearest,
  sortChunksOnPage,
  type BBox,
} from "./ChromaPagePreview";
import { ETL_CHUNK_TYPES, ETL_TYPE_LABEL } from "./etlChunkTypes";

interface ChromaStudioProps {
  onClose?: () => void;
}

const PAGE_CHUNK_LIMIT = 200;

function metaToText(meta: Record<string, unknown>): string {
  try {
    return JSON.stringify(meta ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function parseMeta(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("metadata должен быть JSON-объектом");
  }
  return parsed as Record<string, unknown>;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function metaEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function metaStr(meta: Record<string, unknown> | undefined, key: string): string {
  const val = meta?.[key];
  if (val == null || val === "") return "";
  return String(val).trim();
}

function chunkChips(chunk: ChromaChunk): string[] {
  const meta = chunk.metadata ?? {};
  const chips: string[] = [];
  const page = metaStr(meta, "page_number");
  const section = metaStr(meta, "section_title");
  const type = metaStr(meta, "type_norm") || metaStr(meta, "type");
  if (page) chips.push(`стр. ${page}`);
  if (section) chips.push(section);
  if (type) chips.push(type);
  if (!chunkBbox(chunk)) chips.push("нет рамки");
  return chips;
}

function chunkHeadline(chunk: ChromaChunk): string {
  const chips = chunkChips(chunk);
  return chips[0] && chips[1] ? `${chips[0]} · ${chips[1]}` : chips[0] || "Чанк";
}

function isDraftId(id: string): boolean {
  return id.startsWith("draft:");
}

const CREATE_META_KEEP = [
  "bot_id",
  "version",
  "entity_type",
  "document_id",
  "document_path",
  "category",
  "section_title",
  "source_pages",
  "hierarchy_level",
  "is_hierarchy_heading",
  "section_element",
] as const;

function buildCreateMeta(
  sibling: ChromaChunk | undefined,
  selectedDoc: ChromaDocument | null,
  pageNumber: number,
  typeName: string,
  bbox: BBox,
): Record<string, unknown> {
  const src = sibling?.metadata ?? {};
  const meta: Record<string, unknown> = {};
  for (const key of CREATE_META_KEEP) {
    const val = src[key];
    if (val == null || val === "") continue;
    meta[key] = val;
  }
  if (selectedDoc) {
    if (selectedDoc.field === "document_id" && !meta.document_id) {
      meta.document_id = selectedDoc.value;
    }
    if (selectedDoc.field === "document_path" && !meta.document_path) {
      meta.document_path = selectedDoc.value;
    }
  }
  meta.entity_type = "element";
  meta.type = typeName;
  meta.type_norm = typeName.toLowerCase();
  meta.bbox = formatBbox(bbox);
  meta.page_number = pageNumber;
  return meta;
}

function etlTypeId(chunk: ChromaChunk): string {
  const label = chunkLabel(chunk);
  if (ETL_CHUNK_TYPES.some((item) => item.id === label)) return label;
  const found = ETL_CHUNK_TYPES.find(
    (item) => item.id.toLowerCase() === label.toLowerCase(),
  );
  return found?.id ?? "";
}

function withChunkType(chunk: ChromaChunk, typeName: string): ChromaChunk {
  return {
    ...chunk,
    previewLabel: typeName,
    metadata: {
      ...chunk.metadata,
      type: typeName,
      type_norm: typeName.toLowerCase(),
    },
  };
}

function TypePickerPanel({
  title,
  hint,
  selectedType,
  onPick,
  onCancel,
  onSave,
  saveDisabled,
  side = false,
}: {
  title: string;
  hint: string;
  selectedType?: string;
  onPick: (id: string) => void;
  onCancel: () => void;
  onSave?: () => void;
  saveDisabled?: boolean;
  side?: boolean;
}) {
  return (
    <div
      className={`chroma-type-picker${side ? " chroma-type-picker-side" : ""}`}
      role="dialog"
      aria-label={title}
    >
      <p className="chroma-type-picker-title">{title}</p>
      <p className="chroma-type-picker-hint">{hint}</p>
      <div className="chroma-type-picker-grid">
        {ETL_CHUNK_TYPES.map((item) => {
          const active = selectedType === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`chroma-type-picker-item${active ? " chroma-type-picker-item-active" : ""}`}
              aria-pressed={active}
              onClick={() => onPick(item.id)}
            >
              <span
                className="chroma-type-picker-swatch"
                style={{ background: colorForLabel(item.id) }}
                aria-hidden
              />
              <span className="chroma-type-picker-label">{item.label}</span>
              <span className="chroma-type-picker-id">{item.id}</span>
            </button>
          );
        })}
      </div>
      {onSave ? (
        <div className="chroma-type-picker-actions">
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={saveDisabled}
            onClick={onSave}
          >
            Сохранить
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={onCancel}>
            Отмена
          </button>
        </div>
      ) : (
        <button type="button" className="btn-ghost text-xs" onClick={onCancel}>
          Отмена
        </button>
      )}
    </div>
  );
}

function applyEditorFromChunk(
  chunk: ChromaChunk | null,
  setDoc: (v: string) => void,
  setMeta: (v: string) => void,
) {
  if (!chunk) {
    setDoc("");
    setMeta("{}");
    return;
  }
  setDoc(chunk.document);
  setMeta(metaToText(chunk.metadata));
}

type CollectionSource = NonNullable<ChromaCollectionInfo["source"]>;

const COLLECTION_GROUPS: { kind: CollectionSource; title: string }[] = [
  { kind: "job", title: "Прогоны" },
  { kind: "corpus", title: "База знаний" },
  { kind: "data", title: "Прежняя база" },
];

const SOURCE_TITLE: Record<CollectionSource, string> = {
  job: "прогон",
  corpus: "база знаний",
  data: "прежняя база",
};

function SidePanelIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </svg>
  );
}

export function ChromaStudio({ onClose }: ChromaStudioProps) {
  const [status, setStatus] = useState<ChromaStatus | null>(null);
  const [collections, setCollections] = useState<ChromaCollectionInfo[]>([]);
  const [collectionId, setCollectionId] = useState("");
  const [sideHidden, setSideHidden] = useState(false);
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [docQ, setDocQ] = useState("");
  const [docQDraft, setDocQDraft] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const [pageList, setPageList] = useState<number[]>([]);
  const [pageDraft, setPageDraft] = useState("");
  const [pdfAvailable, setPdfAvailable] = useState(false);
  const [sourceKind, setSourceKind] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [bboxDpi, setBboxDpi] = useState(300);
  const [renderDpi, setRenderDpi] = useState(144);
  const [total, setTotal] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [docs, setDocs] = useState<ChromaDocument[]>([]);
  const [docTotal, setDocTotal] = useState(0);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [items, setItems] = useState<ChromaChunk[]>([]);
  const [writable, setWritable] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [scrollNonce, setScrollNonce] = useState(0);
  const [focusOrigin, setFocusOrigin] = useState<"list" | "preview" | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editDoc, setEditDoc] = useState("");
  const [editMeta, setEditMeta] = useState("{}");
  const [editorPane, setEditorPane] = useState<"text" | "meta">("text");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bboxDirty, setBboxDirty] = useState<Record<string, BBox>>({});
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [pendingCreateIds, setPendingCreateIds] = useState<string[]>([]);
  const [createMode, setCreateMode] = useState(false);
  const [pendingPick, setPendingPick] = useState<{ bbox: BBox } | null>(null);
  const [pendingRetype, setPendingRetype] = useState<{
    chunkId: string;
    typeName: string;
  } | null>(null);
  const [typeDirty, setTypeDirty] = useState<Record<string, string>>({});
  const savedItemsRef = useRef<ChromaChunk[]>([]);

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const selectedDoc = docs.find((d) => d.id === selectedDocId) ?? null;
  const selectedChips = selected ? chunkChips(selected) : [];
  const selectedBbox = selected
    ? parseBbox(selected.previewBbox) ?? parseBbox(selected.metadata?.bbox)
    : null;
  const retypeChunk = pendingRetype
    ? items.find((item) => item.id === pendingRetype.chunkId) ?? null
    : null;
  const retypeSaveDisabled =
    busy ||
    !pendingRetype?.typeName ||
    !retypeChunk ||
    etlTypeId(retypeChunk) === pendingRetype.typeName;
  const typePanelOpen = Boolean(pendingPick || pendingRetype);
  const editorDirty =
    editorOpen &&
    selected != null &&
    (editDoc !== selected.document ||
      (() => {
        try {
          return !metaEqual(parseMeta(editMeta), selected.metadata ?? {});
        } catch {
          return true;
        }
      })());
  const retypeChanged = Boolean(
    pendingRetype &&
      (() => {
        const chunk = items.find((i) => i.id === pendingRetype.chunkId);
        return chunk ? etlTypeId(chunk) !== pendingRetype.typeName : false;
      })(),
  );
  const hasUnsaved =
    Object.keys(bboxDirty).length > 0 ||
    Object.keys(typeDirty).length > 0 ||
    pendingDeleteIds.length > 0 ||
    pendingCreateIds.length > 0 ||
    Boolean(editorDirty) ||
    Boolean(pendingPick) ||
    retypeChanged;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || focusOrigin === "list") return;
    const container = listRef.current;
    if (!container) return;
    const id = selectedId;
    const frame = requestAnimationFrame(() => {
      const target = queryChunkEl(container, id);
      if (!target) return;
      scrollChildIntoNearest(container, target);
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, scrollNonce, focusOrigin, items]);

  const refreshStatus = useCallback(async () => {
    const s = await fetchChromaStatus();
    setStatus(s);
    setWritable(s.writable);
    return s;
  }, []);

  const loadCollections = useCallback(async () => {
    const list = await fetchChromaCollections();
    setCollections(list);
    setCollectionId((prev) => {
      if (prev && list.some((c) => c.id === prev)) return prev;
      return list[0]?.id ?? "";
    });
    return list;
  }, []);

  const loadDocuments = useCallback(async (cid: string, query: string) => {
    if (!cid) {
      setDocs([]);
      setDocTotal(0);
      return [] as ChromaDocument[];
    }
    setLoading(true);
    setError(null);
    try {
      const page = await fetchChromaDocuments(cid, { q: query });
      setDocs(page.items);
      setDocTotal(page.total);
      setTotal(page.chunkTotal);
      setWritable(page.writable);
      return page.items;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить документы");
      setDocs([]);
      return [] as ChromaDocument[];
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChunks = useCallback(
    async (
      cid: string,
      pageNumber: number,
      query: string,
      doc: ChromaDocument | null,
      opts?: { syncEditor?: boolean },
    ) => {
      if (!cid || !doc) {
        setItems([]);
        savedItemsRef.current = [];
        setBboxDirty({});
        setTypeDirty({});
        setPendingDeleteIds([]);
        setPendingCreateIds([]);
        setCreateMode(false);
        setPendingPick(null);
        setPendingRetype(null);
        setFilteredTotal(0);
        return [] as ChromaChunk[];
      }
      setLoading(true);
      setError(null);
      try {
        const page = await fetchChromaChunks(cid, {
          offset: 0,
          limit: PAGE_CHUNK_LIMIT,
          q: query,
          docField: doc.field,
          docValue: doc.value,
          pageNumber,
        });
        const ordered = sortChunksOnPage(page.items);
        setItems(ordered);
        savedItemsRef.current = ordered;
        setBboxDirty({});
        setTypeDirty({});
        setPendingDeleteIds([]);
        setPendingCreateIds([]);
        setCreateMode(false);
        setPendingPick(null);
        setPendingRetype(null);
        setTotal(page.total);
        setFilteredTotal(page.filteredTotal);
        setWritable(page.writable);
        const prevId = selectedIdRef.current;
        const keepId =
          prevId && ordered.some((i) => i.id === prevId) ? prevId : null;
        setSelectedId(keepId);
        selectedIdRef.current = keepId;
        if (!keepId) {
          setEditorOpen(false);
          applyEditorFromChunk(null, setEditDoc, setEditMeta);
        } else if (opts?.syncEditor) {
          const chunk = ordered.find((i) => i.id === keepId) ?? null;
          applyEditorFromChunk(chunk, setEditDoc, setEditMeta);
        }
        return ordered;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить чанки");
        setItems([]);
        return [] as ChromaChunk[];
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const loadPages = useCallback(
    async (cid: string, doc: ChromaDocument | null) => {
      if (!cid || !doc) {
        setPageList([]);
        setPdfAvailable(false);
        setSourceKind("");
        setPreviewError("");
        setPreviewBusy(false);
        return [] as number[];
      }
      setPreviewBusy(true);
      try {
        const info = await fetchChromaDocumentPages(cid, {
          docField: doc.field,
          docValue: doc.value,
        });
        setPageList(info.pages);
        setPdfAvailable(info.pdfAvailable);
        setSourceKind(info.sourceKind || "");
        setPreviewError(info.previewError || "");
        setBboxDpi(info.bboxDpi || 300);
        setRenderDpi(info.renderDpi || 144);
        setCurrentPage((prev) =>
          info.pages.includes(prev) ? prev : (info.pages[0] ?? 0),
        );
        return info.pages;
      } catch {
        setPageList([]);
        setPdfAvailable(false);
        setSourceKind("");
        setPreviewError("");
        return [] as number[];
      } finally {
        setPreviewBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      try {
        await refreshStatus();
        await loadCollections();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось открыть Chroma");
      }
    })();
  }, [loadCollections, refreshStatus]);

  useEffect(() => {
    if (!collectionId) {
      setDocs([]);
      return;
    }
    void loadDocuments(collectionId, docQ);
  }, [collectionId, docQ, loadDocuments]);

  useEffect(() => {
    if (!collectionId || !selectedDocId) {
      setItems([]);
      setFilteredTotal(0);
      setPageList([]);
      setPdfAvailable(false);
      setSourceKind("");
      setPreviewError("");
      setPreviewBusy(false);
      return;
    }
    if (!selectedDoc) return;
    void loadPages(collectionId, selectedDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, selectedDocId, loadPages]);

  useEffect(() => {
    if (!collectionId || !selectedDocId || !selectedDoc) {
      return;
    }
    void loadChunks(collectionId, currentPage, q, selectedDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, selectedDocId, q, currentPage, loadChunks]);

  // Синхронизируем редактор только при смене выбранного id —
  // не при каждом refresh списка (иначе textarea metadata перетирается).
  useEffect(() => {
    setEditorPane("text");
    if (!selectedId) {
      applyEditorFromChunk(null, setEditDoc, setEditMeta);
      return;
    }
    const chunk = items.find((i) => i.id === selectedId);
    if (chunk) applyEditorFromChunk(chunk, setEditDoc, setEditMeta);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только смена выбора
  }, [selectedId]);

  // Poll writable while ETL may be running
  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshStatus().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

  const pageIndex = Math.max(0, pageList.indexOf(currentPage));
  const pageCount = pageList.length;
  const canPrev = pageIndex > 0;
  const canNext = pageIndex >= 0 && pageIndex < pageCount - 1;

  useEffect(() => {
    setPageDraft(pageCount ? String(pageIndex + 1) : "");
  }, [pageIndex, pageCount, selectedDocId]);
  const previewUrl =
    selectedDoc && collectionId && pdfAvailable
      ? chromaPagePreviewUrl(collectionId, {
          docField: selectedDoc.field,
          docValue: selectedDoc.value,
          page: currentPage,
          dpi: renderDpi,
        })
      : null;

  const goPage = (next: number) => {
    if (!pageList.includes(next)) return;
    if (hasUnsaved && !window.confirm("Есть несохранённые изменения. Уйти без сохранения?")) {
      return;
    }
    setBboxDirty({});
    setTypeDirty({});
    setPendingDeleteIds([]);
    setPendingCreateIds([]);
    setCreateMode(false);
    setPendingPick(null);
    setPendingRetype(null);
    setSelectedId(null);
    selectedIdRef.current = null;
    setEditorOpen(false);
    setCurrentPage(next);
  };

  const goOrdinal = (ordinal: number) => {
    if (!pageCount) return;
    const idx = Math.min(pageCount, Math.max(1, Math.trunc(ordinal))) - 1;
    const page = pageList[idx];
    if (page == null) return;
    goPage(page);
    setPageDraft(String(idx + 1));
  };

  const commitPageDraft = () => {
    const n = Number.parseInt(pageDraft.trim(), 10);
    if (!Number.isFinite(n)) {
      setPageDraft(pageCount ? String(pageIndex + 1) : "");
      return;
    }
    goOrdinal(n);
  };

  const selectOnPage = (chunk: ChromaChunk, origin: "list" | "preview" = "preview") => {
    setSelectedId(chunk.id);
    setFocusOrigin(origin);
    setScrollNonce((n) => n + 1);
    setEditorOpen(false);
    if (pendingRetype && pendingRetype.chunkId !== chunk.id) {
      setPendingRetype(null);
    }
  };

  const openChunk = (chunk: ChromaChunk) => {
    setSelectedId(chunk.id);
    setEditorOpen(true);
    setNotice(null);
    setError(null);
  };

  const applyBboxToChunk = (chunk: ChromaChunk, bbox: BBox): ChromaChunk => {
    const bboxStr = formatBbox(bbox);
    return {
      ...chunk,
      metadata: { ...chunk.metadata, bbox: bboxStr },
      previewBbox: bbox,
    };
  };

  const handleBboxCommit = (chunk: ChromaChunk, bbox: BBox) => {
    if (!writable) {
      setError("Сейчас нельзя писать в Chroma");
      return;
    }
    const prev = parseBbox(chunk.previewBbox) ?? parseBbox(chunk.metadata?.bbox);
    if (prev && prev.every((n, i) => Math.abs(n - bbox[i]) < 0.6)) return;
    const next = applyBboxToChunk(chunk, bbox);
    setBboxDirty((drafts) => ({ ...drafts, [chunk.id]: bbox }));
    setItems((list) => list.map((i) => (i.id === chunk.id ? next : i)));
    if (selectedIdRef.current === chunk.id) {
      setEditMeta((text) => {
        try {
          return metaToText({ ...parseMeta(text), bbox: next.metadata.bbox });
        } catch {
          return metaToText(next.metadata);
        }
      });
    }
    setError(null);
    setNotice("Изменения не сохранены — нажмите «Сохранить»");
  };

  const queueDelete = (chunkId: string) => {
    if (!writable || busy) return;
    const chunk = items.find((i) => i.id === chunkId);
    if (!chunk) return;
    if (isDraftId(chunkId)) {
      setPendingCreateIds((ids) => ids.filter((id) => id !== chunkId));
      setBboxDirty((drafts) => {
        if (!(chunkId in drafts)) return drafts;
        const next = { ...drafts };
        delete next[chunkId];
        return next;
      });
      setTypeDirty((drafts) => {
        if (!(chunkId in drafts)) return drafts;
        const next = { ...drafts };
        delete next[chunkId];
        return next;
      });
      setItems((list) => list.filter((i) => i.id !== chunkId));
      if (pendingRetype?.chunkId === chunkId) setPendingRetype(null);
      if (selectedIdRef.current === chunkId) {
        setSelectedId(null);
        selectedIdRef.current = null;
        setEditorOpen(false);
      }
      setError(null);
      setNotice("Новая рамка сброшена");
      return;
    }
    setPendingDeleteIds((ids) => (ids.includes(chunkId) ? ids : [...ids, chunkId]));
    setBboxDirty((drafts) => {
      if (!(chunkId in drafts)) return drafts;
      const next = { ...drafts };
      delete next[chunkId];
      return next;
    });
    setTypeDirty((drafts) => {
      if (!(chunkId in drafts)) return drafts;
      const next = { ...drafts };
      delete next[chunkId];
      return next;
    });
    setItems((list) => list.filter((i) => i.id !== chunkId));
    if (pendingRetype?.chunkId === chunkId) setPendingRetype(null);
    if (selectedIdRef.current === chunkId) {
      setSelectedId(null);
      selectedIdRef.current = null;
      setEditorOpen(false);
    }
    setError(null);
    setNotice("Рамка будет удалена после сохранения");
  };

  const discardDrafts = () => {
    setItems(savedItemsRef.current);
    setBboxDirty({});
    setTypeDirty({});
    setPendingDeleteIds([]);
    setPendingCreateIds([]);
    setCreateMode(false);
    setPendingPick(null);
    setPendingRetype(null);
    const keepId = selectedIdRef.current;
    const restored =
      keepId && savedItemsRef.current.some((i) => i.id === keepId)
        ? keepId
        : null;
    setSelectedId(restored);
    selectedIdRef.current = restored;
    const chunk = restored
      ? savedItemsRef.current.find((i) => i.id === restored) ?? null
      : null;
    applyEditorFromChunk(chunk, setEditDoc, setEditMeta);
    setError(null);
    setNotice("Изменения отменены");
  };

  const handleSave = () => {
    if (!collectionId || !writable) return;
    void (async () => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        if (pendingPick) {
          setNotice("Сначала выберите тип новой рамки");
          return;
        }
        if (pendingRetype) {
          setNotice("Сначала сохраните или отмените смену типа");
          return;
        }
        await refreshStatus();
        const deleteIds = pendingDeleteIds.filter((id) => !isDraftId(id));
        const createIds = pendingCreateIds.filter((id) => !deleteIds.includes(id));
        const bboxEntries = Object.entries(bboxDirty);
        let editorMeta: Record<string, unknown> | null = null;
        if (editorOpen && selected) {
          try {
            editorMeta = parseMeta(editMeta);
          } catch (err) {
            throw new Error(err instanceof Error ? err.message : "Неверный JSON metadata");
          }
        }
        const editorTextChanged =
          Boolean(editorOpen && selected && editDoc !== selected.document);
        const selectedIsDraft = Boolean(selected && isDraftId(selected.id));
        if (
          deleteIds.length === 0 &&
          createIds.length === 0 &&
          bboxEntries.length === 0 &&
          Object.keys(typeDirty).length === 0 &&
          editorOpen &&
          selected &&
          editorMeta &&
          !selectedIsDraft
        ) {
          const body: { document?: string; metadata?: Record<string, unknown> } = {};
          if (editorTextChanged) body.document = editDoc;
          if (!metaEqual(editorMeta, selected.metadata ?? {})) body.metadata = editorMeta;
          if (body.document == null && body.metadata == null) {
            setNotice("Нет изменений");
            return;
          }
          const updated = await updateChromaChunk(collectionId, selected.id, body);
          setNotice(
            body.document != null
              ? body.metadata != null
                ? "Сохранено (текст + metadata + re-embed)"
                : "Сохранено (текст + re-embed)"
              : "Сохранено (metadata)",
          );
          const merged = {
            ...selected,
            document: updated.document,
            preview: updated.preview,
            metadata: updated.metadata,
            previewBbox: parseBbox(updated.metadata?.bbox) ?? selected.previewBbox,
          };
          setItems((prev) => {
            const next = prev.map((i) => (i.id === updated.id ? { ...i, ...merged } : i));
            savedItemsRef.current = next;
            return next;
          });
          applyEditorFromChunk(updated, setEditDoc, setEditMeta);
          setTypeDirty({});
          await refreshStatus();
          return;
        }
        if (
          deleteIds.length === 0 &&
          createIds.length === 0 &&
          bboxEntries.length === 0 &&
          Object.keys(typeDirty).length === 0 &&
          !editorDirty
        ) {
          setNotice("Нет изменений");
          return;
        }
        for (const id of deleteIds) {
          await deleteChromaChunk(collectionId, id);
        }
        let textUpdates = 0;
        const warnings: string[] = [];
        let bboxUpdates = 0;
        for (const [id, bbox] of bboxEntries) {
          if (deleteIds.includes(id) || isDraftId(id)) continue;
          const chunk = items.find((i) => i.id === id);
          if (!chunk) continue;
          const isEditor = Boolean(editorOpen && selected && selected.id === id);
          const textChanged = isEditor && editorTextChanged;
          const metadata = {
            ...(isEditor && editorMeta ? editorMeta : chunk.metadata),
            bbox: formatBbox(bbox),
          };
          const updated = await updateChromaChunk(collectionId, id, {
            metadata,
            bbox,
            reextract: !textChanged,
            document: textChanged ? editDoc : undefined,
          });
          bboxUpdates += 1;
          if (updated.textUpdated) textUpdates += 1;
          if (updated.extractWarning) warnings.push(updated.extractWarning);
        }
        for (const id of createIds) {
          const chunk = items.find((i) => i.id === id);
          if (!chunk) continue;
          const bbox =
            bboxDirty[id] ??
            parseBbox(chunk.previewBbox) ??
            parseBbox(chunk.metadata?.bbox);
          if (!bbox) throw new Error("У новой рамки нет координат");
          const isEditor = Boolean(editorOpen && selected && selected.id === id);
          const textChanged = isEditor && editorTextChanged;
          const metadata: Record<string, unknown> = {
            ...(isEditor && editorMeta ? editorMeta : chunk.metadata),
            bbox: formatBbox(bbox),
          };
          const typeName = String(metadata["type"] || "Text");
          const pageNumber = Number(metadata["page_number"] ?? currentPage);
          const created = await createChromaChunk(collectionId, {
            bbox,
            type: typeName,
            pageNumber: Number.isFinite(pageNumber) ? pageNumber : currentPage,
            templateMetadata: metadata,
            document: textChanged ? editDoc : undefined,
          });
          if (created.textUpdated) textUpdates += 1;
          if (created.extractWarning) warnings.push(created.extractWarning);
        }
        let typeUpdates = 0;
        for (const id of Object.keys(typeDirty)) {
          if (deleteIds.includes(id) || isDraftId(id) || id in bboxDirty) continue;
          const isEditor = Boolean(
            editorOpen && selected && selected.id === id && editorMeta,
          );
          if (isEditor) continue;
          const chunk = items.find((i) => i.id === id);
          if (!chunk) continue;
          await updateChromaChunk(collectionId, id, { metadata: chunk.metadata });
          typeUpdates += 1;
        }
        if (
          editorOpen &&
          selected &&
          editorMeta &&
          !selectedIsDraft &&
          !bboxDirty[selected.id] &&
          !deleteIds.includes(selected.id)
        ) {
          const body: { document?: string; metadata?: Record<string, unknown> } = {};
          if (editorTextChanged) body.document = editDoc;
          if (!metaEqual(editorMeta, selected.metadata ?? {})) body.metadata = editorMeta;
          if (body.document != null || body.metadata != null) {
            await updateChromaChunk(collectionId, selected.id, body);
          }
        }
        setBboxDirty({});
        setTypeDirty({});
        setPendingDeleteIds([]);
        setPendingCreateIds([]);
        setCreateMode(false);
        setPendingPick(null);
        setPendingRetype(null);
        if (selectedDoc) {
          await loadChunks(collectionId, currentPage, q, selectedDoc, { syncEditor: true });
        }
        const parts: string[] = [];
        if (deleteIds.length) parts.push(`удалено ${deleteIds.length}`);
        if (createIds.length) parts.push(`создано ${createIds.length}`);
        if (bboxUpdates) parts.push(`рамок ${bboxUpdates}`);
        if (typeUpdates) parts.push(`типов ${typeUpdates}`);
        if (textUpdates) parts.push(`текст обновлён у ${textUpdates}`);
        setNotice(
          parts.length
            ? `Сохранено: ${parts.join(", ")}${warnings[0] ? `. ${warnings[0]}` : ""}`
            : "Сохранено",
        );
        await refreshStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось сохранить");
      } finally {
        setBusy(false);
      }
    })();
  };

  const handleDelete = () => {
    if (!selectedId) return;
    queueDelete(selectedId);
  };

  const confirmLeave = () => {
    if (!hasUnsaved) return true;
    if (!window.confirm("Есть несохранённые изменения. Уйти без сохранения?")) return false;
    setBboxDirty({});
    setTypeDirty({});
    setPendingDeleteIds([]);
    setPendingCreateIds([]);
    setCreateMode(false);
    setPendingPick(null);
    setPendingRetype(null);
    return true;
  };

  const handleCreateBbox = (bbox: BBox) => {
    if (!writable) {
      setError("Сейчас нельзя писать в Chroma");
      return;
    }
    setCreateMode(false);
    setPendingPick({ bbox });
    setPendingRetype(null);
    setNotice("Выберите тип блока");
  };

  const cancelPendingPick = () => {
    setPendingPick(null);
    setNotice(null);
  };

  const cancelPendingRetype = () => {
    setPendingRetype(null);
    setNotice(null);
  };

  const applyTypeLocally = (chunkId: string, typeName: string): ChromaChunk[] => {
    const nextItems = items.map((item) =>
      item.id === chunkId ? withChunkType(item, typeName) : item,
    );
    setItems(nextItems);
    if (selectedIdRef.current === chunkId) {
      const updated = nextItems.find((item) => item.id === chunkId);
      if (updated) {
        setEditMeta((text) => {
          try {
            return metaToText({
              ...parseMeta(text),
              type: typeName,
              type_norm: typeName.toLowerCase(),
            });
          } catch {
            return metaToText(updated.metadata);
          }
        });
      }
    }
    if (!isDraftId(chunkId)) {
      const original = savedItemsRef.current.find((item) => item.id === chunkId);
      const origType = original ? etlTypeId(original) : "";
      setTypeDirty((drafts) => {
        if (origType === typeName) {
          if (!(chunkId in drafts)) return drafts;
          const next = { ...drafts };
          delete next[chunkId];
          return next;
        }
        return { ...drafts, [chunkId]: typeName };
      });
    }
    return nextItems;
  };

  const handleRetype = (chunk: ChromaChunk) => {
    if (!writable || busy) return;
    setPendingPick(null);
    setCreateMode(false);
    setEditorOpen(false);
    setSelectedId(chunk.id);
    selectedIdRef.current = chunk.id;
    const current = etlTypeId(chunk) || "Text";
    setPendingRetype({ chunkId: chunk.id, typeName: current });
    setError(null);
    setNotice("Выберите новый тип блока");
  };

  const confirmRetypeSave = () => {
    if (!pendingRetype || !writable) return;
    const chunk = items.find((item) => item.id === pendingRetype.chunkId);
    if (!chunk) {
      setPendingRetype(null);
      return;
    }
    const typeName = pendingRetype.typeName;
    if (!typeName || etlTypeId(chunk) === typeName) {
      setPendingRetype(null);
      setNotice(null);
      return;
    }
    const nextItems = applyTypeLocally(chunk.id, typeName);
    const nextChunk =
      nextItems.find((item) => item.id === chunk.id) ?? withChunkType(chunk, typeName);
    setPendingRetype(null);
    if (isDraftId(chunk.id)) {
      setError(null);
      setNotice("Тип новой рамки обновлён — нажмите «Сохранить»");
      return;
    }
    const otherUnsaved =
      Object.keys(bboxDirty).length > 0 ||
      pendingDeleteIds.length > 0 ||
      pendingCreateIds.length > 0 ||
      Boolean(editorDirty);
    if (otherUnsaved) {
      setError(null);
      setNotice("Тип изменён — нажмите «Сохранить», чтобы записать все правки");
      return;
    }
    if (!collectionId) {
      setError("Коллекция не выбрана");
      return;
    }
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const updated = await updateChromaChunk(collectionId, chunk.id, {
          metadata: nextChunk.metadata,
        });
        const merged = {
          ...nextChunk,
          document: updated.document,
          preview: updated.preview,
          metadata: updated.metadata,
          previewLabel: typeName,
          previewBbox: parseBbox(updated.metadata?.bbox) ?? nextChunk.previewBbox,
        };
        setItems((prev) => {
          const list = prev.map((item) =>
            item.id === merged.id ? { ...item, ...merged } : item,
          );
          savedItemsRef.current = list;
          return list;
        });
        setTypeDirty((drafts) => {
          if (!(chunk.id in drafts)) return drafts;
          const next = { ...drafts };
          delete next[chunk.id];
          return next;
        });
        if (selectedIdRef.current === chunk.id) {
          applyEditorFromChunk(merged, setEditDoc, setEditMeta);
        }
        setNotice("Тип блока сохранён");
        await refreshStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось сменить тип");
      } finally {
        setBusy(false);
      }
    })();
  };

  const confirmCreateType = (typeName: string) => {
    if (!pendingPick) return;
    const bbox = pendingPick.bbox;
    const id = `draft:${randomId()}`;
    const sibling = items.find((item) => !isDraftId(item.id)) ?? items[0];
    const metadata = buildCreateMeta(sibling, selectedDoc, currentPage, typeName, bbox);
    const chunk: ChromaChunk = {
      id,
      document: "",
      preview: ETL_TYPE_LABEL[typeName] || typeName,
      metadata,
      previewBbox: bbox,
      previewLabel: typeName,
    };
    setItems((list) => [...list, chunk]);
    setPendingCreateIds((ids) => [...ids, id]);
    setBboxDirty((drafts) => ({ ...drafts, [id]: bbox }));
    setSelectedId(id);
    selectedIdRef.current = id;
    setPendingPick(null);
    setPendingRetype(null);
    setCreateMode(false);
    setEditorOpen(false);
    setError(null);
    setNotice("Новая рамка — нажмите «Сохранить», чтобы вырезать текст и записать в Chroma");
  };

  const toggleCreateMode = () => {
    if (!writable || busy) return;
    setPendingPick(null);
    setPendingRetype(null);
    const next = !createMode;
    setCreateMode(next);
    setNotice(next ? "Нарисуйте рамку на странице. Esc — отмена." : null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isTypingTarget(e.target)) return;
        if (pendingPick) {
          e.preventDefault();
          cancelPendingPick();
          return;
        }
        if (pendingRetype) {
          e.preventDefault();
          cancelPendingRetype();
          return;
        }
        if (createMode) {
          e.preventDefault();
          setCreateMode(false);
          setNotice(null);
        }
        return;
      }
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (isTypingTarget(e.target)) return;
      if (editorOpen || !writable || busy || !selectedId) return;
      e.preventDefault();
      queueDelete(selectedId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, createMode, editorOpen, pendingPick, pendingRetype, selectedId, writable, items]);

  const handleClearCollection = () => {
    if (!collectionId) return;
    const current = collections.find((c) => c.id === collectionId);
    const count = current?.count ?? total;
    const collectionName = current?.name || collectionId;
    const ok1 = window.confirm(
      `Внимание!\n\n` +
        `Вы собираетесь безвозвратно удалить ВСЕ чанки (${count}) ` +
        `из коллекции «${collectionName}».\n\n` +
        `Сама коллекция останется, но будет пустой. ` +
        `Восстановить данные будет нельзя.\n\n` +
        `Продолжить?`,
    );
    if (!ok1) return;
    const ok2 = window.confirm(
      `Подтвердите ещё раз:\n\n` +
        `Удалить все ${count} чанков из «${collectionName}» без возможности отмены?`,
    );
    if (!ok2) return;
    void (async () => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await clearChromaCollection(collectionId);
        setSelectedId(null);
        selectedIdRef.current = null;
        setEditorOpen(false);
        setSelectedDocId(null);
        setNotice(`Коллекция очищена: удалено ${res.deleted} чанков`);
        setCurrentPage(0);
        setPageList([]);
        setQ("");
        setQDraft("");
        setItems([]);
        await loadDocuments(collectionId, docQ);
        await loadCollections();
        await refreshStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось очистить коллекцию");
      } finally {
        setBusy(false);
      }
    })();
  };

  const handleDeleteCollection = () => {
    if (!collectionId) return;
    const current = collections.find((c) => c.id === collectionId);
    const count = current?.count ?? total;
    const collectionName = current?.name || collectionId;
    const ok1 = window.confirm(
      `Внимание!\n\n` +
        `Вы собираетесь безвозвратно удалить коллекцию «${collectionName}» ` +
        `из Chroma${count ? ` вместе с ${count} чанками` : ""}.\n\n` +
        `Это не то же самое, что «Очистить»: коллекция исчезнет из списка. ` +
        `Восстановить данные будет нельзя.\n\n` +
        `Продолжить?`,
    );
    if (!ok1) return;
    const ok2 = window.confirm(
      `Подтвердите ещё раз:\n\n` +
        `Удалить коллекцию «${collectionName}» из Chroma без возможности отмены?`,
    );
    if (!ok2) return;
    void (async () => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const removedId = collectionId;
        await deleteChromaCollection(removedId);
        setSelectedId(null);
        selectedIdRef.current = null;
        setEditorOpen(false);
        setSelectedDocId(null);
        setCurrentPage(0);
        setPageList([]);
        setPdfAvailable(false);
        setQ("");
        setQDraft("");
        setDocQ("");
        setDocQDraft("");
        setItems([]);
        setDocs([]);
        setDocTotal(0);
        setTotal(0);
        await loadCollections();
        await refreshStatus();
        setNotice(`Коллекция «${removedId}» удалена из Chroma`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось удалить коллекцию");
      } finally {
        setBusy(false);
      }
    })();
  };

  const [parquetBusy, setParquetBusy] = useState(false);

  const handleDownloadAllParquets = () => {
    if (!collectionId || parquetBusy || docs.length === 0) return;
    void (async () => {
      setParquetBusy(true);
      setError(null);
      try {
        await downloadChromaCollectionParquets(collectionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось скачать паркеты");
      } finally {
        setParquetBusy(false);
      }
    })();
  };

  const handleDownloadParquet = (doc: ChromaDocument) => {
    if (!collectionId || parquetBusy) return;
    void (async () => {
      setParquetBusy(true);
      setError(null);
      try {
        await downloadChromaDocumentParquet(collectionId, {
          docField: doc.field,
          docValue: doc.value,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось скачать parquet");
      } finally {
        setParquetBusy(false);
      }
    })();
  };

  const handleDeleteDocument = (doc: ChromaDocument) => {
    if (!collectionId || !writable || busy) return;
    if (!confirmLeave()) return;
    const count = doc.chunkCount;
    const ok = window.confirm(
      `Удалить документ «${doc.title}» и все его чанки` +
        `${count ? ` (${count})` : ""} из коллекции?\n\n` +
        `Коллекция останется, остальные документы не затронем. ` +
        `Восстановить будет нельзя.`,
    );
    if (!ok) return;
    void (async () => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await deleteChromaDocument(collectionId, {
          docField: doc.field,
          docValue: doc.value,
        });
        const wasSelected = selectedDocId === doc.id;
        if (wasSelected) {
          setSelectedDocId(null);
          setSelectedId(null);
          selectedIdRef.current = null;
          setEditorOpen(false);
          setItems([]);
          setCurrentPage(0);
          setPageList([]);
          setPdfAvailable(false);
          setQ("");
          setQDraft("");
          setBboxDirty({});
          setTypeDirty({});
          setPendingDeleteIds([]);
          setPendingCreateIds([]);
          setCreateMode(false);
          setPendingPick(null);
          setPendingRetype(null);
        }
        setNotice(
          `Документ «${doc.title}» удалён: ${res.deleted} ` +
            (res.deleted === 1 ? "чанк" : "чанков"),
        );
        await loadDocuments(collectionId, docQ);
        await loadCollections();
        await refreshStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось удалить документ");
      } finally {
        setBusy(false);
      }
    })();
  };

  const pickCollection = (id: string) => {
    if (id === collectionId || !confirmLeave()) return;
    setCollectionId(id);
    setCurrentPage(0);
    setPageList([]);
    setPdfAvailable(false);
    setSelectedId(null);
    setEditorOpen(false);
    setSelectedDocId(null);
    setItems([]);
    setQ("");
    setQDraft("");
    setDocQ("");
    setDocQDraft("");
  };

  const refreshAll = () => {
    if (!confirmLeave()) return;
    void (async () => {
      await loadCollections();
      await loadDocuments(collectionId, docQ);
      if (selectedDoc) {
        await loadPages(collectionId, selectedDoc);
        await loadChunks(collectionId, currentPage, q, selectedDoc, {
          syncEditor: true,
        });
      }
      await refreshStatus();
    })();
  };

  const activeCollection = collections.find((c) => c.id === collectionId) ?? null;
  const collectionGroups = COLLECTION_GROUPS.map((group) => ({
    ...group,
    items: collections.filter((c) => (c.source ?? "data") === group.kind),
  })).filter((group) => group.items.length > 0);

  const metaText = loading
    ? "Загрузка…"
    : !collectionId
      ? "Выберите коллекцию слева"
      : selectedDoc
        ? `стр. ${currentPage + 1}${pageCount ? ` из ${pageCount}` : ""} · чанков на странице: ${filteredTotal}` +
          (q ? ` (фильтр «${q}»)` : "")
        : `Документов: ${docTotal}` +
          (docQ ? ` (фильтр «${docQ}»)` : "") +
          (total ? ` · чанков: ${total}` : "");

  return (
    <section
      className={`chroma-studio chroma-am${sideHidden ? " chroma-am-side-hidden" : ""}`}
      aria-label="Chroma Studio"
    >
      <aside className="chroma-am-side" aria-label="Коллекции Chroma" hidden={sideHidden}>
        <div className="chroma-am-side-inner">
        <div className="chroma-am-side-top">
          <div className="chroma-am-brand">
            <b>Chroma Studio</b>
            <span>Документы и чанки индекса</span>
          </div>
          <button
            type="button"
            className="chroma-am-side-toggle"
            onClick={() => setSideHidden(true)}
            aria-label="Скрыть панель коллекций"
            title="Скрыть панель коллекций"
          >
            <SidePanelIcon />
          </button>
        </div>
        <div className="chroma-am-side-list">
          {collectionGroups.map((group) => (
            <div key={group.kind} className="chroma-am-group">
              <span className="chroma-am-label">{group.title}</span>
              <div className="chroma-am-jobs">
                {group.items.map((c) => {
                  const title = group.kind === "corpus" ? c.collection || c.name : c.name;
                  const sub = c.busy
                    ? "идёт прогон"
                    : c.collection && c.collection !== title && c.collection !== "job"
                      ? c.collection
                      : "";
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`chroma-am-job${c.id === collectionId ? " on" : ""}`}
                      aria-current={c.id === collectionId ? "true" : undefined}
                      onClick={() => pickCollection(c.id)}
                      title={c.name}
                    >
                      <i
                        className={`chroma-am-dot ${c.busy ? "run" : c.count > 0 ? "ok" : "stop"}`}
                        aria-hidden
                      />
                      <span className="chroma-am-job-text">
                        <b>{title}</b>
                        {sub && <small>{sub}</small>}
                      </span>
                      <span className="chroma-am-job-n">{c.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {collections.length === 0 && (
            <p className="chroma-am-side-empty">
              Коллекций нет. Запустите прогон в «Базе документов» — его индекс появится здесь.
            </p>
          )}
        </div>
        </div>
      </aside>

      <div className="chroma-am-main">
      <header className="chroma-am-top">
        {sideHidden && (
          <button
            type="button"
            className="chroma-am-side-toggle"
            onClick={() => setSideHidden(false)}
            aria-label="Показать панель коллекций"
            title="Показать панель коллекций"
          >
            <SidePanelIcon />
          </button>
        )}
        <div className="chroma-am-top-text">
          <h1 title={activeCollection?.collection}>
            {activeCollection?.name ?? "Chroma Studio"}
          </h1>
          <div className="chroma-am-meta">
            {activeCollection && (
              <span className="chroma-am-pill">
                {SOURCE_TITLE[activeCollection.source ?? "data"]}
              </span>
            )}
            {activeCollection && (
              <span className={`chroma-am-pill ${writable ? "ok" : "stop"}`}>
                {writable ? "можно править" : "только чтение"}
              </span>
            )}
            <span>{metaText}</span>
          </div>
        </div>
        <div className="chroma-am-actions">
          <button
            type="button"
            className="btn-danger chroma-studio-clear-btn"
            disabled={!collectionId || !writable || busy || total === 0}
            onClick={handleClearCollection}
            title="Удалить все чанки выбранной коллекции (саму коллекцию оставить)"
          >
            Очистить
          </button>
          <button
            type="button"
            className="btn-danger chroma-studio-clear-btn"
            disabled={!collectionId || !writable || busy}
            onClick={handleDeleteCollection}
            title="Удалить коллекцию из Chroma целиком"
          >
            Удалить
          </button>
          <button
            type="button"
            className="chroma-am-icon"
            disabled={loading}
            onClick={refreshAll}
            aria-label="Обновить"
            title="Перечитать коллекции, документы и чанки"
          >
            ⟳
          </button>
          {onClose && (
            <button
              type="button"
              className="btn-ghost"
              onClick={onClose}
              aria-label="Скрыть Chroma Studio"
            >
              Скрыть
            </button>
          )}
        </div>
      </header>

      {!writable && (
        <p className="chroma-studio-banner chroma-studio-banner-warn">
          Редактирование закрыто
          {status?.etlActiveJobId
            ? ` — идёт ETL (${status.etlActiveJobId})`
            : status?.writing
              ? " — идёт запись"
              : ""}
          . Можно смотреть список.
        </p>
      )}

      {error && <p className="etl-studio-err chroma-studio-msg">{error}</p>}
      {notice && <p className="etl-studio-ok chroma-studio-msg">{notice}</p>}

      <div className="chroma-am-card">
      <div className="chroma-studio-toolbar">
        <form
          className="chroma-studio-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (selectedDoc) {
              if (!confirmLeave()) return;
              setQ(qDraft.trim());
            } else {
              setDocQ(docQDraft.trim());
            }
          }}
        >
          <input
            type="search"
            className="input-field text-sm"
            placeholder={
              selectedDoc ? "Поиск по тексту чанка…" : "Поиск по названию документа…"
            }
            value={selectedDoc ? qDraft : docQDraft}
            onChange={(e) =>
              selectedDoc ? setQDraft(e.target.value) : setDocQDraft(e.target.value)
            }
            aria-label={selectedDoc ? "Поиск чанков" : "Поиск документов"}
          />
          <button type="submit" className="btn-ghost text-xs" disabled={!collectionId}>
            Найти
          </button>
          {(selectedDoc ? q : docQ) && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                if (selectedDoc) {
                  setQDraft("");
                  setQ("");
                } else {
                  setDocQDraft("");
                  setDocQ("");
                }
              }}
            >
              Сброс
            </button>
          )}
        </form>
      </div>

      <div
        className={`chroma-studio-grid ${selectedDoc ? "chroma-studio-grid-page" : ""}${
          selectedDoc && typePanelOpen ? " chroma-studio-grid-page-split" : ""
        }`}
      >
        <div className="chroma-studio-list-col">
          {selectedDoc ? (
            <div className="chroma-studio-doc-nav">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  if (!confirmLeave()) return;
                  setSelectedDocId(null);
                  setSelectedId(null);
                  setEditorOpen(false);
                  setItems([]);
                  setQ("");
                  setQDraft("");
                  setCurrentPage(0);
                  setPageList([]);
                  setPdfAvailable(false);
                }}
              >
                ← Документы
              </button>
              <p className="chroma-studio-doc-nav-title" title={selectedDoc.value}>
                {selectedDoc.title}
              </p>
              <button
                type="button"
                className="btn-danger text-xs chroma-studio-clear-btn"
                disabled={!writable || busy}
                onClick={() => handleDeleteDocument(selectedDoc)}
                title="Удалить все чанки этого документа"
              >
                Удалить документ
              </button>
            </div>
          ) : (
            <div className="chroma-studio-docs-head">
              <span className="chroma-am-label">Документы</span>
              <button
                type="button"
                className="btn-ghost text-xs chroma-studio-parquet-all"
                disabled={!collectionId || docs.length === 0 || parquetBusy}
                onClick={handleDownloadAllParquets}
              >
                {parquetBusy ? "Скачивание…" : "Скачать все паркеты"}
              </button>
            </div>
          )}

          <ul ref={listRef} className="chroma-studio-list">
            {!selectedDoc &&
              docs.map((doc) => (
                <li key={doc.id} className="chroma-studio-doc-row">
                  <button
                    type="button"
                    className="chroma-studio-item"
                    onClick={() => {
                      setSelectedDocId(doc.id);
                      setSelectedId(null);
                      setEditorOpen(false);
                      setCurrentPage(0);
                      setPageList([]);
                      setPdfAvailable(false);
                      setQ("");
                      setQDraft("");
                      setNotice(null);
                      setError(null);
                    }}
                  >
                    <span className="chroma-studio-item-preview">{doc.title}</span>
                    <span className="chroma-studio-item-id">
                      {doc.chunkCount}{" "}
                      {doc.chunkCount === 1 ? "чанк" : "чанков"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="chroma-studio-doc-download"
                    disabled={parquetBusy}
                    onClick={() => handleDownloadParquet(doc)}
                    title={`Скачать parquet «${doc.title}»`}
                    aria-label={`Скачать parquet ${doc.title}`}
                  >
                    📥
                  </button>
                  <button
                    type="button"
                    className="chroma-studio-doc-delete"
                    disabled={!writable || busy}
                    onClick={() => handleDeleteDocument(doc)}
                    title={`Удалить документ «${doc.title}»`}
                    aria-label={`Удалить документ ${doc.title}`}
                  >
                    🗑️
                  </button>
                </li>
              ))}
            {selectedDoc &&
              items.map((chunk) => {
                const chips = chunkChips(chunk);
                return (
                <li key={chunk.id} data-chunk-id={chunk.id}>
                  <button
                    type="button"
                    className={`chroma-studio-item ${selectedId === chunk.id ? "chroma-studio-item-active" : ""}`}
                    onClick={() => selectOnPage(chunk, "list")}
                    onDoubleClick={() => openChunk(chunk)}
                    title="Клик — выделить рамку, двойной клик — текст и свойства"
                  >
                    <span className="chroma-studio-item-kicker">
                      {isDraftId(chunk.id) ? "новая · " : ""}
                      {chunkHeadline(chunk)}
                    </span>
                    <span className="chroma-studio-item-preview">{chunk.preview || "—"}</span>
                    {chips.length > 2 && (
                      <span className="chroma-studio-item-id">{chips.slice(2).join(" · ")}</span>
                    )}
                  </button>
                </li>
                );
              })}
            {!loading && collectionId && !selectedDoc && docs.length === 0 && (
              <li className="docs-muted chroma-studio-empty">Документов нет</li>
            )}
            {!loading && collectionId && selectedDoc && items.length === 0 && (
              <li className="docs-muted chroma-studio-empty">
                На этой странице чанков нет
              </li>
            )}
          </ul>

          {selectedDoc && (
          <div className="chroma-studio-pager">
              <>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  disabled={!canPrev || loading || previewBusy}
                  onClick={() => goPage(pageList[pageIndex - 1])}
                >
                  ← Назад
                </button>
                <label className="chroma-studio-page-jump">
                  <span className="sr-only">Номер страницы</span>
                  <input
                    type="number"
                    className="input-field chroma-studio-page-jump-input"
                    min={1}
                    max={pageCount || 1}
                    step={1}
                    inputMode="numeric"
                    disabled={!pageCount || loading || previewBusy}
                    value={pageDraft}
                    onChange={(e) => setPageDraft(e.target.value)}
                    onBlur={commitPageDraft}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                    aria-label="Перейти на страницу"
                    title="Номер страницы, Enter — перейти"
                    style={{
                      width: `${Math.max(2.5, String(pageCount || 1).length + 1.2)}ch`,
                    }}
                  />
                  <span className="chroma-studio-page-pos">
                    / {pageCount || "—"}
                  </span>
                </label>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  disabled={!canNext || loading || previewBusy}
                  onClick={() => goPage(pageList[pageIndex + 1])}
                >
                  Дальше →
                </button>
              </>
          </div>
          )}
        </div>

        <div className="chroma-studio-editor-col">
          {selectedDoc && editorOpen && selected ? (
            <div className="chroma-chunk-card">
              <header className="chroma-chunk-card-head">
                <div className="chroma-chunk-chips">
                  {selectedChips.length ? (
                    selectedChips.map((chip) => (
                      <span key={chip} className="chroma-chunk-chip">
                        {chip}
                      </span>
                    ))
                  ) : (
                    <span className="chroma-chunk-chip">Чанк</span>
                  )}
                </div>
                <p className="chroma-studio-chunk-id" title={selected.id}>
                  {selected.id}
                </p>
              </header>

              <div className="chroma-chunk-tabs" role="tablist" aria-label="Поля чанка">
                <button
                  type="button"
                  role="tab"
                  aria-selected={editorPane === "text"}
                  className={`chroma-chunk-tab ${editorPane === "text" ? "chroma-chunk-tab-active" : ""}`}
                  onClick={() => setEditorPane("text")}
                >
                  Текст
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editorPane === "meta"}
                  className={`chroma-chunk-tab ${editorPane === "meta" ? "chroma-chunk-tab-active" : ""}`}
                  onClick={() => setEditorPane("meta")}
                >
                  Свойства
                </button>
              </div>

              {editorPane === "text" ? (
                <div className="chroma-chunk-pane">
                  <label className="sr-only" htmlFor="chroma-doc">
                    Текст чанка
                  </label>
                  <textarea
                    id="chroma-doc"
                    className="input-field chroma-studio-doc"
                    value={editDoc}
                    onChange={(e) => setEditDoc(e.target.value)}
                    disabled={!writable || busy}
                    rows={14}
                  />
                  <p className="etl-studio-hint">
                    Правка текста пересчитает embedding.
                  </p>
                </div>
              ) : (
                <div className="chroma-chunk-pane">
                  <label className="sr-only" htmlFor="chroma-meta">
                    Metadata JSON
                  </label>
                  <textarea
                    id="chroma-meta"
                    className="input-field chroma-studio-meta-json"
                    value={editMeta}
                    onChange={(e) => setEditMeta(e.target.value)}
                    disabled={!writable || busy}
                    rows={14}
                    spellCheck={false}
                  />
                  <p className="etl-studio-hint">Сырой JSON метаданных чанка.</p>
                </div>
              )}

              <div className="chroma-studio-actions">
                <button
                  type="button"
                  className="btn-ghost text-sm"
                  onClick={() => setEditorOpen(false)}
                >
                  ← К странице
                </button>
                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={!writable || busy || !hasUnsaved}
                  onClick={handleSave}
                >
                  {busy ? "Сохранение…" : "Сохранить"}
                </button>
                <button
                  type="button"
                  className="btn-ghost text-sm"
                  disabled={!writable || busy}
                  onClick={handleDelete}
                >
                  Удалить
                </button>
              </div>
            </div>
          ) : selectedDoc ? (
            <>
              <div className="chroma-bbox-edit-bar">
                <p
                  className="chroma-bbox-edit-bar-title"
                  title={selected?.id}
                >
                  {pendingPick
                    ? "Выберите тип блока"
                    : pendingRetype
                      ? "Сменить тип блока"
                      : createMode
                        ? "Нарисуйте рамку на странице"
                        : selected
                          ? chunkHeadline(selected)
                          : hasUnsaved
                            ? "Есть несохранённые изменения"
                            : "Страница документа"}
                  {selectedBbox && !pendingPick && !pendingRetype ? (
                    <span className="chroma-bbox-edit-bar-coords">
                      {formatBbox(selectedBbox)}
                    </span>
                  ) : null}
                </p>
                <div className="chroma-bbox-edit-bar-actions">
                  <button
                    type="button"
                    className={createMode ? "btn-primary text-xs" : "btn-ghost text-xs"}
                    disabled={!writable || busy || Boolean(pendingPick) || Boolean(pendingRetype) || !pdfAvailable || previewBusy}
                    onClick={toggleCreateMode}
                  >
                    {createMode ? "Рисуйте рамку…" : "Новая рамка"}
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    disabled={
                      !writable ||
                      busy ||
                      (pendingRetype ? retypeSaveDisabled : !hasUnsaved)
                    }
                    onClick={pendingRetype ? confirmRetypeSave : handleSave}
                  >
                    {busy ? "Сохранение…" : "Сохранить"}
                  </button>
                  {hasUnsaved ? (
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      disabled={busy}
                      onClick={discardDrafts}
                    >
                      Отменить
                    </button>
                  ) : null}
                  {selected && !pendingRetype ? (
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => setEditorOpen(true)}
                    >
                      Текст и свойства
                    </button>
                  ) : null}
                </div>
              </div>
              <div
                className={`chroma-studio-preview-row${
                  typePanelOpen ? " chroma-studio-preview-row-split" : ""
                }`}
              >
                <ChromaPagePreview
                  imageUrl={previewUrl}
                  pdfAvailable={pdfAvailable}
                  sourceKind={sourceKind}
                  previewError={previewError}
                  converting={previewBusy}
                  chunks={
                    pendingRetype
                      ? items.map((item) =>
                          item.id === pendingRetype.chunkId
                            ? withChunkType(item, pendingRetype.typeName)
                            : item,
                        )
                      : items
                  }
                  selectedId={selectedId}
                  scrollNonce={scrollNonce}
                  focusOrigin={focusOrigin}
                  bboxDpi={bboxDpi}
                  renderDpi={renderDpi}
                  writable={writable}
                  createMode={createMode}
                  ghostBbox={pendingPick?.bbox ?? null}
                  onSelect={selectOnPage}
                  onBboxCommit={handleBboxCommit}
                  onCreate={handleCreateBbox}
                  onRetype={handleRetype}
                />
                {pendingPick ? (
                  <TypePickerPanel
                    side
                    title="Что это за блок?"
                    hint="Выберите, чем является выделенный фрагмент. Типы те же, что ставит ETL: таблицу разберём по ячейкам, у картинки текст не берём."
                    onPick={confirmCreateType}
                    onCancel={cancelPendingPick}
                  />
                ) : pendingRetype ? (
                  <TypePickerPanel
                    side
                    title="Сменить тип блока"
                    hint="Выберите новый тип — рамка сразу перекрасится. «Сохранить» запишет тип в Chroma."
                    selectedType={pendingRetype.typeName}
                    onPick={(id) =>
                      setPendingRetype((prev) =>
                        prev ? { ...prev, typeName: id } : prev,
                      )
                    }
                    onCancel={cancelPendingRetype}
                    onSave={confirmRetypeSave}
                    saveDisabled={retypeSaveDisabled}
                  />
                ) : null}
              </div>
            </>
          ) : (
            <div className="chroma-studio-empty-editor">
              <p className="chroma-studio-empty-editor-title">Документ не выбран</p>
              <p className="docs-muted">
                Слева список документов коллекции. После выбора справа появится страница с bbox.
              </p>
            </div>
          )}
        </div>
      </div>
      </div>
      </div>
    </section>
  );
}
