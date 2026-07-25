"use client";

import { useRef, useState } from "react";
import { FileIcon, ImportIcon } from "@/components/ui/icons";
import { ACCEPTED_EXTENSIONS } from "@/lib/import/readWorkbook";

export function Dropzone({
  onFile,
  busy,
}: {
  onFile: (file: File) => void;
  busy?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) onFile(file);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
      className={`rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
        dragging ? "border-series-1 bg-wash" : "border-hairline-strong"
      }`}
    >
      <div className="mb-3 flex justify-center text-ink-muted">
        {busy ? <FileIcon size={28} /> : <ImportIcon size={28} />}
      </div>

      <p className="text-base font-semibold">
        {busy ? "Reading your file…" : "Drop a spreadsheet here"}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-secondary">
        {ACCEPTED_EXTENSIONS.join(", ")} up to 25 MB. It is read in this browser and never
        uploaded anywhere.
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-series-1 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-45"
      >
        Choose a file
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(",")}
        className="sr-only"
        onChange={(event) => {
          handleFiles(event.target.files);
          // Reset so choosing the same file twice still fires a change event.
          event.target.value = "";
        }}
      />
    </div>
  );
}
