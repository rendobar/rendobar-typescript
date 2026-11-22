import { Injectable } from "@nestjs/common";
import { RendobarClient } from "@rendobar/nestjs";

/** What the probe endpoint answers: the facts an upload form needs about a video. */
export type VideoFacts = {
  jobId: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
};

export type JobStatus = { id: string; status: string };

@Injectable()
export class VideosService {
  // Injected by type: RendobarModule provides the SDK client under this class.
  constructor(private readonly rb: RendobarClient) {}

  /** Runs an ffprobe job and waits for it. `output.data` is typed as ffprobe's result. */
  async probe(url: string): Promise<VideoFacts> {
    const job = await this.rb.jobs.run({ type: "ffprobe", params: { command: url } });
    // run() throws JobFailedError on a failed or cancelled job, so this only guards the type.
    if (job.status !== "complete") throw new Error(`ffprobe job ${job.id} ended ${job.status}`);
    const summary = job.output.data.summary;
    const video = summary?.kind === "video" ? summary.video : null;
    return {
      jobId: job.id,
      durationSec: summary?.durationSec ?? null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      videoCodec: video?.codec ?? null,
    };
  }

  async status(id: string): Promise<JobStatus> {
    const job = await this.rb.jobs.get(id);
    return { id: job.id, status: job.status };
  }
}
