// @ts-check
import { Heap } from 'heap-js';

const RESET_FREQUENCY_SECONDS_DEFAULT = 1;
const INITIAL_CAPACITY = 100000;

/**
 * @typedef {Object} setNewFrequencyCounterValueData
 * @property {string[]} keys
 * @property {number} value
 * @property {object} [time]
 * @property {boolean} skipDuplication
 * @property {string} [label]
 */
export default class DataStore {
    #resetFrequencySeconds

    constructor(resetFrequencySeconds = RESET_FREQUENCY_SECONDS_DEFAULT) {
        this.#resetFrequencySeconds = resetFrequencySeconds
        this.timePoints = [];
        this.counters = new Map();
        this.vars = new Map();
        this.infiniteMaps = new Map();

        // Optimized storage for numerical data
        this.numericalCounters = new Map();
        this.heaps = new Map();
        this.rateCounters = new Map();
    }

    get resetFrequencySeconds() {
        return this.#resetFrequencySeconds
    }

    incrementCounter(key, incrementer, time = null) {
        const counter = this.counters.get(key);
        const value = +(counter?.length > 0 ? counter[ counter.length - 1 ].y : 0) + incrementer;
        return this.setNewCounterValue(key, value, undefined, time)
    }

    incrementCounterLast(...keyVal) { // last element is incrementer
        const incrementer = keyVal.pop();
        const keys = keyVal;
        let counter;
        if (keys.length > 1)
            counter = this.#getInfiniteMapValue(this.counters, ...keys);
        else
            counter = this.counters.get(keys[ 0 ])
        counter[ counter.length - 1 ].y += incrementer;
        return counter[ counter.length - 1 ].y + incrementer;
    }

    incrementFrequencyCounter(...keyVal) { // last element is incrementer, optional second-to-last is time
        const incrementer = keyVal.pop();
        const time = typeof keyVal[ keyVal.length - 1 ] === 'object' && keyVal[ keyVal.length - 1 ] instanceof Date ? keyVal.pop() : null;
        const keys = keyVal;
        const timeNow = time || this.getLastTimePoint();
        let counter = this.#getInfiniteMapValue(this.counters, ...keys);
        if (!counter || +timeNow - +counter[ counter.length - 1 ].x > this.#resetFrequencySeconds * 1000)
            this.resetFrequencyCounter(...keys, timeNow)

        counter = this.#getInfiniteMapValue(this.counters, ...keys);
        return this.incrementCounterLast(...keys, incrementer)

        // this.incrementCounter(key, incrementer, null, true)
    }

    getLatestFrequencyCounterValue(...keyVal) {
        const keys = keyVal;
        let counter = this.#getInfiniteMapValue(this.counters, ...keys);
        if (!counter) return;
        return counter[ counter.length - 1 ]
    }

    getFrequencyCounterValues(...keyVal) {
        const keys = keyVal;
        let counter = this.#getInfiniteMapValue(this.counters, ...keys);
        if (!counter) return;
        return counter
    }

    clearFrequencyCounter(...keyVal) { // last element is incrementer
        const keys = keyVal;
        const timeNow = this.getLastTimePoint();
        let counter = this.#getInfiniteMapValue(this.counters, ...keys);
        counter = null;
    }

    resetFrequencyCounter(...args) {
        const timeNow = args.length > 1 && args[ args.length - 1 ] instanceof Date ? args.pop() : this.getLastTimePoint();
        const keys = args;
        const counter = this.#getInfiniteMapValue(this.counters, ...keys);
        if (counter?.length > 0) {
            this.setNewFrequencyCounterValue({ keys: keys, value: 0, time: counter[ counter.length - 1 ].x, skipDuplication: true })
        }

        this.setNewFrequencyCounterValue({ keys: keys, value: 0, time: timeNow, skipDuplication: false })
    }

    /**
     * @param {setNewFrequencyCounterValueData} data 
     */
    setNewFrequencyCounterValue(data) {
        let time = data.time;
        const keys = data.keys;
        const value = data.value;
        const skipDuplication = data.skipDuplication;
        const label = data.label;

        let oldCounter = this.#getInfiniteMapValue(this.counters, ...keys)
        if (!oldCounter)
            this.#setInfiniteMapValue(this.counters, ...keys, []);
        oldCounter = this.#getInfiniteMapValue(this.counters, ...keys)
        return this.#setNewCounterValue(oldCounter, value, label, time, skipDuplication)
    }

    /**
     * 
     * @param {string} key 
     * @param {*} value 
     * @param {string} [label] 
     * @param {*} [time] 
     * @param {boolean} [skipDuplication] 
     * @returns 
     */
    setNewCounterValue(key, value, label, time = null, skipDuplication = true, deduplicateData = false) {
        // Use optimized storage for pure numerical data
        if (typeof value === 'number' && !label) {
            return this.#setOptimizedCounterValue(key, value, time, deduplicateData);
        }

        let oldCounter = this.counters.get(key);
        if (!oldCounter)
            this.counters.set(key, []);
        oldCounter = this.counters.get(key);
        return this.#setNewCounterValue(oldCounter, value, label, time, skipDuplication, false);
    }

    #setOptimizedCounterValue(key, value, time, deduplicateData = false) {
        if (!this.numericalCounters.has(key)) {
            this.numericalCounters.set(key, {
                times: new Float64Array(INITIAL_CAPACITY),
                values: new Float64Array(INITIAL_CAPACITY),
                count: 0,
                capacity: INITIAL_CAPACITY
            });

            // Create heaps for min/max operations
            this.heaps.set(key + '_min', new Heap((a, b) => a - b));
            this.heaps.set(key + '_max', new Heap((a, b) => b - a));
        }

        const counter = this.numericalCounters.get(key);

        // Resize if needed
        if (counter.count >= counter.capacity) {
            const newCapacity = counter.capacity * 2;
            const newTimes = new Float64Array(newCapacity);
            const newValues = new Float64Array(newCapacity);
            newTimes.set(counter.times);
            newValues.set(counter.values);
            counter.times = newTimes;
            counter.values = newValues;
            counter.capacity = newCapacity;
        }

        const timeValue = time !== null ? +time : this.getLastTimePoint();
        
        // Check for deduplication
        if (deduplicateData && counter.count > 0) {
            const lastValue = counter.values[counter.count - 1];
            if (lastValue === value) {
                return { x: timeValue, y: value }; // Skip adding duplicate
            }
        }
        
        counter.times[ counter.count ] = timeValue;
        counter.values[ counter.count ] = value;
        counter.count++;

        // Update heaps
        this.heaps.get(key + '_min').push(value);
        this.heaps.get(key + '_max').push(value);

        return { x: timeValue, y: value };
    }

    /**
     * 
     * @param {*[]} oldCounter 
     * @param {*} value 
     * @param {string} [label] 
     * @param {*} time 
     * @param {*} skipDuplication 
     * @returns {object}
     */
    #setNewCounterValue(oldCounter, value, label, time = null, skipDuplication = true, memorySaving = false) {
        if (time && +time > 0) time = this.addTimePoint(time instanceof Date ? time : new Date(time));
        else time = this.getLastTimePoint();

        const xRef = time; //time.formatted

        const newObj = {
            y: value,
            x: xRef,
            label: label
        }

        const prevValue = oldCounter[ oldCounter.length - 1 ]?.y || 0
        if (memorySaving) {
            // If the value is the same as the previous one, we don't add a new entry
            if (prevValue === value && skipDuplication) {
                return oldCounter[ oldCounter.length - 1 ];
            }
        }

        if (oldCounter && !skipDuplication) {
            const oldObjDuplication = {
                y: prevValue,
                x: xRef,
                label: label
            }
            oldCounter.push(oldObjDuplication)
        }
        oldCounter.push(newObj)
        return newObj;
    }

    addTimePoint(time) {
        const obj = {
            time: time,
            // formatted: time.toLocaleString()
        }
        if (this.timePoints[ this.timePoints.length - 1 ] != obj.time)
            this.timePoints.push(time);
        return time;
    }

    getLastTimePoint() {
        return this.timePoints[ this.timePoints.length - 1 ];
    }
    getPreLastTimePoint() {
        return this.timePoints[ this.timePoints.length - 2 ];
    }

    getTimePoints() {
        return this.timePoints;
    }

    getCounterData(...keys) {
        if (keys.length == 1) {
            const key = keys[ 0 ];

            // Check rate counters first
            if (this.rateCounters.has(key)) {
                return this.getRateCounterData(key);
            }

            // Check optimized storage
            if (this.numericalCounters.has(key)) {
                const counter = this.numericalCounters.get(key);
                const result = [];
                for (let i = 0; i < counter.count; i++) {
                    result.push({
                        x: counter.times[ i ],
                        y: counter.values[ i ]
                    });
                }
                return result;
            }

            return this.counters.get(key) || [];
        } else {
            return this.#getInfiniteMapValue(this.counters, ...keys);
        }
    }

    getCounterLastValue(key) {
        const data = this.getCounterData(key)
        return data[ data.length - 1 ]
    }

    // getCounters() {
    //     return [ ...this.timeData.keys() ];
    // }

    setVar(key, value) {
        this.vars.set(key, value);
    }

    getVarKeys() {
        return [ ...this.vars.keys() ];
    }

    getVar(key) {
        return this.vars.get(key);
    }

    setInfiniteMapValue(...keyVal) { // last element is value
        return this.#setInfiniteMapValue(this.infiniteMaps, ...keyVal)
    }

    #setInfiniteMapValue(target, ...keyVal) { // last element is value
        if (keyVal.length < 2) throw new Error('Cannot create an infinite map with less than 2 parameters')

        const value = keyVal.pop();
        const keys = keyVal;

        let step = target;
        for (let keyIndex in keys) {
            const key = keys[ keyIndex ];

            if (+keyIndex == keys.length - 1) break;

            if (!step.has(key))
                step.set(key, new Map());

            step = step.get(key);
        }

        step.set(keys.pop(), value);
    }

    getInfiniteMapValue(...keys) {
        return this.#getInfiniteMapValue(this.infiniteMaps, ...keys)
    }

    /**
     * 
     * @param {*} target 
     * @param  {...any} keys 
     * @returns {any}
     */
    #getInfiniteMapValue(target, ...keys) {
        let step = target;
        for (let key of keys) {
            if (!step.has(key)) return;
            step = step.get(key);
        }
        return step;
    }

    clearAll() {
        this.timePoints = [];
        this.counters = new Map();
        this.vars = new Map();
        this.infiniteMaps = new Map();
        this.numericalCounters = new Map();
        this.heaps = new Map();
        this.rateCounters = new Map();
    }

    // Rate counter - sparse data with Chart.js stepped visualization
    incrementRateCounter(key, incrementer, time = null) {
        if (!this.rateCounters.has(key)) {
            this.rateCounters.set(key, {
                currentCount: 0,
                lastSecond: -1,
                lastFrameTime: 0,
                data: []
            });
        }

        const counter = this.rateCounters.get(key);
        
        const timeValue = +this.addTimePoint(time);
        const currentSecond = Math.floor(timeValue / 1000);

        if (currentSecond > counter.lastSecond) {
            // New second - record TPS at the LAST frame's timestamp of previous second
            if (counter.lastSecond >= 0) { // Skip first initialization
                counter.data.push({
                    x: counter.lastFrameTime, // Use last frame time, not crossing time
                    y: counter.currentCount
                });
            }
            counter.currentCount = incrementer; // Reset and count this increment
            counter.lastSecond = currentSecond;
        } else {
            // Same second - just increment counter
            counter.currentCount += incrementer;
        }

        // Always update last frame time
        counter.lastFrameTime = timeValue;

        return counter.currentCount;
    }

    getRateCounterData(key) {
        const counter = this.rateCounters.get(key);
        if (!counter) return [];

        // If we have a current count but haven't recorded it yet, add it
        const data = [ ...counter.data ];
        if (counter.currentCount > 0 && counter.lastSecond >= 0) {
            data.push({
                x: +this.getLastTimePoint(), // Convert to number
                y: counter.currentCount
            });
        }

        return data;
    }

    // Check if a key is a rate counter (for Chart.js stepped option)
    isRateCounter(key) {
        return this.rateCounters.has(key);
    }
    
    // Get counter data with extension to chart end
    getCounterDataExtended(key, maxTime) {
        const data = this.getCounterData(key);
        if (data.length === 0) return data;
        
        // Add final point at maxTime with last value to extend line
        const lastValue = data[data.length - 1].y;
        const extendedData = [...data];
        
        if (data[data.length - 1].x < maxTime) {
            extendedData.push({
                x: maxTime,
                y: lastValue
            });
        }
        
        return extendedData;
    }

    // Get Y values only for Chart.js auto-spacing
    getCounterYValues(key) {
        if (this.rateCounters.has(key)) {
            return this.getRateCounterData(key).map(p => p.y);
        }

        if (this.numericalCounters.has(key)) {
            const counter = this.numericalCounters.get(key);
            const result = [];
            for (let i = 0; i < counter.count; i++) {
                result.push(counter.values[ i ]);
            }
            return result;
        }

        const data = this.counters.get(key) || [];
        return data.map(p => p.y);
    }

    // Performance methods using heap-js
    getMinValue(key) {
        const minHeap = this.heaps.get(key + '_min');
        return minHeap ? minHeap.peek() : undefined;
    }

    getMaxValue(key) {
        const maxHeap = this.heaps.get(key + '_max');
        return maxHeap ? maxHeap.peek() : undefined;
    }

    // Fast average calculation using TypedArrays
    getAverageValue(key) {
        if (!this.numericalCounters.has(key)) return undefined;

        const counter = this.numericalCounters.get(key);
        let sum = 0;
        for (let i = 0; i < counter.count; i++) {
            sum += counter.values[ i ];
        }
        return sum / counter.count;
    }
}