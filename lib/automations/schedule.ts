import { CronExpressionParser } from "cron-parser"

import type { AutomationSchedule } from "./types"

const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
const CLOCK_TIME_PATTERN = /^(\d{2}):(\d{2})$/

function assertValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date())
  } catch {
    throw new Error(`Invalid time zone: ${timeZone}`)
  }
}

function timeZoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  )

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  }
}

function localDateTimeToUtc(value: string, timeZone: string) {
  const match = value.match(LOCAL_DATE_TIME_PATTERN)

  if (!match) {
    throw new Error("Once schedules require YYYY-MM-DDTHH:mm.")
  }

  const wanted = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  }
  const initial = Date.UTC(
    wanted.year,
    wanted.month - 1,
    wanted.day,
    wanted.hour,
    wanted.minute,
    wanted.second
  )
  let candidate = initial

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = timeZoneParts(new Date(candidate), timeZone)
    const representedAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    )
    const adjustment = initial - representedAsUtc

    if (adjustment === 0) {
      break
    }

    candidate += adjustment
  }

  const resolved = timeZoneParts(new Date(candidate), timeZone)
  if (
    resolved.year !== wanted.year ||
    resolved.month !== wanted.month ||
    resolved.day !== wanted.day ||
    resolved.hour !== wanted.hour ||
    resolved.minute !== wanted.minute
  ) {
    throw new Error("The selected local time does not exist in this time zone.")
  }

  return new Date(candidate)
}

function parseClockTime(value: string) {
  const match = value.match(CLOCK_TIME_PATTERN)
  const hour = Number(match?.[1])
  const minute = Number(match?.[2])

  if (!match || hour > 23 || minute > 59) {
    throw new Error("Time must use HH:mm in 24-hour format.")
  }

  return { hour, minute }
}

function parseFiveFieldCron(expression: string) {
  const normalized = expression.trim().replace(/\s+/g, " ")

  if (normalized.split(" ").length !== 5) {
    throw new Error("Cron schedules require exactly five fields.")
  }

  return normalized
}

function cronNext(expression: string, timeZone: string, after: Date): Date {
  const parsed = CronExpressionParser.parse(expression, {
    currentDate: after,
    tz: timeZone,
  })

  return parsed.next().toDate()
}

function cronPrevious(
  expression: string,
  timeZone: string,
  atOrBefore: Date
): Date {
  const parsed = CronExpressionParser.parse(expression, {
    currentDate: new Date(atOrBefore.getTime() + 1),
    tz: timeZone,
  })

  return parsed.prev().toDate()
}

function intervalMilliseconds(
  schedule: Extract<AutomationSchedule, { kind: "interval" }>
) {
  const unitMilliseconds =
    schedule.unit === "minutes"
      ? 60_000
      : schedule.unit === "hours"
        ? 3_600_000
        : 86_400_000

  return schedule.every * unitMilliseconds
}

export function validateAutomationSchedule(
  schedule: AutomationSchedule,
  timeZone: string
) {
  assertValidTimeZone(timeZone)

  switch (schedule.kind) {
    case "once":
      localDateTimeToUtc(schedule.localDateTime, timeZone)
      return
    case "interval": {
      const anchor = new Date(schedule.anchorAt)
      if (
        !Number.isInteger(schedule.every) ||
        schedule.every < 1 ||
        schedule.every > 10_000 ||
        Number.isNaN(anchor.getTime())
      ) {
        throw new Error("Interval schedule is invalid.")
      }
      return
    }
    case "daily": {
      const { hour, minute } = parseClockTime(schedule.time)
      cronNext(`${minute} ${hour} * * *`, timeZone, new Date())
      return
    }
    case "weekly": {
      const { hour, minute } = parseClockTime(schedule.time)
      const weekdays = [...new Set(schedule.weekdays)].sort((a, b) => a - b)
      if (
        weekdays.length === 0 ||
        weekdays.some(
          (weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6
        )
      ) {
        throw new Error("Weekly schedules require at least one valid weekday.")
      }
      cronNext(
        `${minute} ${hour} * * ${weekdays.join(",")}`,
        timeZone,
        new Date()
      )
      return
    }
    case "cron":
      cronNext(parseFiveFieldCron(schedule.expression), timeZone, new Date())
  }
}

export function getNextAutomationRunAt({
  schedule,
  timeZone,
  after,
}: {
  schedule: AutomationSchedule
  timeZone: string
  after: Date
}): string | null {
  validateAutomationSchedule(schedule, timeZone)

  switch (schedule.kind) {
    case "once": {
      const runAt = localDateTimeToUtc(schedule.localDateTime, timeZone)
      return runAt.getTime() > after.getTime() ? runAt.toISOString() : null
    }
    case "interval": {
      const anchor = new Date(schedule.anchorAt).getTime()
      const everyMs = intervalMilliseconds(schedule)
      const afterMs = after.getTime()

      if (anchor > afterMs) {
        return new Date(anchor).toISOString()
      }

      const elapsedIntervals = Math.floor((afterMs - anchor) / everyMs) + 1
      return new Date(anchor + elapsedIntervals * everyMs).toISOString()
    }
    case "daily": {
      const { hour, minute } = parseClockTime(schedule.time)
      return cronNext(`${minute} ${hour} * * *`, timeZone, after).toISOString()
    }
    case "weekly": {
      const { hour, minute } = parseClockTime(schedule.time)
      const weekdays = [...new Set(schedule.weekdays)].sort((a, b) => a - b)
      return cronNext(
        `${minute} ${hour} * * ${weekdays.join(",")}`,
        timeZone,
        after
      ).toISOString()
    }
    case "cron":
      return cronNext(
        parseFiveFieldCron(schedule.expression),
        timeZone,
        after
      ).toISOString()
  }
}

export function getLatestAutomationRunAt({
  schedule,
  timeZone,
  atOrBefore,
}: {
  schedule: AutomationSchedule
  timeZone: string
  atOrBefore: Date
}): string | null {
  validateAutomationSchedule(schedule, timeZone)

  switch (schedule.kind) {
    case "once": {
      const runAt = localDateTimeToUtc(schedule.localDateTime, timeZone)
      return runAt.getTime() <= atOrBefore.getTime()
        ? runAt.toISOString()
        : null
    }
    case "interval": {
      const anchor = new Date(schedule.anchorAt).getTime()
      const atOrBeforeMs = atOrBefore.getTime()
      if (anchor > atOrBeforeMs) {
        return null
      }

      const everyMs = intervalMilliseconds(schedule)
      const elapsedIntervals = Math.floor((atOrBeforeMs - anchor) / everyMs)
      return new Date(anchor + elapsedIntervals * everyMs).toISOString()
    }
    case "daily": {
      const { hour, minute } = parseClockTime(schedule.time)
      return cronPrevious(
        `${minute} ${hour} * * *`,
        timeZone,
        atOrBefore
      ).toISOString()
    }
    case "weekly": {
      const { hour, minute } = parseClockTime(schedule.time)
      const weekdays = [...new Set(schedule.weekdays)].sort((a, b) => a - b)
      return cronPrevious(
        `${minute} ${hour} * * ${weekdays.join(",")}`,
        timeZone,
        atOrBefore
      ).toISOString()
    }
    case "cron":
      return cronPrevious(
        parseFiveFieldCron(schedule.expression),
        timeZone,
        atOrBefore
      ).toISOString()
  }
}

export function getAutomationScheduleDescription(schedule: AutomationSchedule) {
  switch (schedule.kind) {
    case "once":
      return schedule.localDateTime
    case "interval":
      return `Every ${schedule.every} ${schedule.unit}`
    case "daily":
      return `Daily at ${schedule.time}`
    case "weekly":
      return `Weekly (${schedule.weekdays.join(",")}) at ${schedule.time}`
    case "cron":
      return schedule.expression
  }
}
