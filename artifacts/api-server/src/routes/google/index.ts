import { Router, type IRouter } from "express";
import oauthRouter from "./oauth.js";
import integrationsRouter from "./integrations.js";

const router: IRouter = Router();

router.use("/oauth", oauthRouter);
router.use("/integrations", integrationsRouter);

export default router;
