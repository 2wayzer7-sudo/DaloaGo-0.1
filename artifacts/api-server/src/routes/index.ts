import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tripsRouter from "./trips";
import driversRouter from "./drivers";
import dispatchRouter from "./dispatch";
import dashboardRouter from "./dashboard";
import zonesRouter from "./zones";
import telemetryRouter from "./telemetry";
import repositionRouter from "./reposition";
import demandForecastRouter from "./demand-forecast";

const router: IRouter = Router();

router.use(healthRouter);
router.use(telemetryRouter);
router.use(repositionRouter);
router.use(demandForecastRouter);
router.use(tripsRouter);
router.use(driversRouter);
router.use(dispatchRouter);
router.use(dashboardRouter);
router.use(zonesRouter);

export default router;
