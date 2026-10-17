import cors from "@fastify/cors";
import Fastify from "fastify";
import { snapshot } from "../atk/counter.js";
import { config } from "../config.js";
import { loadDeployment } from "../chain/client.js";
import { loadEvidence } from "../evidence/store.js";
import { allEvents, loadMeta, recentEvents, subscribe, watchFeedFile } from "../feed/store.js";

export type LoopStatus = Record<string, { enabled: boolean; lastRunAt?: string }>;

/** MIMARI §7.6 — agent HTTP API. */
export async function startServer(loops: LoopStatus) {
  const app = Fastify({ logger: false });
  const origins = config.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  await app.register(cors, { origin: origins });

  app.get("/health", async () => {
    let deployment: unknown = null;
    try {
      deployment = loadDeployment();
    } catch (e) {
      deployment = { error: (e as Error).message };
    }
    return { ok: true, deployment, dryRun: config.DRY_RUN, paused: config.PAUSE_AGENT, loops };
  });

  app.get<{ Querystring: { limit?: string } }>("/api/feed", async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 500);
    return recentEvents(limit);
  });

  app.get("/api/stream", (req, reply) => {
    reply.hijack();
    const origin = req.headers.origin;
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...(origin && origins.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    });
    reply.raw.write(": connected\n\n");
    const unsub = subscribe((e) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 20_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      unsub();
    });
  });

  app.get<{ Params: { id: string } }>("/api/markets/:id/meta", async (req, reply) => {
    const meta = loadMeta(req.params.id);
    if (!meta) return reply.code(404).send({ error: "meta bulunamadı" });
    return meta;
  });

  app.get<{ Params: { file: string } }>("/evidence/:file", async (req, reply) => {
    const id = req.params.file.replace(/\.json$/, "");
    if (!/^\d+$/.test(id)) return reply.code(400).send({ error: "geçersiz id" });
    const ev = await loadEvidence(BigInt(id));
    if (!ev) return reply.code(404).send({ error: "kanıt bulunamadı" });
    return ev;
  });

  app.get("/api/stats", async () => {
    const events = allEvents();
    const confirms = events.filter((e) => typeof e.confirmMs === "number").map((e) => e.confirmMs as number);
    const count = (t: string) => events.filter((e) => e.type === t).length;
    return {
      atk: snapshot(),
      markets: {
        created: count("market_created"),
        proposed: count("resolution_proposed"),
        finalized: count("finalized"),
        rejectedProposals: count("proposal_rejected"),
      },
      chain: {
        txCount: confirms.length,
        avgConfirmMs: confirms.length ? Math.round(confirms.reduce((a, b) => a + b, 0) / confirms.length) : null,
        minConfirmMs: confirms.length ? Math.min(...confirms) : null,
      },
    };
  });

  watchFeedFile();
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  console.log(`[server] http://localhost:${config.PORT}`);
  return app;
}
