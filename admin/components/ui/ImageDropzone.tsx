"use client";

import { useRef, useState, type DragEvent } from "react";
import { ImagePlus } from "lucide-react";

// Dropzone concept (dashed border, centered icon/copy, drag state) inspired
// by @manuarora700's file-upload on 21st.dev
// (https://21st.dev/@manuarora700/components/file-upload) — rebuilt with
// plain Tailwind + native HTML5 drag-and-drop events rather than porting
// their framer-motion animated grid-hover background, to avoid adding an
// animation library dependency for a purely decorative effect.
export default function ImageDropzone({
  preview,
  onFileSelected,
  error,
  label = "Image",
  hint,
}: {
  preview: string | null;
  onFileSelected: (file: File) => void;
  error?: string;
  label?: string;
  // Recommended-size copy shown under the dropzone, e.g. "Recommended size:
  // 300 x 90 px (WxH)" — optional, backward-compatible with existing call sites.
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) onFileSelected(file);
  }

  return (
    <div>
      <label className="text-[13px] font-medium text-text-secondary dark:text-zinc-400 block mb-1.5">{label}</label>
      <div
        role="button"
        tabIndex={0}
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setDragActive(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        className={`flex items-center gap-4 rounded-xl border-[1.5px] border-dashed p-4 cursor-pointer transition-colors ${
          error
            ? "border-red-400 dark:border-red-700"
            : dragActive
              ? "border-accent-mid bg-[#FAFCFC] dark:bg-white/5"
              : "border-[#D3D8D7] dark:border-white/20 hover:border-accent-mid hover:bg-[#FAFCFC] dark:hover:bg-white/[0.03]"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt=""
            className="size-16 rounded-md object-cover border border-black/10 dark:border-white/10 shrink-0"
          />
        ) : (
          <div className="size-11 rounded-[10px] bg-neutral-chip-bg dark:bg-white/10 flex items-center justify-center text-text-faint shrink-0">
            <ImagePlus className="size-5" />
          </div>
        )}
        <div className="text-[13.5px]">
          <p className="font-semibold text-text-primary dark:text-zinc-100">{preview ? "Change image" : "Upload an image"}</p>
          <p className="text-[12.5px] text-text-faint">Drag and drop, or click to browse</p>
        </div>
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert" aria-live="polite">
          {error}
        </p>
      )}
      {hint && !error && <p className="mt-1.5 text-xs text-text-faint">{hint}</p>}
    </div>
  );
}
