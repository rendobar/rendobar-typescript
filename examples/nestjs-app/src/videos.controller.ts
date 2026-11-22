import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, UseFilters } from "@nestjs/common";
import { RendobarApiErrorFilter } from "@rendobar/nestjs";
import { VideosService, type JobStatus, type VideoFacts } from "./videos.service";

function urlFrom(body: unknown): string {
  if (typeof body === "object" && body !== null && "url" in body && typeof body.url === "string" && body.url !== "") return body.url;
  throw new BadRequestException('Send { "url": "<public video URL>" }');
}

// A Rendobar refusal (bad key, low credits, unknown job) answers 502 and is logged
// with its request id, instead of reaching the caller as Rendobar's own 401 or 402.
// The app turns the module-wide filter off and binds it here, on the one
// controller that calls Rendobar.
@Controller("videos")
@UseFilters(RendobarApiErrorFilter)
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Post("probe")
  @HttpCode(200)
  probe(@Body() body: unknown): Promise<VideoFacts> {
    return this.videos.probe(urlFrom(body));
  }

  @Get("jobs/:id")
  job(@Param("id") id: string): Promise<JobStatus> {
    return this.videos.status(id);
  }
}
