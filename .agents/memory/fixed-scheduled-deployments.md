---
name: Fixed Scheduled Deployment migration
description: Moving fixed BullMQ calendars to Scheduled Deployments requires removing both boot registration and already-persisted repeatables.
---

Fixed calendar jobs must be migrated in two parts: stop registering them from
both standalone and embedded worker boot, and remove any repeatable definitions
already stored in Redis. Otherwise the new Scheduled Deployment dispatchers
run alongside the old repeatables and every fixed job fires twice.

**Why:** BullMQ repeatable schedules persist independently of application code;
deleting the registration call does not delete an existing Redis schedule.

**How to apply:** Keep dynamic per-brand schedules in BullMQ, but add a
one-time boot cleanup for each fixed job name when ownership moves to a
Scheduled Deployment.