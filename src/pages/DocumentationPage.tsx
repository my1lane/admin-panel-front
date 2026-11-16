import { useEffect, useState } from "react";
import { ChromaStudio } from "../components/docs/ChromaStudio";
import { useConstructorStore } from "../store/constructorStore";

type DocsView = "etl" | "chroma";

export function DocumentationPage() {
  const docsStudio = useConstructorStore((s) => s.docsStudio);
  const setDocsStudio = useConstructorStore((s) => s.setDocsStudio);
  const [docsView, setDocsView] = useState<DocsView>("etl");

  useEffect(() => {
    if (!docsStudio) return;
    setDocsView(docsStudio === "chroma" ? "chroma" : "etl");
    setDocsStudio(null);
  }, [docsStudio, setDocsStudio]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "adminpanel-open-chroma") setDocsView("chroma");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="docs-page docs-page-etl space-y-5">
      <header className="docs-page-header">
        <div className="docs-page-header-row">
          <h2 className="page-title">Документация</h2>
        </div>
      </header>

      {docsView === "chroma" ? (
        <div className="docs-etl-anchor">
          <ChromaStudio onClose={() => setDocsView("etl")} />
        </div>
      ) : (
        <iframe
          className="docs-etl-frame"
          src="/etl-ui/"
          title="База документов"
        />
      )}
    </div>
  );
}
