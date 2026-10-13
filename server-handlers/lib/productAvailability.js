const productTimeZone = "Africa/Lagos";

const getProductTimeParts = (date) => Object.fromEntries(
  new Intl.DateTimeFormat("en-GB", {
    timeZone: productTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map(({ type, value }) => [type, value]),
);

export const toDateTimeLocalValue = (value) => {
  if (!value) return "";
  const localValue = String(value).match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/);
  if (localValue) return localValue[1];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = getProductTimeParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

export const toIsoDateTime = (value) => {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const [, year, month, day, hour, minute] = match.map(Number);
  const localTimeAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const zonedParts = getProductTimeParts(new Date(localTimeAsUtc));
  const zonedTimeAsUtc = Date.UTC(
    Number(zonedParts.year),
    Number(zonedParts.month) - 1,
    Number(zonedParts.day),
    Number(zonedParts.hour),
    Number(zonedParts.minute),
    Number(zonedParts.second),
  );
  return new Date(localTimeAsUtc - (zonedTimeAsUtc - localTimeAsUtc)).toISOString();
};

export const getProductAvailability = (product = {}, now = Date.now()) => {
  const enabled = Boolean(product.release_enabled ?? product.releaseEnabled);
  if (!enabled) return { available: true, reason: "", message: "" };

  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  const releaseAt = product.release_at ?? product.releaseAt;
  const releaseTime = releaseAt ? new Date(releaseAt).getTime() : NaN;
  if (Number.isFinite(releaseTime) && currentTime < releaseTime) {
    const releaseLabel = new Intl.DateTimeFormat("en-NG", {
      timeZone: productTimeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(releaseTime));
    return {
      available: false,
      reason: "not-released",
      message: `Available on ${releaseLabel} WAT.`,
    };
  }

  const closeAt = product.close_at ?? product.closeAt;
  const closeTime = closeAt ? new Date(closeAt).getTime() : NaN;
  const allowAfterClose = Boolean(product.allow_after_close ?? product.allowAfterClose);
  if (Number.isFinite(closeTime) && currentTime >= closeTime && !allowAfterClose) {
    return {
      available: false,
      reason: "closed",
      message: "This product is no longer available.",
    };
  }

  return { available: true, reason: "", message: "" };
};