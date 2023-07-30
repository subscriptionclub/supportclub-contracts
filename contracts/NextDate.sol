// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

contract NextDate {
    uint256 constant DENOMINATOR = 10_000;

    /**
     * @dev parse timestamp & get service params for calculations
     */
    function getDaysFromTimestamp(
        uint256 timestamp
    )
        internal
        pure
        returns (uint256 yearStartDay, uint256 dayOfYear, uint256 yearsFrom1972)
    {
        // get number of days from 01.01.1970
        uint256 daysFrom0 = timestamp / 86_400;

        // get number of full years from `01.01.1970 + 730 days = 01.01.1972` (first leap year from 1970)
        // 1461 days = number of days in one leap cycle 365 + 365 + 365 + 366
        yearsFrom1972 =
            ((((daysFrom0 - 730) * DENOMINATOR) / 1461) * 4) /
            DENOMINATOR;

        // subtract 1 year from yearsFrom1972 (so 0 year = 01.01.1973) and add 1096 days (= 366 + 365 + 365 days), so 0 years is 01.01.1970 and we can get 0 day of the current year
        yearStartDay = ((((yearsFrom1972 - 1) * 1461) / 4) + 1096);

        dayOfYear = daysFrom0 - yearStartDay + 1;
    }

    /**
     * @dev get timestamp for the first day of the next month
     */
    function getStartOfNextMonth(
        uint256 timestamp
    ) public pure returns (uint256) {
        (
            uint256 yearStartDay,
            uint256 dayOfYear,
            uint256 yearsFrom1972
        ) = getDaysFromTimestamp(timestamp);

        uint16[13] memory monthsSums = yearsFrom1972 % 4 == 0
            ? [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335, 366]
            : [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];

        uint8 low = 0;
        uint8 high = 12;
        while (true) {
            uint8 mid = (low + high) / 2;

            if (high - low == 1)
                return (yearStartDay + uint256(monthsSums[high])) * 86_400;

            if (dayOfYear > monthsSums[mid]) low = mid;
            else high = mid;
        }

        return 0;
    }
}
