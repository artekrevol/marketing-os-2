import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminSystemRouter from "./admin-system";
import qualityGateRouter from "./quality-gate";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/admin/system", adminSystemRouter);
router.use("/quality-gate", qualityGateRouter);

export default router;
