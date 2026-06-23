import dayjs, { type Dayjs } from 'dayjs'

const minuteOfDay = (value: Dayjs): number => value.hour() * 60 + value.minute()

export const slotWindow = (
  time: Dayjs,
  eventLength: number,
  utcOffset: number
): { readonly start: number; readonly end: number } | undefined => {
  const slotEndTime = time.add(eventLength, 'minutes').utc()
  const slotStartTime = time.utc()

  if (
    dayjs(slotStartTime).add(utcOffset, 'minutes') ===
    dayjs(slotEndTime).add(utcOffset, 'minutes')
  ) {
    return undefined
  }

  const start = minuteOfDay(slotStartTime)
  const end = minuteOfDay(slotStartTime)

  return { start, end }
}
