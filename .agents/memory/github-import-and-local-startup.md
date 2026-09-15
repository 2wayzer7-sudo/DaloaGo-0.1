---
name: GitHub import and local startup
description: Opening the DaloaGo repository locally requires exact branch alignment and a prepared development database.
---

When reopening DaloaGo from GitHub, align the workspace with the verified `main` commit before starting services, then apply the Drizzle schema to the development database before starting the API.

**Why:** The workspace can begin as a generic scaffold and the development database can be empty; starting the UI alone then produces API gateway errors and missing-table crashes.

**How to apply:** Treat the GitHub repository as the source of truth for the opened project, preserve conversation-only files, run the database package's development schema push, and start the API before judging the web preview.