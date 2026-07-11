import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getQueue,
  subscribeQueueProgress,
  queueDownloadUrl,
  type QueueInfo,
} from "../api";
import Button from "./ui/Button";
import {
  IconDownload,
  IconArrowLeft,
  IconCheck,
  IconX,
  IconLoader,
} from "./ui/Icons";
import Badge from "./ui/Badge";

interface QueueViewProps {
  queueId: string;
  onBack?: () => void;
}

export default function QueueView({ queueId, onBack }: QueueViewProps) {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<QueueInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!queueId) return;

    // Load initial queue data
    getQueue(queueId)
      .then(setQueue)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    // Subscribe to progress updates
    const unsubscribe = subscribeQueueProgress(queueId, (event) => {
      setQueue((prev) =>
        prev
          ? {
              ...prev,
              status: event.status,
              progress: event.progress,
              message: event.message,
              current_index: event.current_index,
            }
          : prev,
      );

      // Reload full queue data when done
      if (event.status === "done" || event.status === "error") {
        getQueue(queueId).then(setQueue).catch(console.error);
      }
    });

    return unsubscribe;
  }, [queueId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <IconLoader className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error || !queue) {
    return (
      <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-6 text-center">
        <p className="text-sm text-zinc-400">{error || "Queue not found"}</p>
        {onBack && (
          <Button variant="secondary" onClick={onBack} className="mt-4">
            <IconArrowLeft className="h-4 w-4 mr-2" />
            {t("batchQueue.backToHome")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-zinc-100">
              {queue.queue_type === "playlist"
                ? t("batchQueue.viewTitle")
                : t("batchQueue.viewTitleUpload")}
            </h1>
            <Badge
              variant={
                queue.status === "done"
                  ? "success"
                  : queue.status === "error"
                    ? "error"
                    : "default"
              }
            >
              {queue.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            {t("batchQueue.videosProcessed", {
              current: queue.current_index + 1,
              total: queue.total_items,
            })}
          </p>
        </div>
        {onBack && (
          <Button variant="secondary" onClick={onBack} size="sm">
            <IconArrowLeft className="h-4 w-4 mr-2" />
            {t("batchQueue.back")}
          </Button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 p-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-zinc-300">
            {queue.message}
          </span>
          <span className="text-sm text-zinc-400">
            {Math.round(queue.progress * 100)}%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full transition-all duration-300 ${
              queue.status === "done"
                ? "bg-green-500"
                : queue.status === "error"
                  ? "bg-red-500"
                  : "bg-indigo-500"
            }`}
            style={{ width: `${queue.progress * 100}%` }}
          />
        </div>
      </div>

      {/* Download Button (if done) */}
      {queue.status === "done" && queue.zip_filename && (
        <a href={queueDownloadUrl(queue.id)} download>
          <Button variant="primary" size="lg" className="w-full">
            <IconDownload className="h-5 w-5 mr-2" />
            {t("batchQueue.downloadZip", { count: queue.total_items })}
          </Button>
        </a>
      )}

      {/* Error Message */}
      {queue.error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
          <p className="text-sm font-medium text-red-400">{t("batchQueue.errorTitle")}</p>
          <p className="mt-1 text-sm text-red-300/80">{queue.error}</p>
        </div>
      )}

      {/* Items List */}
      <div className="rounded-lg bg-zinc-900/50 border border-zinc-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-100">{t("batchQueue.queueItems")}</h2>
        </div>
        <div className="divide-y divide-zinc-800">
          {queue.items.map((item, index) => {
            const itemStatus = item.status;
            const isProcessing =
              queue.current_index === index && queue.status === "processing";

            return (
              <div
                key={index}
                className={`px-6 py-4 ${isProcessing ? "bg-indigo-500/5" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="flex-shrink-0 text-sm font-medium text-zinc-500">
                      {index + 1}.
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-200 truncate">
                        {item.title}
                      </p>
                      {item.error && (
                        <p className="mt-1 text-xs text-red-400">
                          {item.error}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {itemStatus === "done" && (
                      <span className="flex items-center gap-1 text-xs text-green-400">
                        <IconCheck className="h-4 w-4" />
                        {t("batchQueue.statusDone")}
                      </span>
                    )}
                    {itemStatus === "error" && (
                      <span className="flex items-center gap-1 text-xs text-red-400">
                        <IconX className="h-4 w-4" />
                        {t("batchQueue.statusFailed")}
                      </span>
                    )}
                    {itemStatus === "processing" && (
                      <span className="flex items-center gap-1 text-xs text-blue-400">
                        <IconLoader className="h-4 w-4 animate-spin" />
                        {t("batchQueue.statusProcessing")}
                      </span>
                    )}
                    {itemStatus === "pending" && (
                      <span className="text-xs text-zinc-500">{t("batchQueue.statusPending")}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
