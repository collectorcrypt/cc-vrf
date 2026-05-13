import { useState } from "react";

export function CodeBlock({
  code,
  language = "ts",
}: {
  code: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <div className="absolute right-3 top-3 flex items-center gap-2">
        <span className="rounded bg-ink-800 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-400">
          {language}
        </span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="rounded bg-ink-800 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-300 hover:bg-ink-700 hover:text-ink-100"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="codeblock whitespace-pre">{code}</pre>
    </div>
  );
}
