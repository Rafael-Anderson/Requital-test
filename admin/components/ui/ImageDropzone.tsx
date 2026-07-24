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
}: {
  preview: string | null;
  onFileSelected: (file: File) => void;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) onFileSelected(file);
  }

  return (
    <div>
      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Image</label>
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
        className={`flex items-center gap-4 rounded-lg border border-dashed p-4 cursor-pointer transition-colors ${
          error
            ? "border-red-400 dark:border-red-700"
            : dragActive
              ? "border-black/40 dark:border-white/40 bg-black/5 dark:bg-white/5"
              : "border-black/20 dark:border-white/20 hover:border-black/35 dark:hover:border-white/35 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
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
            className="size-16 rounded-md object-cover border dark:border-white/10 shrink-0"
          />
        ) : (
          <div className="size-16 rounded-md bg-black/5 dark:bg-white/10 flex items-center justify-center text-zinc-400 shrink-0">
            <ImagePlus className="size-6" />
          </div>
        )}
        <div className="text-sm">
          <p className="font-medium">{preview ? "Change image" : "Upload an image"}</p>
          <p className="text-xs text-zinc-500">Drag and drop, or click to browse</p>
        </div>
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
