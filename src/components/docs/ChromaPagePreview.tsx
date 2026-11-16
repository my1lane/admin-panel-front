import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ChromaChunk } from "../../api/docs";

/** Цвета как в etl_v2/bbox_heron_compare.ipynb + доп. типы Heron */
const CLASS_COLORS: Record<string, string> = {
  Table: "rgb(255, 0, 0)",
  Text: "rgb(0, 170, 255)",
  "List-item": "rgb(0, 255, 0)",
  "Section-header": "rgb(255, 170, 0)",
  Title: "rgb(255, 0, 255)",
  Caption: "rgb(255, 200, 0)",
  Picture: "rgb(160, 80, 255)",
  "Page-header": "rgb(110, 110, 110)",
  "Page-footer": "rgb(130, 130, 130)",
  Footnote: "rgb(90, 160, 90)",
  Formula: "rgb(0, 200, 180)",
  "Document Index": "rgb(0, 90, 200)",
  Code: "rgb(80, 80, 200)",
  Form: "rgb(200, 120, 0)",
  "Key-Value Region": "rgb(180, 0, 120)",
  "Checkbox-Selected": "rgb(40, 160, 80)",
  "Checkbox-Unselected": "rgb(140, 160, 140)",
};
const DEFAULT_COLOR = "rgb(180, 180, 180)";

const MIN_BOX = 8;
const DRAG_THRESHOLD = 4;
const DOUBLE_CLICK_MS = 400;

export function scrollChildIntoNearest(
  container: HTMLElement,
  target: Element,
  pad = 20,
) {
  const cr = container.getBoundingClientRect();
  const tr = target.getBoundingClientRect();
  let dy = 0;
  if (tr.top < cr.top + pad) dy = tr.top - cr.top - pad;
  else if (tr.bottom > cr.bottom - pad) dy = tr.bottom - cr.bottom + pad;
  if (Math.abs(dy) < 1) return;
  container.scrollTo({ top: container.scrollTop + dy, behavior: "smooth" });
}

export function queryChunkEl(root: ParentNode, id: string): Element | null {
  if (!id) return null;
  try {
    return root.querySelector(`[data-chunk-id="${CSS.escape(id)}"]`);
  } catch {
    return null;
  }
}

export type BBox = [number, number, number, number];

type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type Rect = { x: number; y: number; w: number; h: number };

function finiteBox(nums: number[]): BBox | null {
  if (nums.length !== 4 || !nums.every((n) => Number.isFinite(n))) return null;
  const [x0, y0, x1, y1] = nums;
  // DOCX ETL пишет «0 0 0 0» — это не layout, иначе рамка 1×1 в углу.
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return [x0, y0, x1, y1];
}

export function parseBbox(raw: unknown): BBox | null {
  if (raw == null || raw === "") return null;
  if (Array.isArray(raw) && raw.length === 4) {
    return finiteBox(raw.map(Number));
  }
  const text = String(raw).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text.replace(/'/g, '"')) as unknown;
    if (Array.isArray(parsed) && parsed.length === 4) {
      return finiteBox(parsed.map(Number));
    }
  } catch {
    /* not JSON */
  }
  const parts = text.replace(/[[\]()]/g, "").split(/[,\s]+/).filter(Boolean);
  if (parts.length !== 4) return null;
  return finiteBox(parts.map(Number));
}

/** Как в ETL: четыре числа через пробел. */
export function formatBbox(box: BBox): string {
  return box
    .map((n) => {
      const r = Math.round(n * 10) / 10;
      return Number.isInteger(r) ? String(r) : r.toFixed(1);
    })
    .join(" ");
}

export function bboxesClose(a: BBox, b: BBox, eps = 0.6): boolean {
  return a.every((n, i) => Math.abs(n - b[i]) <= eps);
}

const TYPE_ALIAS: Record<string, string> = {
  table: "Table",
  text: "Text",
  title: "Title",
  list: "List-item",
  "list-item": "List-item",
  "section-header": "Section-header",
  caption: "Caption",
  picture: "Picture",
  "page-header": "Page-header",
  "page-footer": "Page-footer",
  footnote: "Footnote",
  formula: "Formula",
  "document index": "Document Index",
  code: "Code",
  form: "Form",
  "key-value region": "Key-Value Region",
  "checkbox-selected": "Checkbox-Selected",
  "checkbox-unselected": "Checkbox-Unselected",
};

export function chunkLabel(chunk: ChromaChunk): string {
  const meta = chunk.metadata ?? {};
  const raw = String(chunk.previewLabel || meta.type_norm || meta.type || "").trim();
  if (!raw) return "блок";
  return TYPE_ALIAS[raw.toLowerCase()] || raw;
}

export function colorForLabel(label: string): string {
  return CLASS_COLORS[label] || DEFAULT_COLOR;
}

export function chunkBbox(chunk: ChromaChunk): BBox | null {
  return parseBbox(chunk.previewBbox) ?? parseBbox(chunk.metadata?.bbox);
}

export function sortChunksOnPage(chunks: ChromaChunk[]): ChromaChunk[] {
  return chunks
    .map((chunk, index) => ({ chunk, index }))
    .sort((a, b) => {
      const ba = chunkBbox(a.chunk);
      const bb = chunkBbox(b.chunk);
      if (ba && bb) {
        if (ba[1] !== bb[1]) return ba[1] - bb[1];
        if (ba[0] !== bb[0]) return ba[0] - bb[0];
        return a.index - b.index;
      }
      if (ba && !bb) return -1;
      if (!ba && bb) return 1;
      return a.index - b.index;
    })
    .map((row) => row.chunk);
}

interface ChromaPagePreviewProps {
  imageUrl: string | null;
  pdfAvailable: boolean;
  sourceKind?: string;
  previewError?: string;
  converting?: boolean;
  chunks: ChromaChunk[];
  selectedId: string | null;
  scrollNonce?: number;
  focusOrigin?: "list" | "preview" | null;
  bboxDpi: number;
  renderDpi: number;
  writable?: boolean;
  createMode?: boolean;
  ghostBbox?: BBox | null;
  onSelect: (chunk: ChromaChunk) => void;
  onBboxCommit?: (chunk: ChromaChunk, bbox: BBox) => void;
  onCreate?: (bbox: BBox) => void;
  onRetype?: (chunk: ChromaChunk) => void;
}

function fallbackNote(sourceKind: string, previewError: string, synthetic: boolean): string {
  if (previewError) return previewError;
  if (synthetic) {
    return "У чанков нет координат — страница поделена на полосы, клик открывает чанк.";
  }
  if (sourceKind === "docx") {
    return "Не удалось сконвертировать DOCX — показаны только bbox чанков этой страницы.";
  }
  return "Исходный PDF или DOCX не найден — показаны только bbox чанков этой страницы.";
}

type OverlayBox = {
  chunk: ChromaChunk;
  label: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  synthetic: boolean;
};

function clientToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return { x: 0, y: 0 };
  const vb = svg.viewBox.baseVal;
  const vw = vb.width || rect.width;
  const vh = vb.height || rect.height;
  return {
    x: ((clientX - rect.left) / rect.width) * vw,
    y: ((clientY - rect.top) / rect.height) * vh,
  };
}

function applyHandle(
  orig: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  bounds: { w: number; h: number },
): Rect {
  if (handle === "move") {
    const w = orig.w;
    const h = orig.h;
    return {
      x: Math.min(Math.max(0, orig.x + dx), Math.max(0, bounds.w - w)),
      y: Math.min(Math.max(0, orig.y + dy), Math.max(0, bounds.h - h)),
      w,
      h,
    };
  }
  let x0 = orig.x;
  let y0 = orig.y;
  let x1 = orig.x + orig.w;
  let y1 = orig.y + orig.h;
  if (handle.includes("n")) y0 += dy;
  if (handle.includes("s")) y1 += dy;
  if (handle.includes("w")) x0 += dx;
  if (handle.includes("e")) x1 += dx;
  x0 = Math.max(0, Math.min(x0, bounds.w));
  x1 = Math.max(0, Math.min(x1, bounds.w));
  y0 = Math.max(0, Math.min(y0, bounds.h));
  y1 = Math.max(0, Math.min(y1, bounds.h));
  if (x1 - x0 < MIN_BOX) {
    if (handle.includes("w")) x0 = Math.max(0, x1 - MIN_BOX);
    else x1 = Math.min(bounds.w, x0 + MIN_BOX);
  }
  if (y1 - y0 < MIN_BOX) {
    if (handle.includes("n")) y0 = Math.max(0, y1 - MIN_BOX);
    else y1 = Math.min(bounds.h, y0 + MIN_BOX);
  }
  return { x: x0, y: y0, w: Math.max(MIN_BOX, x1 - x0), h: Math.max(MIN_BOX, y1 - y0) };
}

function viewToBbox(rect: Rect, scale: number): BBox {
  const s = scale > 0 ? scale : 1;
  return [rect.x / s, rect.y / s, (rect.x + rect.w) / s, (rect.y + rect.h) / s];
}

function rectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
  bounds: { w: number; h: number },
): Rect {
  const x0 = Math.max(0, Math.min(a.x, b.x, bounds.w));
  const x1 = Math.max(0, Math.min(Math.max(a.x, b.x), bounds.w));
  const y0 = Math.max(0, Math.min(a.y, b.y, bounds.h));
  const y1 = Math.max(0, Math.min(Math.max(a.y, b.y), bounds.h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

const HANDLE_CURSORS: Record<Handle, string> = {
  move: "move",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

function handleLayout(box: Rect, size: number): { handle: Exclude<Handle, "move">; x: number; y: number }[] {
  const hs = size;
  const midX = box.x + box.w / 2 - hs / 2;
  const midY = box.y + box.h / 2 - hs / 2;
  return [
    { handle: "nw", x: box.x - hs / 2, y: box.y - hs / 2 },
    { handle: "n", x: midX, y: box.y - hs / 2 },
    { handle: "ne", x: box.x + box.w - hs / 2, y: box.y - hs / 2 },
    { handle: "e", x: box.x + box.w - hs / 2, y: midY },
    { handle: "se", x: box.x + box.w - hs / 2, y: box.y + box.h - hs / 2 },
    { handle: "s", x: midX, y: box.y + box.h - hs / 2 },
    { handle: "sw", x: box.x - hs / 2, y: box.y + box.h - hs / 2 },
    { handle: "w", x: box.x - hs / 2, y: midY },
  ];
}

type DragSession = {
  id: string;
  handle: Handle;
  start: { x: number; y: number };
  startClient: { x: number; y: number };
  orig: Rect;
  last: Rect;
  moved: boolean;
  chunk: ChromaChunk;
};

type CreateSession = {
  start: { x: number; y: number };
  last: Rect;
  moved: boolean;
};

function BboxOverlay({
  boxes,
  selectedId,
  overlayView,
  writable,
  scale,
  createMode,
  ghostBbox,
  onSelect,
  onBboxCommit,
  onCreate,
  onRetype,
}: {
  boxes: OverlayBox[];
  selectedId: string | null;
  overlayView: { w: number; h: number };
  writable: boolean;
  scale: number;
  createMode: boolean;
  ghostBbox: BBox | null;
  onSelect: (chunk: ChromaChunk) => void;
  onBboxCommit?: (chunk: ChromaChunk, bbox: BBox) => void;
  onCreate?: (bbox: BBox) => void;
  onRetype?: (chunk: ChromaChunk) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const createRef = useRef<CreateSession | null>(null);
  const boundsRef = useRef(overlayView);
  const scaleRef = useRef(scale);
  const commitRef = useRef(onBboxCommit);
  const selectRef = useRef(onSelect);
  const onCreateRef = useRef(onCreate);
  const onRetypeRef = useRef(onRetype);
  const lastClickRef = useRef<{ id: string; at: number } | null>(null);
  const unbindRef = useRef<(() => void) | null>(null);
  const [draft, setDraft] = useState<Rect & { id: string } | null>(null);
  const [createDraft, setCreateDraft] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState(false);

  boundsRef.current = overlayView;
  scaleRef.current = scale;
  commitRef.current = onBboxCommit;
  selectRef.current = onSelect;
  onCreateRef.current = onCreate;
  onRetypeRef.current = onRetype;

  const handleSize = Math.max(8, Math.min(16, Math.min(overlayView.w, overlayView.h) * 0.01));

  const displayBoxes = useMemo(() => {
    const mapped = !draft
      ? boxes
      : boxes.map((b) => (b.chunk.id === draft.id ? { ...b, ...draft } : b));
    if (!selectedId) return mapped;
    return [...mapped].sort((a, b) => {
      if (a.chunk.id === selectedId) return 1;
      if (b.chunk.id === selectedId) return -1;
      return 0;
    });
  }, [boxes, draft, selectedId]);

  const unbindDrag = () => {
    unbindRef.current?.();
    unbindRef.current = null;
  };

  const endDrag = (commit: boolean) => {
    unbindDrag();
    const session = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!session) {
      setDraft(null);
      return;
    }
    const next = session.last;
    selectRef.current(session.chunk);
    const save = commitRef.current;
    if (!commit || !session.moved || !save) {
      setDraft(null);
      return;
    }
    const bbox = viewToBbox(next, scaleRef.current);
    const prev =
      parseBbox(session.chunk.previewBbox) ?? parseBbox(session.chunk.metadata?.bbox);
    if (prev && bboxesClose(prev, bbox)) {
      setDraft(null);
      return;
    }
    save(session.chunk, bbox);
    setDraft(null);
  };

  const bindDrag = () => {
    unbindDrag();
    const onMove = (e: PointerEvent) => {
      const session = dragRef.current;
      const svg = svgRef.current;
      if (!session || !svg) return;
      if (e.cancelable) e.preventDefault();
      const clientDist = Math.hypot(
        e.clientX - session.startClient.x,
        e.clientY - session.startClient.y,
      );
      if (!session.moved && clientDist < DRAG_THRESHOLD) return;
      session.moved = true;
      const pt = clientToSvg(svg, e.clientX, e.clientY);
      const dx = pt.x - session.start.x;
      const dy = pt.y - session.start.y;
      const next = applyHandle(session.orig, session.handle, dx, dy, boundsRef.current);
      session.last = next;
      setDraft({ id: session.id, ...next });
    };
    const onUp = () => endDrag(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        endDrag(false);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: false, capture: true });
    window.addEventListener("pointerup", onUp, { capture: true });
    window.addEventListener("pointercancel", onUp, { capture: true });
    window.addEventListener("keydown", onKey);
    unbindRef.current = () => {
      window.removeEventListener("pointermove", onMove, { capture: true });
      window.removeEventListener("pointerup", onUp, { capture: true });
      window.removeEventListener("pointercancel", onUp, { capture: true });
      window.removeEventListener("keydown", onKey);
    };
  };

  const endCreate = (commit: boolean) => {
    unbindDrag();
    const session = createRef.current;
    createRef.current = null;
    setDragging(false);
    const rect = session?.last ?? null;
    setCreateDraft(null);
    if (!commit || !session?.moved || !rect) return;
    if (rect.w < MIN_BOX || rect.h < MIN_BOX) return;
    onCreateRef.current?.(viewToBbox(rect, scaleRef.current));
  };

  const bindCreate = () => {
    unbindDrag();
    const onMove = (e: PointerEvent) => {
      const session = createRef.current;
      const svg = svgRef.current;
      if (!session || !svg) return;
      if (e.cancelable) e.preventDefault();
      const pt = clientToSvg(svg, e.clientX, e.clientY);
      const clientDist = Math.hypot(pt.x - session.start.x, pt.y - session.start.y);
      if (!session.moved && clientDist < DRAG_THRESHOLD) return;
      session.moved = true;
      session.last = rectFromPoints(session.start, pt, boundsRef.current);
      setCreateDraft(session.last);
    };
    const onUp = () => endCreate(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        endCreate(false);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: false, capture: true });
    window.addEventListener("pointerup", onUp, { capture: true });
    window.addEventListener("pointercancel", onUp, { capture: true });
    window.addEventListener("keydown", onKey);
    unbindRef.current = () => {
      window.removeEventListener("pointermove", onMove, { capture: true });
      window.removeEventListener("pointerup", onUp, { capture: true });
      window.removeEventListener("pointercancel", onUp, { capture: true });
      window.removeEventListener("keydown", onKey);
    };
  };

  useEffect(() => {
    return () => {
      unbindRef.current?.();
      unbindRef.current = null;
    };
  }, []);

  const pointerDownCreate = (e: ReactPointerEvent<SVGElement>) => {
    if (e.button !== 0 || !createMode || !onCreate) return;
    e.preventDefault();
    e.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    const pt = clientToSvg(svg, e.clientX, e.clientY);
    const orig = { x: pt.x, y: pt.y, w: 0, h: 0 };
    createRef.current = { start: pt, last: orig, moved: false };
    bindCreate();
    setCreateDraft(orig);
    setDragging(true);
  };

  const pointerDown = (
    e: ReactPointerEvent<SVGElement>,
    box: OverlayBox,
    handle: Handle,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (createMode) return;
    const now = performance.now();
    const last = lastClickRef.current;
    const isDouble =
      handle === "move" &&
      last != null &&
      last.id === box.chunk.id &&
      now - last.at < DOUBLE_CLICK_MS;
    lastClickRef.current = { id: box.chunk.id, at: now };
    if (isDouble) {
      unbindDrag();
      dragRef.current = null;
      setDragging(false);
      setDraft(null);
      onSelect(box.chunk);
      onRetypeRef.current?.(box.chunk);
      return;
    }
    if (!writable || box.synthetic || !onBboxCommit) {
      onSelect(box.chunk);
      return;
    }
    const svg = svgRef.current;
    if (!svg) {
      onSelect(box.chunk);
      return;
    }
    const pt = clientToSvg(svg, e.clientX, e.clientY);
    const orig = { x: box.x, y: box.y, w: box.w, h: box.h };
    dragRef.current = {
      id: box.chunk.id,
      handle,
      start: pt,
      startClient: { x: e.clientX, y: e.clientY },
      orig,
      last: orig,
      moved: false,
      chunk: box.chunk,
    };
    bindDrag();
    setDraft({ id: box.chunk.id, ...orig });
    setDragging(true);
  };

  const ghostRect = ghostBbox
    ? {
        x: ghostBbox[0] * scale,
        y: ghostBbox[1] * scale,
        w: Math.max(1, (ghostBbox[2] - ghostBbox[0]) * scale),
        h: Math.max(1, (ghostBbox[3] - ghostBbox[1]) * scale),
      }
    : null;
  const overlayClass = [
    "chroma-page-overlay",
    dragging ? "chroma-page-overlay-drag" : "",
    createMode ? "chroma-page-overlay-create" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      ref={svgRef}
      className={overlayClass}
      viewBox={`0 0 ${overlayView.w} ${overlayView.h}`}
      preserveAspectRatio="none"
    >
      {displayBoxes.map((box) => {
        const active = box.chunk.id === selectedId;
        const isDraft = box.chunk.id.startsWith("draft:");
        const canEdit = writable && !box.synthetic && Boolean(onBboxCommit) && !createMode;
        const boxHandle = Math.min(handleSize, Math.max(6, Math.min(box.w, box.h) * 0.22));
        return (
          <g key={box.chunk.id} data-chunk-id={box.chunk.id}>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              fill={box.color}
              fillOpacity={active ? 0.2 : box.synthetic ? 0.05 : 0.08}
              stroke={box.color}
              strokeWidth={active ? 4 : box.synthetic ? 1.5 : 2}
              strokeDasharray={
                isDraft || (box.synthetic && !active) ? "8 6" : undefined
              }
              pointerEvents={createMode ? "none" : "all"}
              className={`chroma-page-bbox${box.synthetic ? " chroma-page-bbox-synthetic" : ""}${
                canEdit ? " chroma-page-bbox-editable" : ""
              }`}
              role="button"
              tabIndex={0}
              aria-label={box.label}
              style={canEdit && active ? { cursor: "move" } : undefined}
              onPointerDown={(e) => pointerDown(e, box, "move")}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (createMode) return;
                unbindDrag();
                dragRef.current = null;
                setDragging(false);
                setDraft(null);
                onSelect(box.chunk);
                onRetypeRef.current?.(box.chunk);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(box.chunk);
                }
              }}
            >
              <title>
                {writable
                  ? `${box.label}. Двойной клик — сменить тип`
                  : box.label}
              </title>
            </rect>
            {(active || box.synthetic || isDraft) && (
              <text
                x={box.x + 8}
                y={Math.min(overlayView.h - 4, box.y + 16)}
                fill={box.color}
                className="chroma-page-bbox-label"
                pointerEvents="none"
              >
                {isDraft && !active ? `новая · ${box.label}` : box.label}
              </text>
            )}
            {active && canEdit
              ? handleLayout(box, boxHandle).map((h) => (
                  <rect
                    key={h.handle}
                    x={h.x}
                    y={h.y}
                    width={boxHandle}
                    height={boxHandle}
                    rx={1}
                    fill="#fff"
                    stroke={box.color}
                    strokeWidth={1.25}
                    pointerEvents="all"
                    className={`chroma-page-bbox-handle chroma-page-bbox-handle-${h.handle}`}
                    style={{ cursor: HANDLE_CURSORS[h.handle] }}
                    aria-label={`Изменить размер: ${h.handle}`}
                    onPointerDown={(e) => pointerDown(e, box, h.handle)}
                  />
                ))
              : null}
          </g>
        );
      })}
      {ghostRect ? (
        <rect
          x={ghostRect.x}
          y={ghostRect.y}
          width={ghostRect.w}
          height={ghostRect.h}
          className="chroma-page-create-draft"
          pointerEvents="none"
        />
      ) : null}
      {createDraft && createDraft.w > 0 && createDraft.h > 0 ? (
        <rect
          x={createDraft.x}
          y={createDraft.y}
          width={createDraft.w}
          height={createDraft.h}
          className="chroma-page-create-draft"
          pointerEvents="none"
        />
      ) : null}
      {createMode ? (
        <rect
          x={0}
          y={0}
          width={overlayView.w}
          height={overlayView.h}
          className="chroma-page-create-layer"
          fill="transparent"
          onPointerDown={pointerDownCreate}
        />
      ) : null}
    </svg>
  );
}

export function ChromaPagePreview({
  imageUrl,
  pdfAvailable,
  sourceKind = "",
  previewError = "",
  converting = false,
  chunks,
  selectedId,
  scrollNonce = 0,
  focusOrigin = null,
  bboxDpi,
  renderDpi,
  writable = false,
  createMode = false,
  ghostBbox = null,
  onSelect,
  onBboxCommit,
  onCreate,
  onRetype,
}: ChromaPagePreviewProps) {
  const scale = bboxDpi > 0 ? renderDpi / bboxDpi : 1;
  const layoutBoxes = useMemo(() => {
    const out: OverlayBox[] = [];
    for (const chunk of chunks) {
      const bbox = parseBbox(chunk.previewBbox) ?? parseBbox(chunk.metadata?.bbox);
      if (!bbox) continue;
      const [x0, y0, x1, y1] = bbox;
      const label = chunkLabel(chunk);
      out.push({
        chunk,
        label,
        color: colorForLabel(label),
        x: x0 * scale,
        y: y0 * scale,
        w: Math.max(1, (x1 - x0) * scale),
        h: Math.max(1, (y1 - y0) * scale),
        synthetic: false,
      });
    }
    return out;
  }, [chunks, scale]);

  const fallbackSize = useMemo(() => {
    if (layoutBoxes.length === 0) return { w: 800, h: 1100 };
    const maxX = Math.max(...layoutBoxes.map((b) => b.x + b.w), 1);
    const maxY = Math.max(...layoutBoxes.map((b) => b.y + b.h), 1);
    return { w: Math.ceil(maxX + 24), h: Math.ceil(maxY + 24) };
  }, [layoutBoxes]);

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);

  const syncNatural = (img: HTMLImageElement) => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    }
  };

  useEffect(() => {
    setImageFailed(false);
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      syncNatural(img);
    } else {
      setNatural(null);
    }
  }, [imageUrl]);

  const overlayView = natural ?? fallbackSize;
  const boxes = useMemo((): OverlayBox[] => {
    if (layoutBoxes.length > 0) return layoutBoxes;
    if (chunks.length === 0) return [];
    const n = chunks.length;
    const band = overlayView.h / n;
    return chunks.map((chunk, i) => {
      const label = chunkLabel(chunk);
      return {
        chunk,
        label,
        color: colorForLabel(label),
        x: 0,
        y: i * band,
        w: overlayView.w,
        h: Math.max(1, band),
        synthetic: true,
      };
    });
  }, [layoutBoxes, chunks, overlayView.h, overlayView.w]);
  const synthetic = boxes.length > 0 && boxes.every((b) => b.synthetic);
  const canEdit = writable && !synthetic && Boolean(onBboxCommit);
  const canCreate = writable && Boolean(onCreate) && Boolean(natural) && !synthetic;
  const creating = createMode && canCreate;

  const overlay = (
    <BboxOverlay
      boxes={boxes}
      selectedId={selectedId}
      overlayView={overlayView}
      writable={writable}
      scale={scale}
      createMode={creating}
      ghostBbox={ghostBbox ?? null}
      onSelect={onSelect}
      onBboxCommit={onBboxCommit}
      onCreate={onCreate}
      onRetype={onRetype}
    />
  );

  useEffect(() => {
    if (!selectedId || creating || focusOrigin === "preview") return;
    const container = previewScrollRef.current;
    if (!container) return;
    const id = selectedId;
    const frame = requestAnimationFrame(() => {
      const target = queryChunkEl(container, id);
      if (!target) return;
      scrollChildIntoNearest(container, target);
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, scrollNonce, focusOrigin, natural, converting, imageUrl, creating]);

  if (converting) {
    return (
      <div className="chroma-page-preview chroma-page-preview-fallback">
        <p className="chroma-page-preview-note">
          {sourceKind === "docx"
            ? "Конвертация DOCX через LibreOffice… первый раз может занять минуту."
            : "Готовим превью страницы…"}
        </p>
        <div
          className="chroma-page-stage"
          style={{ aspectRatio: `${fallbackSize.w} / ${fallbackSize.h}` }}
        >
          <svg
            className="chroma-page-fallback-canvas"
            viewBox={`0 0 ${fallbackSize.w} ${fallbackSize.h}`}
            preserveAspectRatio="xMidYMin meet"
          >
            <rect width="100%" height="100%" fill="#f8fafc" />
          </svg>
        </div>
      </div>
    );
  }

  if (!pdfAvailable || !imageUrl || imageFailed) {
    return (
      <div ref={previewScrollRef} className="chroma-page-preview chroma-page-preview-fallback">
        <p className="chroma-page-preview-note">
          {fallbackNote(sourceKind, previewError, synthetic)}
        </p>
        {canEdit ? (
          <p className="chroma-page-preview-note">
            Рамку можно двигать и тянуть за углы. Двойной клик — сменить тип.
            Backspace удаляет выбранную рамку. Сохранение — кнопкой «Сохранить».
          </p>
        ) : null}
        <div
          className="chroma-page-stage"
          style={{ aspectRatio: `${fallbackSize.w} / ${fallbackSize.h}` }}
        >
          <svg
            className="chroma-page-fallback-canvas"
            viewBox={`0 0 ${fallbackSize.w} ${fallbackSize.h}`}
            preserveAspectRatio="xMidYMin meet"
          >
            <rect width="100%" height="100%" fill="#f8fafc" />
          </svg>
          {overlay}
        </div>
      </div>
    );
  }

  return (
    <div ref={previewScrollRef} className="chroma-page-preview">
      {synthetic ? (
        <p className="chroma-page-preview-note">
          У DOCX нет координат блоков — клик по полосе на странице открывает чанк.
        </p>
      ) : creating ? (
        <p className="chroma-page-preview-note">
          Нарисуйте рамку на странице. Esc — отмена.
        </p>
      ) : canEdit ? (
        <p className="chroma-page-preview-note">
          Рамку можно двигать и тянуть за углы. Двойной клик — сменить тип.
          «Новая рамка» — добавить блок. Backspace удаляет выбранную. Сохранение —
          кнопкой «Сохранить».
        </p>
      ) : null}
      <div className="chroma-page-stage">
        <img
          ref={imgRef}
          className="chroma-page-image"
          src={imageUrl}
          alt="Страница документа"
          draggable={false}
          onLoad={(e) => syncNatural(e.currentTarget)}
          onError={() => setImageFailed(true)}
        />
        {natural ? overlay : null}
      </div>
    </div>
  );
}
