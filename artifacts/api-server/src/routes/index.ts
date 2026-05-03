import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminSystemRouter from "./admin-system";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/admin/system", adminSystemRouter);

export default router;
