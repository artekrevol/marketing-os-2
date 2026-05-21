import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminSystemRouter from "./admin-system";
import qualityGateRouter from "./quality-gate";
import recoveryRouter from "./recovery";
import aiRouter from "./ai/index.js";
import meRouter from "./me";
import projectsRouter from "./projects.js";
import brandsRouter from "./brands.js";
import eventsRouter from "./events.js";
import auditRouter from "./audit.js";
import adminRouter from "./admin.js";
import voiceLibraryRouter from "./voice-library.js";
import pageEventsRouter from "./page-events.js";
import authRouter from "./auth.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/admin/system", adminSystemRouter);
router.use("/admin", adminRouter);
router.use("/quality-gate", qualityGateRouter);
router.use("/recovery", recoveryRouter);
router.use("/ai", aiRouter);
router.use("/me", meRouter);
router.use("/projects", projectsRouter);
router.use("/brands", brandsRouter);
router.use("/events", eventsRouter);
router.use("/audit", auditRouter);
router.use("/voice-library", voiceLibraryRouter);
router.use("/page-events", pageEventsRouter);

export default router;
