import type { ContentLanguage } from "~/lib/content-language";

interface ContentLanguageMenuProps {
  value: ContentLanguage;
  disabled?: boolean;
  onChange: (language: ContentLanguage) => void;
}

const languageOptions = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
] as const;

export function ContentLanguageMenu({
  value,
  disabled = false,
  onChange,
}: ContentLanguageMenuProps) {
  const selected =
    languageOptions.find((option) => option.value === value) ??
    languageOptions[1];

  return (
    <details className="group relative">
      <summary
        aria-label="内容语言"
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
        className={`flex list-none items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs transition focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:outline-none [&::-webkit-details-marker]:hidden ${
          disabled
            ? "cursor-wait opacity-50"
            : "cursor-pointer hover:border-slate-500"
        }`}
      >
        <span className="font-mono text-[10px] tracking-[0.12em] text-slate-500">
          内容语言
        </span>
        <span className="min-w-12 font-medium text-slate-200">
          {selected.label}
        </span>
        <span
          aria-hidden="true"
          className="text-[9px] text-slate-500 transition group-open:rotate-180"
        >
          ▼
        </span>
      </summary>
      <div className="absolute top-[calc(100%+0.45rem)] right-0 z-40 w-36 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-2xl shadow-black/50">
        {languageOptions.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                if (!active) onChange(option.value);
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                active
                  ? "bg-violet-400/10 text-violet-200"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {option.label}
              <span className="text-xs text-violet-300">
                {active ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </details>
  );
}
