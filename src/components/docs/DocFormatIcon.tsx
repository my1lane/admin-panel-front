const FORMATS: Record<string, { label: string; color: string }> = {
  pdf: { label: "PDF", color: "#D32F2F" },
  doc: { label: "WORD", color: "#2B579A" },
  docx: { label: "WORD", color: "#2B579A" },
  xls: { label: "XLS", color: "#217346" },
  xlsx: { label: "XLS", color: "#217346" },
  csv: { label: "CSV", color: "#217346" },
  ppt: { label: "PPT", color: "#C43E1C" },
  pptx: { label: "PPT", color: "#C43E1C" },
  txt: { label: "TXT", color: "#5C6B7A" },
  md: { label: "MD", color: "#5C6B7A" },
  json: { label: "JSON", color: "#B86E00" },
};

const FALLBACK = { label: "FILE", color: "#64748B" };

export function DocFormatIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const format = FORMATS[ext] ?? FALLBACK;
  const fontSize = format.label.length > 3 ? 6.2 : 8;

  return (
    <svg className="docs-format-icon" viewBox="0 0 32 36" aria-hidden>
      <path
        d="M7 1.5h13.2L28.5 9.8V32a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 32V4A2.5 2.5 0 0 1 7 1.5Z"
        fill="#fff"
        stroke="#D0D7E2"
      />
      <path d="M20.2 1.8V9.6H28.2" fill="#EEF2F6" stroke="#D0D7E2" />
      <rect x="4.5" y="22" width="23" height="12.5" rx="2" fill={format.color} />
      <text
        x="16"
        y="31.1"
        textAnchor="middle"
        fill="#fff"
        fontSize={fontSize}
        fontWeight="700"
        fontFamily="Inter, sans-serif"
      >
        {format.label}
      </text>
    </svg>
  );
}
