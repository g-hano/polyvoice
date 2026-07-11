import { useRef, useState, type DragEvent } from "react";
import { IconUpload, IconX } from "./Icons";

export default function MultiFileDropZone({
  accept,
  files,
  onFiles,
}: {
  accept: string;
  files: File[];
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) onFiles([...files, ...dropped]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0) onFiles([...files, ...selected]);
  };

  const removeFile = (index: number) => {
    onFiles(files.filter((_, i) => i !== index));
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 transition-all ${
          dragging
            ? "border-indigo-500/60 bg-indigo-500/5"
            : files.length > 0
              ? "border-indigo-500/40 bg-indigo-500/5"
              : "border-zinc-700 bg-zinc-950/50 hover:border-zinc-600 hover:bg-zinc-900/50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-zinc-800 text-zinc-400">
          <IconUpload className="h-5 w-5" />
        </span>
        {files.length > 0 ? (
          <>
            <p className="text-sm font-medium text-zinc-200">
              {files.length} {files.length === 1 ? "file" : "files"} selected
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Click to add more files
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-zinc-300">
              Drop multiple files here
            </p>
            <p className="mt-1 text-xs text-zinc-500">or click to browse</p>
          </>
        )}
      </div>

      {files.length > 0 && (
        <div className="mt-3 space-y-2">
          {files.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex items-center justify-between rounded-lg bg-zinc-900/50 px-3 py-2"
            >
              <div className="flex-1 overflow-hidden">
                <p className="truncate text-sm font-medium text-zinc-200">
                  {file.name}
                </p>
                <p className="text-xs text-zinc-500">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(index);
                }}
                className="ml-2 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
