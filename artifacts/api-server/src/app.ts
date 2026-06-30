import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
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

export default app;
