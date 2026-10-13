import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("retry lost audit deliveries", { hours: 1 }, internal.audit.sweep, {});

export default crons;
