import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("retry lost audit deliveries", { hours: 1 }, internal.audit.sweep, {});

crons.daily("purge issues deleted 30+ days ago", { hourUTC: 4, minuteUTC: 0 }, internal.issues.purgeDeleted, {});

export default crons;
