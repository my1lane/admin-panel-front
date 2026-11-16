import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelEtlJob,
  createEtlCollection,
  deleteEtlCollection,
  fetchEtlCollections,
  fetchEtlJob,
  fetchEtlJobs,
  startEtlJob,
  type EtlCollectionInfo,
  type EtlJob,
  type EtlRunRequest,
} from "../../api/docs";
import type { DocFolder } from "../../types/agent";

interface EtlStudioProps {
  folders: DocFolder[];
  onClose?: () => void;
}

const DEFAULT_REQUEST: EtlRunRequest = {
  etlRunExtract: true,
  etlRunEnrich: true,
  etlRunIndex: true,
  etlRunContext: false,
  etlDocFolderIds: [],
  etlSkipBold: false,
  etlSkipHierarchy: false,
  etlSkipSummary: false,
  etlForce: false,
  etlKeepSourcePdf: true,
  etlCollection: "bot_it",
};

function statusClass(status: string): string {
  if (status === "ok") return "etl-studio-ok";
  if (status === "error" || status === "cancelled") return "etl-studio-err";
  if (status === "running" || status === "queued") return "etl-studio-busy";
  return "etl-studio-muted";
}

export function EtlStudio({ folders, onClose }: EtlStudioProps) {
  const [cfg, setCfg] = useState<EtlRunRequest>(DEFAULT_REQUEST);
  const [job, setJob] = useState<EtlJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [collections, setCollections] = useState<EtlCollectionInfo[]>([]);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionId, setNewCollectionId] = useState("");
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [folderQuery, setFolderQuery] = useState("");
  const logRef = useRef<HTMLPreElement>(null);

  const folderQueryNorm = folderQuery.trim().toLowerCase();
  const visibleFolders = folderQueryNorm
    ? folders.filter(
        (f) =>
          f.name.toLowerCase().includes(folderQueryNorm) ||
          f.id.toLowerCase().includes(folderQueryNorm),
      )
    : folders;

  const patch = (partial: Partial<EtlRunRequest>) =>
    setCfg((prev) => ({ ...prev, ...partial }));

  const toggleFolder = (id: string, on: boolean) => {
    setCfg((prev) => {
      const next = on
        ? [...prev.etlDocFolderIds.filter((x) => x !== id), id]
        : prev.etlDocFolderIds.filter((x) => x !== id);
      return { ...prev, etlDocFolderIds: next };
    });
  };

  const refreshJob = useCallback(async (jobId: string) => {
    const next = await fetchEtlJob(jobId);
    setJob(next);
    setError(null);
    return next;
  }, []);

  const loadCollections = useCallback(async () => {
    const list = await fetchEtlCollections();
    setCollections(list);
    setCfg((prev) => {
      if (list.some((c) => c.id === prev.etlCollection)) return prev;
      return { ...prev, etlCollection: list[0]?.id ?? "bot_it" };
    });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadCollections();
        const list = await fetchEtlJobs(5);
        const activeId = list.activeJobId;
        const pick =
          (activeId && list.jobs.find((j) => j.jobId === activeId)) || list.jobs[0];
        if (pick) {
          const full = await fetchEtlJob(pick.jobId);
          setJob(full);
        }
      } catch {
        /* studio optional on mount */
      }
    })();
  }, [loadCollections]);

  useEffect(() => {
    if (!job || (job.status !== "running" && job.status !== "queued")) return;
    const id = window.setInterval(() => {
      void refreshJob(job.jobId).catch((err) => {
        // Пока джоб на диске ещё пишется / backend перезапускается — не залипаем на 404
        const msg = err instanceof Error ? err.message : "Ошибка статуса ETL";
        if (/не найден/i.test(msg) || /NETWORK/i.test(msg)) return;
        setError(msg);
      });
    }, 2000);
    return () => window.clearInterval(id);
  }, [job?.jobId, job?.status, refreshJob]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [job?.logTail]);

  const running = job?.status === "running" || job?.status === "queued";

  const handleStart = () => {
    if (starting || running) return;
    if (cfg.etlRunExtract && cfg.etlDocFolderIds.length === 0) {
      setError("Выберите хотя бы одну папку с PDF/DOCX");
      return;
    }
    if (!cfg.etlRunExtract && !cfg.etlRunEnrich && !cfg.etlRunIndex && !cfg.etlRunContext) {
      setError("Включите хотя бы один шаг пайплайна");
      return;
    }
    void (async () => {
      setStarting(true);
      setError(null);
      try {
        const started = await startEtlJob(cfg);
        setJob(started);
        const full = await refreshJob(started.jobId);
        setJob(full);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось запустить ETL");
      } finally {
        setStarting(false);
      }
    })();
  };

  const handleCancel = () => {
    if (!job || !running) return;
    void (async () => {
      setError(null);
      try {
        const next = await cancelEtlJob(job.jobId);
        setJob(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось отменить");
      }
    })();
  };

  const handleCreateCollection = () => {
    const name = newCollectionName.trim();
    if (!name || collectionBusy) return;
    void (async () => {
      setCollectionBusy(true);
      setError(null);
      try {
        const created = await createEtlCollection({
          name,
          id: newCollectionId.trim() || undefined,
        });
        await loadCollections();
        patch({ etlCollection: created.id });
        setNewCollectionName("");
        setNewCollectionId("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось создать коллекцию");
      } finally {
        setCollectionBusy(false);
      }
    })();
  };

  const handleDeleteCollection = () => {
    const current = collections.find((c) => c.id === cfg.etlCollection);
    if (!current || current.builtin || collectionBusy) return;
    void (async () => {
      setCollectionBusy(true);
      setError(null);
      try {
        await deleteEtlCollection(current.id);
        await loadCollections();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось удалить коллекцию");
      } finally {
        setCollectionBusy(false);
      }
    })();
  };

  const selectedCollection = collections.find((c) => c.id === cfg.etlCollection);
  const jobLocksUi = starting || running;
  const indexStepOff = !(cfg.etlRunIndex || cfg.etlRunContext);

  return (
    <section className="etl-studio docs-panel" aria-label="ETL-студия">
      <div className="docs-panel-head">
        <div className="etl-studio-head-text">
          <h3 className="docs-panel-title">ETL → Chroma</h3>
        </div>
        {onClose && (
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            onClick={onClose}
            aria-label="Скрыть ETL Studio"
          >
            Скрыть
          </button>
        )}
      </div>

      <div className="etl-studio-grid">
        <div className="etl-studio-col">
          <p className="label-text">Папки документации (PDF / DOCX)</p>
          {folders.length === 0 ? (
            <p className="docs-muted">Сначала создайте папку и загрузите PDF/DOCX выше.</p>
          ) : (
            <div className="etl-studio-folders-wrap">
              <input
                type="search"
                className="input-field text-sm etl-studio-folders-search"
                placeholder="Найти папку…"
                value={folderQuery}
                onChange={(e) => setFolderQuery(e.target.value)}
                disabled={starting || running || !cfg.etlRunExtract}
                aria-label="Поиск папок документации"
              />
              {folderQueryNorm && (
                <p className="etl-studio-folders-meta">
                  {visibleFolders.length} из {folders.length}
                  {cfg.etlDocFolderIds.length > 0
                    ? ` · выбрано: ${cfg.etlDocFolderIds.length}`
                    : ""}
                </p>
              )}
              <div className="etl-studio-folders">
                {visibleFolders.length === 0 ? (
                  <p className="docs-muted">Ничего не найдено</p>
                ) : (
                  visibleFolders.map((folder) => (
                    <label key={folder.id} className="etl-studio-check">
                      <input
                        type="checkbox"
                        checked={cfg.etlDocFolderIds.includes(folder.id)}
                        onChange={(e) => toggleFolder(folder.id, e.target.checked)}
                        className="accent-control"
                        disabled={starting || running || !cfg.etlRunExtract}
                      />
                      <span className="label-text">{folder.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          <p className="label-text etl-studio-section">Пайплайн</p>
          {(
            [
              ["etlRunExtract", "1. Извлечение"],
              ["etlRunEnrich", "2. Обогащение"],
              ["etlRunIndex", "3. Индексация"],
              ["etlRunContext", "4. Contextual Retrieval (опц.)"],
            ] as const
          ).map(([key, title]) => (
            <label key={key} className="etl-studio-check">
              <input
                type="checkbox"
                checked={cfg[key]}
                onChange={(e) => patch({ [key]: e.target.checked })}
                className="accent-control"
                disabled={starting || running}
              />
              <span className="label-text">{title}</span>
            </label>
          ))}
        </div>

        <div className="etl-studio-col">
          <p className="label-text">Новая коллекция</p>
          <div className="etl-studio-new-collection">
            <input
              type="text"
              className="input-field text-sm"
              placeholder="Название (например, Кадры)"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              disabled={jobLocksUi || collectionBusy}
              onKeyDown={(e) => e.key === "Enter" && handleCreateCollection()}
            />
            <input
              type="text"
              className="input-field text-sm"
              placeholder="id (опц., bot_hr)"
              value={newCollectionId}
              onChange={(e) => setNewCollectionId(e.target.value)}
              disabled={jobLocksUi || collectionBusy}
              onKeyDown={(e) => e.key === "Enter" && handleCreateCollection()}
            />
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={jobLocksUi || collectionBusy || !newCollectionName.trim()}
              onClick={handleCreateCollection}
            >
              Добавить
            </button>
          </div>
          <p className="etl-studio-hint">
            id: латиница/цифры/_; без id — сгенерируется из названия. В Chroma
            коллекция появится при индексации.
          </p>

          <label className="label-text etl-studio-section" htmlFor="etl-collection">
            Коллекция Chroma
          </label>
          <div className="etl-studio-collection-row">
            <select
              id="etl-collection"
              className="input-field text-sm"
              value={cfg.etlCollection}
              onChange={(e) => patch({ etlCollection: e.target.value })}
              disabled={jobLocksUi || indexStepOff || collections.length === 0}
            >
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}
                  {c.name && c.name !== c.id ? ` — ${c.name}` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={
                jobLocksUi ||
                collectionBusy ||
                !selectedCollection ||
                selectedCollection.builtin
              }
              onClick={handleDeleteCollection}
              title={
                selectedCollection?.builtin
                  ? "Встроенную коллекцию нельзя удалить"
                  : "Удалить из реестра"
              }
            >
              Удалить
            </button>
          </div>

          <p className="label-text etl-studio-section">Разметка</p>
          {(
            [
              ["etlSkipBold", "Не помечать жирный текст"],
              ["etlSkipHierarchy", "Не разбирать разделы и ссылки"],
              ["etlSkipSummary", "Не писать краткое содержание"],
            ] as const
          ).map(([key, title]) => (
            <label key={key} className="etl-studio-check">
              <input
                type="checkbox"
                checked={cfg[key]}
                onChange={(e) => patch({ [key]: e.target.checked })}
                className="accent-control"
                disabled={starting || running || !cfg.etlRunEnrich}
              />
              <span className="label-text">{title}</span>
            </label>
          ))}

          <p className="label-text etl-studio-section">Повторный прогон</p>
          <label className="etl-studio-check">
            <input
              type="checkbox"
              checked={cfg.etlKeepSourcePdf}
              onChange={(e) => patch({ etlKeepSourcePdf: e.target.checked })}
              className="accent-control"
              disabled={starting || running || !cfg.etlRunExtract}
            />
            <span className="label-text">Оставить файлы после разбора</span>
          </label>
          <label className="etl-studio-check">
            <input
              type="checkbox"
              checked={cfg.etlForce}
              onChange={(e) => patch({ etlForce: e.target.checked })}
              className="accent-control"
              disabled={starting || running}
            />
            <span className="label-text">Пересчитать уже готовые файлы</span>
          </label>
        </div>
      </div>

      <div className="etl-studio-actions">
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={starting || running}
          onClick={handleStart}
        >
          {starting ? "Запуск…" : "Запустить ETL"}
        </button>
        <button
          type="button"
          className="btn-ghost text-sm"
          disabled={!running}
          onClick={handleCancel}
        >
          Отменить
        </button>
        {job && (
          <span className={`etl-studio-status ${statusClass(job.status)}`}>
            {job.status}
            {job.pdfCount > 0 ? ` · PDF: ${job.pdfCount}` : ""}
            {(job.docxCount ?? 0) > 0 ? ` · DOCX: ${job.docxCount}` : ""}
            {job.jobId ? ` · ${job.jobId}` : ""}
          </span>
        )}
      </div>

      {error && <p className="alert-error text-sm">{error}</p>}
      {job?.error && job.status !== "ok" && (
        <p className="alert-error text-sm">{job.error}</p>
      )}

      <pre ref={logRef} className="etl-studio-log" aria-label="Лог ETL">
        {job?.logTail?.trim() || "Лог появится после запуска…"}
      </pre>
    </section>
  );
}
