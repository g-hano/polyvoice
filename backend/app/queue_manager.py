"""Queue manager for batch processing of multiple videos/playlists."""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
import threading
import traceback
import uuid
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import PipelineConfig
from .jobs import manager as job_manager
from .models import Job, JobStatus

logger = logging.getLogger(__name__)


class QueueStatus:
    """Status enum for batch queues."""

    pending = "pending"
    processing = "processing"
    done = "done"
    error = "error"


class QueueItem:
    """Single item in a batch queue."""

    def __init__(
        self,
        url: Optional[str] = None,
        upload_path: Optional[Path] = None,
        upload_name: Optional[str] = None,
        title: Optional[str] = None,
    ):
        self.url = url
        self.upload_path = upload_path
        self.upload_name = upload_name
        self.title = title or upload_name or url or "Untitled"
        self.job_id: Optional[str] = None
        self.status: str = QueueStatus.pending
        self.error: Optional[str] = None


class BatchQueue:
    """Represents a batch processing queue (playlist or multi-upload)."""

    def __init__(
        self,
        queue_id: str,
        config: PipelineConfig,
        items: List[QueueItem],
        queue_type: str = "playlist",  # "playlist" or "multi_upload"
        ref_audio_path: Optional[Path] = None,
    ):
        self.id = queue_id
        self.config = config
        self.items = items
        self.queue_type = queue_type
        self.ref_audio_path = ref_audio_path
        self.status: str = QueueStatus.pending
        self.progress: float = 0.0
        self.message: str = ""
        self.current_index: int = 0
        self.zip_filename: Optional[str] = None
        self.error: Optional[str] = None
        self.created_at: float = 0.0

    def to_dict(self) -> dict:
        """Serialize to dictionary."""
        return {
            "id": self.id,
            "queue_type": self.queue_type,
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "current_index": self.current_index,
            "total_items": len(self.items),
            "items": [
                {
                    "title": item.title,
                    "url": item.url,
                    "upload_name": item.upload_name,
                    "job_id": item.job_id,
                    "status": item.status,
                    "error": item.error,
                }
                for item in self.items
            ],
            "zip_filename": self.zip_filename,
            "error": self.error,
            "created_at": self.created_at,
        }


class QueueManager:
    """Manages batch processing queues."""

    def __init__(self) -> None:
        self._queues: Dict[str, BatchQueue] = {}
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._lock = threading.Lock()

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def queue_dir(self, queue_id: str) -> Path:
        """Get the directory for a queue."""
        from .config import settings

        return settings.jobs_dir / "queues" / queue_id

    def create_playlist_queue(
        self,
        playlist_url: str,
        config: PipelineConfig,
        ref_audio_path: Optional[Path] = None,
    ) -> BatchQueue:
        """Create a queue for processing a YouTube playlist."""
        queue_id = uuid.uuid4().hex[:12]

        # Extract playlist videos
        videos = self._extract_playlist_videos(playlist_url)
        if not videos:
            raise ValueError("No videos found in playlist")

        items = [QueueItem(url=video["url"], title=video["title"]) for video in videos]

        queue = BatchQueue(
            queue_id=queue_id,
            config=config,
            items=items,
            queue_type="playlist",
            ref_audio_path=ref_audio_path,
        )

        import time

        queue.created_at = time.time()

        with self._lock:
            self._queues[queue_id] = queue
            self._subscribers[queue_id] = []

        self.queue_dir(queue_id).mkdir(parents=True, exist_ok=True)
        self._persist(queue)

        return queue

    def create_multi_upload_queue(
        self,
        files: List[tuple[Path, str]],  # [(upload_path, filename), ...]
        config: PipelineConfig,
        ref_audio_path: Optional[Path] = None,
    ) -> BatchQueue:
        """Create a queue for processing multiple uploaded files."""
        queue_id = uuid.uuid4().hex[:12]

        items = [
            QueueItem(upload_path=upload_path, upload_name=filename)
            for upload_path, filename in files
        ]

        queue = BatchQueue(
            queue_id=queue_id,
            config=config,
            items=items,
            queue_type="multi_upload",
            ref_audio_path=ref_audio_path,
        )

        import time

        queue.created_at = time.time()

        with self._lock:
            self._queues[queue_id] = queue
            self._subscribers[queue_id] = []

        self.queue_dir(queue_id).mkdir(parents=True, exist_ok=True)
        self._persist(queue)

        return queue

    def _extract_playlist_videos(self, playlist_url: str) -> List[Dict[str, str]]:
        """Extract video URLs and titles from a YouTube playlist."""
        try:
            from yt_dlp import YoutubeDL
        except ImportError:
            raise ValueError("yt-dlp is not installed")

        ydl_opts = {
            "extract_flat": True,
            "quiet": True,
            "no_warnings": True,
        }

        logger.info("Extracting playlist: %s", playlist_url)

        try:
            with YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(playlist_url, download=False)

                if "entries" not in info:
                    raise ValueError("Not a valid playlist URL")

                videos = []
                for entry in info["entries"]:
                    if entry is None:
                        continue

                    video_url = (
                        entry.get("url")
                        or f"https://www.youtube.com/watch?v={entry['id']}"
                    )
                    title = entry.get("title", "Untitled")

                    videos.append(
                        {
                            "url": video_url,
                            "title": title,
                        }
                    )

                logger.info("Found %d videos in playlist", len(videos))
                return videos

        except Exception as exc:
            logger.exception("Failed to extract playlist")
            raise ValueError(f"Failed to extract playlist: {exc}")

    def get_queue(self, queue_id: str) -> Optional[BatchQueue]:
        """Get a queue by ID."""
        return self._queues.get(queue_id)

    def list_queues(self) -> List[Dict[str, Any]]:
        """List all queues."""
        from .config import settings

        queues_dir = settings.jobs_dir / "queues"
        if not queues_dir.exists():
            return []

        results: List[Dict[str, Any]] = []
        for entry in queues_dir.iterdir():
            if not entry.is_dir():
                continue

            queue_json = entry / "queue.json"
            if not queue_json.exists():
                continue

            try:
                data = json.loads(queue_json.read_text(encoding="utf-8"))
                results.append(data)
            except Exception:
                logger.exception("Failed to load queue %s", entry.name)

        results.sort(key=lambda x: x.get("created_at", 0), reverse=True)
        return results

    def delete_queue(self, queue_id: str) -> bool:
        """Delete a queue and all its jobs."""
        queue_dir = self.queue_dir(queue_id)
        if not queue_dir.exists():
            return False

        queue = self.get_queue(queue_id)
        if queue:
            # Delete all jobs in the queue
            for item in queue.items:
                if item.job_id:
                    job_manager.delete_job(item.job_id)

        with self._lock:
            self._queues.pop(queue_id, None)
            self._subscribers.pop(queue_id, None)

        shutil.rmtree(queue_dir)
        return True

    def start(self, queue: BatchQueue) -> None:
        """Start processing a queue."""
        thread = threading.Thread(
            target=self._process_queue,
            args=(queue,),
            daemon=True,
        )
        thread.start()

    def _process_queue(self, queue: BatchQueue) -> None:
        """Process all items in the queue sequentially."""
        try:
            queue.status = QueueStatus.processing
            queue.message = "Processing videos"
            self._emit(queue)

            for idx, item in enumerate(queue.items):
                queue.current_index = idx
                queue.progress = idx / len(queue.items)
                queue.message = (
                    f"Processing {item.title} ({idx + 1}/{len(queue.items)})"
                )
                self._emit(queue)

                try:
                    # Create and start job for this item
                    job = job_manager.create_job(
                        config=queue.config,
                        source_url=item.url,
                        media_filename=item.upload_name,
                    )
                    item.job_id = job.id
                    item.status = QueueStatus.processing
                    self._persist(queue)

                    # Start the job
                    job_manager.start(
                        job,
                        upload_path=item.upload_path,
                        upload_name=item.upload_name,
                        ref_audio_path=queue.ref_audio_path,
                    )

                    # Wait for job to complete
                    self._wait_for_job(job)

                    # Check job status
                    job = job_manager.get_job(job.id)
                    if job and job.status == JobStatus.done:
                        item.status = QueueStatus.done
                    else:
                        item.status = QueueStatus.error
                        item.error = job.error if job else "Job failed"

                except Exception as exc:
                    logger.exception("Failed to process queue item: %s", item.title)
                    item.status = QueueStatus.error
                    item.error = str(exc)

                self._persist(queue)

            # Create ZIP archive
            queue.message = "Creating ZIP archive"
            self._emit(queue)
            self._create_zip_archive(queue)

            queue.status = QueueStatus.done
            queue.progress = 1.0
            queue.message = "Completed"
            self._emit(queue)
            self._persist(queue)

        except Exception as exc:
            logger.exception("Queue processing failed: %s", queue.id)
            queue.status = QueueStatus.error
            queue.error = f"{exc}\n{traceback.format_exc()}"
            queue.message = str(exc)
            self._emit(queue)
            self._persist(queue)

    def _wait_for_job(self, job: Job, timeout: int = 3600) -> None:
        """Wait for a job to complete (blocking)."""
        import time

        start_time = time.time()

        while True:
            current_job = job_manager.get_job(job.id)
            if not current_job:
                raise RuntimeError(f"Job {job.id} not found")

            if current_job.status in (JobStatus.done, JobStatus.error):
                break

            if time.time() - start_time > timeout:
                raise RuntimeError(f"Job {job.id} timed out")

            time.sleep(1)

    def _create_zip_archive(self, queue: BatchQueue) -> None:
        """Create a ZIP archive with all processed outputs."""
        queue_dir = self.queue_dir(queue.id)
        zip_path = queue_dir / "output.zip"

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for idx, item in enumerate(queue.items):
                if item.status != QueueStatus.done or not item.job_id:
                    continue

                job = job_manager.get_job(item.job_id)
                if not job:
                    continue

                # Add the output file (dubbed or subtitled video)
                media_path = job_manager.media_path(job)
                if media_path.exists():
                    # Use a clean filename
                    safe_title = "".join(
                        c for c in item.title if c.isalnum() or c in (" ", "-", "_")
                    ).strip()[:100]
                    ext = media_path.suffix
                    archive_name = f"{idx + 1:03d}_{safe_title}{ext}"
                    zf.write(media_path, archive_name)

                # Add subtitles if available
                job_dir = job_manager.job_dir(item.job_id)
                srt_path = job_dir / "subtitles.srt"
                if srt_path.exists():
                    safe_title = "".join(
                        c for c in item.title if c.isalnum() or c in (" ", "-", "_")
                    ).strip()[:100]
                    archive_name = f"{idx + 1:03d}_{safe_title}.srt"
                    zf.write(srt_path, archive_name)

        queue.zip_filename = "output.zip"
        logger.info("Created ZIP archive: %s", zip_path)

    def _persist(self, queue: BatchQueue) -> None:
        """Save queue state to disk."""
        queue_path = self.queue_dir(queue.id) / "queue.json"
        queue_path.write_text(
            json.dumps(queue.to_dict(), indent=2),
            encoding="utf-8",
        )

    def subscribe(self, queue_id: str) -> asyncio.Queue:
        """Subscribe to queue progress updates."""
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.setdefault(queue_id, []).append(q)
        return q

    def unsubscribe(self, queue_id: str, q: asyncio.Queue) -> None:
        """Unsubscribe from queue progress."""
        subs = self._subscribers.get(queue_id, [])
        if q in subs:
            subs.remove(q)

    def _emit(self, queue: BatchQueue) -> None:
        """Emit queue progress to subscribers."""
        payload = {
            "queue_id": queue.id,
            "status": queue.status,
            "progress": round(queue.progress, 3),
            "message": queue.message,
            "current_index": queue.current_index,
            "total_items": len(queue.items),
        }

        loop = self._loop
        for q in list(self._subscribers.get(queue.id, [])):
            if loop is not None:
                loop.call_soon_threadsafe(q.put_nowait, payload)


queue_manager = QueueManager()
