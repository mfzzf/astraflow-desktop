// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"
// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { Database } from "bun:sqlite"

import { getAppRuntimeIdleState } from "@/lib/app-runtime-idle"

function createDatabase() {
  const database = new Database(":memory:")

  database.exec(`
    CREATE TABLE studio_messages (status TEXT NOT NULL);
    CREATE TABLE studio_scheduled_task_runs (status TEXT NOT NULL);
    CREATE TABLE studio_image_generations (status TEXT NOT NULL);
    CREATE TABLE studio_audio_generations (status TEXT NOT NULL);
    CREATE TABLE studio_video_generations (status TEXT NOT NULL);
  `)

  return database
}

describe("app runtime idle state", () => {
  test("is idle when no task or generation is active", () => {
    const database = createDatabase()

    database.exec(`
      INSERT INTO studio_messages VALUES ('complete');
      INSERT INTO studio_scheduled_task_runs VALUES ('succeeded');
      INSERT INTO studio_image_generations VALUES ('complete');
      INSERT INTO studio_audio_generations VALUES ('error');
      INSERT INTO studio_video_generations VALUES ('cancelled');
    `)

    expect(getAppRuntimeIdleState(database)).toEqual({
      idle: true,
      activeCount: 0,
      counts: {
        agentRuns: 0,
        automationRuns: 0,
        imageGenerations: 0,
        audioGenerations: 0,
        videoGenerations: 0,
      },
    })
    database.close()
  })

  test("blocks restart while agents, automations, or media tasks run", () => {
    const database = createDatabase()

    database.exec(`
      INSERT INTO studio_messages VALUES ('streaming');
      INSERT INTO studio_scheduled_task_runs VALUES ('queued');
      INSERT INTO studio_scheduled_task_runs VALUES ('running');
      INSERT INTO studio_image_generations VALUES ('polling');
      INSERT INTO studio_audio_generations VALUES ('running');
      INSERT INTO studio_video_generations VALUES ('running');
    `)

    expect(getAppRuntimeIdleState(database)).toEqual({
      idle: false,
      activeCount: 6,
      counts: {
        agentRuns: 1,
        automationRuns: 2,
        imageGenerations: 1,
        audioGenerations: 1,
        videoGenerations: 1,
      },
    })
    database.close()
  })
})
