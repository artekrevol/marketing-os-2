import express, { type Express, type RequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import healthRouter from "./routes/health";
import router from "./routes";
import { logger } from "./lib/logger";

const PgStore = ConnectPgSimple(session);

// Fail fast in production if the session secret is not configured —
// a hardcoded default would silently weaken session integrity.
const SESSION_SECRET = process.env["SESSION_SECRET"];
if (!SESSION_SECRET && process.env["NODE_ENV"] === "production") {
  throw new Error(
    "SESSION_SECRET environment variable is required in production",
  );
}
const sessionSecret = SESSION_SECRET ?? "dev-secret-change-in-prod";

const app: Express = express();

// Replit (and most PaaS hosts) terminate TLS at the reverse proxy and forward
// plain HTTP internally. Without this, Express sees req.secure = false and
// silently drops the Set-Cookie header for cookies marked secure: true.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Health check is registered before the session middleware so it always
// responds 200 regardless of session-store availability. This prevents
// provisioning health checks from failing during a cold deploy.
app.use("/api", healthRouter);

app.use(
  session({
    store: new PgStore({
      conString: process.env.DATABASE_URL,
      tableName: "session",
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use("/api", router);

/**
 * Serve the built ContentForge (insight-forge) and SEO OS frontends from
 * this same process/domain in production.
 *
 * Railway (unlike Replit) doesn't have a platform-level router that can
 * fan a single domain out to three separate services by path, and every
 * frontend `fetch("/api/...")` call relies on same-origin cookies. So in
 * production the api-server also serves the two frontends' static builds:
 * SEO OS under `/seo-os/*` (matching its Vite `BASE_PATH`) and
 * ContentForge under `/*`. Both are client-routed SPAs, so any GET that
 * isn't a static asset or an `/api/*` route falls back to that app's
 * `index.html`.
 */
if (process.env["NODE_ENV"] === "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // Bundled to artifacts/api-server/dist/index.mjs — walk up to the repo root.
  const repoRoot = path.resolve(__dirname, "../../..");
  const seoOsDir = path.join(repoRoot, "artifacts/seo-os/dist/public");
  const insightForgeDir = path.join(
    repoRoot,
    "artifacts/insight-forge/dist/public",
  );

  const spaFallback = (indexHtmlPath: string): RequestHandler => {
    return (req, res, next) => {
      // Never let a static-asset fallback mask a real /api/* 404.
      if (req.path.startsWith("/api")) return next();
      res.sendFile(indexHtmlPath, (err) => {
        if (err) next(err);
      });
    };
  };

  if (fs.existsSync(path.join(seoOsDir, "index.html"))) {
    app.use("/seo-os", express.static(seoOsDir, { index: false }));
    app.get(/^\/seo-os(\/.*)?$/, spaFallback(path.join(seoOsDir, "index.html")));
  } else {
    logger.warn(
      { seoOsDir },
      "static: seo-os build not found — skipping static mount",
    );
  }

  if (fs.existsSync(path.join(insightForgeDir, "index.html"))) {
    app.use(express.static(insightForgeDir, { index: false }));
    // Express 5's router (path-to-regexp v6+) no longer accepts a bare "*"
    // string wildcard — pass a RegExp directly to match every remaining GET.
    app.get(/.*/, spaFallback(path.join(insightForgeDir, "index.html")));
  } else {
    logger.warn(
      { insightForgeDir },
      "static: insight-forge build not found — skipping static mount",
    );
  }
}

export default app;
