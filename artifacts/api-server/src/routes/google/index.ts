import { Router, type IRouter } from "express";
import oauthRouter from "./oauth.js";

const router: IRouter = Router();

router.use("/oauth", oauthRouter);

export default router;
