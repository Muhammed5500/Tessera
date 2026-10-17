/** İç temsil: UTC Unix saniye, dakikaya hizalı (CLAUDE.md). UI: Europe/Istanbul. */

export const nowSec = (nowMs = Date.now()) => Math.floor(nowMs / 1000);

export const alignMinute = (sec: number) => sec - (sec % 60);

export function isAligned(sec: number): boolean {
  return Number.isInteger(sec) && sec % 60 === 0;
}

const fmt = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** 1792256400 → "17.10 18:00" (TR saati) */
export function formatTR(sec: number): string {
  return fmt.format(new Date(sec * 1000)).replace(",", "");
}
