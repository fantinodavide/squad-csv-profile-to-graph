#!/usr/bin/env node

import fs from 'fs';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { createCanvas } from 'canvas';
import { EventEmitter } from 'events';
import DataStore from '../src/services/data-store.js';
import ThreeMetricChartGenerator from '../src/services/three-metric-chart-generator.js';

const SAMPLE_RATE = 500;

export class CsvProfileProcessor extends EventEmitter {
    #columnMap = null
    #dataStore = new DataStore()
    #lineCount = 0
    #isFirstLine = true
    #processedData = []
    #tpsCounter = 0
    #lastSecond = 0
    #sampleCounter = 0

    time = 0;

    constructor() {
        super();
    }

    processLine(line) {
        return this.analyzeLine(line);
    }

    analyzeLine(line) {
        if (this.#isFirstLine) {
            this.#columnMap = this.parseHeaders(line);
            this.#isFirstLine = false;
            return;
        }

        const dataPoint = this.extractDataPoint(line);
        if (dataPoint) {
            if (isNaN(dataPoint.frameTime) || dataPoint.frameTime <= 0)
                return
            this.time += Math.round(dataPoint.frameTime);
            dataPoint.time = new Date(this.time); // Convert to proper Date object
            this.#dataStore.addTimePoint(dataPoint.time);
            this.updateMetrics(dataPoint);
        }

        this.#lineCount++;
        if (this.#lineCount % 10000 === 0) {
            process.stdout.write(`\r   Processed ${this.#lineCount} rows...`);
        }
    }

    parseHeaders(line) {
        const headers = line.split(',').map(h => h.trim());

        // Find all CPU columns that start with 'Exclusive/GameThread/'
        const cpuColumns = [];
        headers.forEach((header, index) => {
            if (header.startsWith('Exclusive/GameThread/')) {
                // Exclude parent/duplicate columns to avoid double counting
                if (header.startsWith('Exclusive/GameThread/EventWait')) {
                    // Skip parent EventWait - we'll include the specific EventWait/* subcategories
                    return;
                }
                if (header.startsWith('Exclusive/GameThread/ReplicateActor')) {
                    // Skip ReplicateActor - we'll use ServerReplicateActors instead
                    return;
                }
                cpuColumns.push(index);
            }
        });

        const columnMap = {
            memory: headers.indexOf('PhysicalUsedMB'),
            frameTime: headers.indexOf('FrameTime'),
            cpuColumns: cpuColumns, // Array of all CPU column indices
            playerCount: headers.indexOf('Replication/Connections')
        };

        // Remove missing columns (except cpuColumns which is an array)
        Object.keys(columnMap).forEach(key => {
            if (key !== 'cpuColumns' && columnMap[ key ] === -1) {
                delete columnMap[ key ];
            }
        });

        return columnMap;
    }

    extractDataPoint(line) {
        const values = line.split(',');
        const row = { index: this.#lineCount };

        Object.entries(this.#columnMap).forEach(([ key, indexOrArray ]) => {
            if (key === 'cpuColumns') {
                // Sum all CPU columns
                row.cpuTotal = 0;
                indexOrArray.forEach(index => {
                    row.cpuTotal += parseFloat(values[ index ]) || 0;
                });
            } else {
                row[ key ] = parseFloat(values[ indexOrArray ]) || 0;
            }
        });

        return row;
    }

    updateMetrics(row) {
        const memoryMB = row.memory || 0;
        const frameTimeMS = row.frameTime;

        if (!frameTimeMS || frameTimeMS <= 0) return;

        const tps = 1000 / frameTimeMS;
        const cpuTotal = row.cpuTotal || 0;
        const cpuPerc = cpuTotal / frameTimeMS * 100;
        // console.log(cpuPerc)

        this.#dataStore.incrementRateCounter('TPS', 1, row.time)

        // Sample CPU data every 10th measurement
        this.#sampleCounter++;
        if (this.#sampleCounter % SAMPLE_RATE === 0) {
            this.#dataStore.setNewCounterValue('CPU Time (ms)', cpuTotal, undefined, row.time);
            this.#dataStore.setNewCounterValue('CPU Load %', cpuPerc, undefined, row.time);
            this.#dataStore.setNewCounterValue('Memory Used (MB)', memoryMB, undefined, row.time, true, true);
        }

        this.#dataStore.setNewCounterValue('Player Count', row.playerCount || 0, undefined, row.time, true, true);

        // Build processed data on the fly
        this.#processedData.push({
            index: this.#processedData.length,
            sample: this.#processedData.length,
            memoryMB,
            tps,
            cpuTotal,
            playerCount: row.playerCount || 0
        });
    }

    getDataStore() {
        return this.#dataStore;
    }

    getProcessedData() {
        return this.#processedData;
    }
}

