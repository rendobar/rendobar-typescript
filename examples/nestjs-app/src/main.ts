// RENDOBAR_API_KEY=rb_... RENDOBAR_WEBHOOK_SECRET=whsec_... npm start
import "reflect-metadata";
import type { NestApplicationOptions } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

export async function createApp(options: Pick<NestApplicationOptions, "logger"> = {}): Promise<NestExpressApplication> {
  // rawBody: the webhook signature covers the exact bytes Rendobar sent.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { ...options, rawBody: true });
  // Rendobar sends JSON. Raise the JSON parser's 100 KB default for jobs with large output data.
  app.useBodyParser("json", { limit: "1mb" });
  return app;
}

if (require.main === module) {
  void createApp().then((app) => app.listen(Number(process.env["PORT"] ?? 3000)));
}
