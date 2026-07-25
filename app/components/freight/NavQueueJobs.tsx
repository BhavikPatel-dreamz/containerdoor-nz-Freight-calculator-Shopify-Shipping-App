type QueueJobStatus = {
  jobId: string;
  status: string;
  sent: number;
  failed: number;
  total: number;
};

type NavQueueJobsProps = {
  job: QueueJobStatus | null;
};

/** Top-bar queue chip for background bulk email / notify jobs. */
export function NavQueueJobs({ job }: NavQueueJobsProps) {
  if (!job) return null;

  const done = job.sent + job.failed;
  const label =
    job.status === "PENDING"
      ? "Queued…"
      : job.status === "PROCESSING"
        ? `Sending ${done}/${job.total}`
        : "Sending…";

  return (
    <div className="fo-nav-queue" title={`Bulk job ${job.jobId}`}>
      <span className="fo-nav-queue-dot" />
      <span className="fo-nav-queue-label">Queue</span>
      <span className="fo-nav-queue-status">{label}</span>
    </div>
  );
}
