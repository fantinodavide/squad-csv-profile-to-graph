export function StatsComparer(reference, candidate) {
    return Object.fromEntries(
        Object.entries(reference)
            .map((element) => {
                const key = element[ 0 ];
                const refValue = element[ 1 ];
                const candValue = candidate[ key ];

                if (!candValue) {
                    // console.error(`Candidate object does not have the property "${key}"`)
                    return [ key, null ]
                }

                const variation = candValue - refValue;
                const variationPerc = variation * 100 / refValue;

                // console.log(`${key} > ${numToStringSymbol(variationPerc)}% (${numToStringSymbol(variation, 6)})`)

                return [ key, { variation, variationPerc, numToStringSymbol } ]
            })
    )
}

function numToStringSymbol(num, precision = 2) {
    const numString = num.toFixed(precision);
    if (num > 0) return '+' + numString;
    if (num < 0) return numString;
    return '0';
}