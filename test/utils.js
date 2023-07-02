const DAY_IN_SECS = 24 * 60 * 60;

const floor = Math.floor;
const parseSeconds = (date = new Date()) => floor(Number(date) / 1000);
const parseDays = (date = new Date()) =>
  floor(parseSeconds(date) / DAY_IN_SECS);
const UTC = (year, month, date) => new Date(Date.UTC(year, month, date));

function jsParseDate(date = new Date(), nextMonthDate = 1) {
  const seconds = parseSeconds(date);
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  const _date = date.getUTCDate();

  const daysFrom0 = parseDays(date);
  const dayStartSeconds = daysFrom0 * DAY_IN_SECS;
  const yearStartDay = parseDays(new Date(`01.01.${year} UTC`));
  const dayOfYear = daysFrom0 - yearStartDay + 1;

  const yearsFrom1972 = year - 1972;

  const nextMonthIndex = monthIndex + 1;

  const daysInMonth = UTC(year, nextMonthIndex, 0).getUTCDate();

  const daysInNextMonth = UTC(year, nextMonthIndex + 1, 0).getUTCDate();
  const expirationDate = UTC(
    year,
    nextMonthIndex,
    _date > daysInNextMonth ? daysInNextMonth : _date
  );
  const nextBillingTimestamp = parseSeconds(expirationDate);

  const nextDate = UTC(
    year,
    nextMonthIndex,
    nextMonthDate > daysInNextMonth ? daysInNextMonth : nextMonthDate
  );
  const nextDateTimestamp = parseSeconds(nextDate);

  return {
    seconds,
    year,
    month: monthIndex + 1,
    date: _date,
    daysFrom0,
    yearStartDay,
    dayOfYear,
    yearsFrom1972,
    daysInMonth,
    dayStartSeconds,
    nextBillingTimestamp,
    nextDateTimestamp,
  };
}

const struct = (structFromCall) =>
  Array.isArray(structFromCall[0])
    ? structFromCall.map(struct)
    : structFromCall.length === 0 ||
      typeof structFromCall !== `object` ||
      !isNaN(+structFromCall)
    ? structFromCall
    : Object.keys(structFromCall).reduce(
        (acc, key) =>
          isNaN(Number(key))
            ? {
                ...acc,
                [key]: Array.isArray(structFromCall[key])
                  ? struct(structFromCall[key])
                  : structFromCall[key]._isBigNumber
                  ? Number(structFromCall[key])
                  : structFromCall[key],
              }
            : acc,
        {}
      );

module.exports = {
  floor,
  parseSeconds,
  parseDays,
  UTC,
  jsParseDate,
  DAY_IN_SECS,
  struct,
};
