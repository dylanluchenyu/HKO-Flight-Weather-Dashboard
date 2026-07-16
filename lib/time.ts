const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";

export function getHongKongDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return getHongKongDateString(date);
}

export function parseHkiaDateTime(dateString: string, timeString: string): Date {
  return new Date(`${dateString}T${timeString}:00+08:00`);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function formatShortTime(dateString: string): string {
  return new Intl.DateTimeFormat("en-HK", {
    timeZone: HONG_KONG_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(dateString));
}

export function formatDateTime(dateString: string): string {
  return new Intl.DateTimeFormat("en-HK", {
    timeZone: HONG_KONG_TIME_ZONE,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(dateString));
}

export function buildHourlyBuckets(now: Date, count: number) {
  return Array.from({ length: count }, (_, offset) => {
    const startsAt = addHours(now, offset);
    const endsAt = addHours(now, offset + 1);
    return {
      hourOffset: offset,
      label: offset === 0 ? "Now-+1h" : `+${offset}h-+${offset + 1}h`,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString()
    };
  });
}
