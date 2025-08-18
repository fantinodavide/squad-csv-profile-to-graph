#!/usr/bin/env node

import fs from 'fs';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { createCanvas } from 'canvas';
import { EventEmitter } from 'events';
import DataStore from '../src/services/data-store.js';
import ThreeMetricChartGenerator from '../src/services/three-metric-chart-generator.js';

const SAMPLE_RATE = 500;

class CsvProfileProcessor extends EventEmitter {
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

async function generateMultiFileChart() {
    console.log('📊 Multi-File 3-Metric Chart Generator\n');

    try {
        // Get input files
        const inputDir = './input';
        const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.csv'));
        if (files.length === 0) throw new Error('No CSV files found');

        console.log(`📁 Found ${files.length} CSV file(s):`);
        files.forEach((file, index) => console.log(`   ${index + 1}. ${file}`));

        // Process files based on command line argument
        const args = process.argv.slice(2);

        if (args.length > 0) {
            // Specific file selected
            const fileIndex = parseInt(args[ 0 ]) - 1;
            if (fileIndex >= 0 && fileIndex < files.length) {
                const selectedFile = files[ fileIndex ];
                console.log(`\n✅ Selected file ${fileIndex + 1}: ${selectedFile}`);
                await processSingleFile(inputDir, selectedFile);
            } else {
                console.log(`\n⚠️  Invalid file number ${args[ 0 ]}, processing all files`);
                await processAllFiles(inputDir, files);
            }
        } else {
            // Default: process all files
            console.log(`\n📊 Processing all ${files.length} file(s) (use: npm run chart [file_number] to select specific file)`);
            await processAllFiles(inputDir, files);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

async function processAllFiles(inputDir, files) {
    console.log('🔄 Starting batch processing...\n');

    const results = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[ i ];
        console.log(`📊 [${i + 1}/${files.length}] Processing: ${file}`);

        try {
            const result = await processSingleFile(inputDir, file, true); // Don't show individual summaries
            results.push(result);
            console.log(`✅ [${i + 1}/${files.length}] Completed: ${result.outputPath}`);
        } catch (error) {
            console.error(`❌ [${i + 1}/${files.length}] Failed: ${file} - ${error.message}`);
            results.push({ file, error: error.message });
        }

        if (i < files.length - 1) console.log(''); // Add spacing between files
    }

}

async function processSingleFile(inputDir, selectedFile, showSummary = true) {
    const basename = selectedFile.replace(/\.csv$/i, '');
    const filePath = `${inputDir}/${selectedFile}`;

    if (showSummary) {
        console.log(`🔄 Processing: ${selectedFile}`);
        console.log('⚡ Generating chart...\n');
    }

    const processor = new CsvProfileProcessor();
    const fileStream = createReadStream(filePath);
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
        processor.processLine(line);
    }

    if (showSummary) console.log('\n');
    const dataStore = processor.getDataStore();
    const tps = dataStore.getRateCounterData('TPS');
    // console.log(tps);
    // console.log('TPS data:', tps.length, 'points');
    // console.log('Memory data:', dataStore.getCounterData('Memory Used (MB)').length, 'points');
    // console.log('CPU data:', dataStore.getCounterData('CPU Total (ms)').length, 'points');

    // Check time alignment
    const memoryData = dataStore.getCounterData('Memory Used (MB)');
    // if (tps.length > 0 && memoryData.length > 0) {
    //     console.log('TPS first X:', tps[ 0 ].x);
    //     console.log('Memory first X:', memoryData[ 0 ].x);
    //     console.log('TPS last X:', tps[ tps.length - 1 ].x);
    //     console.log('Memory last X:', memoryData[ memoryData.length - 1 ].x);
    // }
    // const matchDuration = +tps[ tps.length - 1 ].x - +tps[ 0 ].x
    // const finalTime = processor.time;
    // console.log('\nmatchDuration', matchDuration);
    // console.log('finalTime', finalTime);
    // const tpsValues = new Set(tps.map(p => p.y));
    // console.log('TPS unique values:', tpsValues);

    // Check frame time consistency
    // const memoryTimes = memoryData.slice(0, 100).map(p => p.x);
    // const timeDiffs = [];
    // for (let i = 1; i < memoryTimes.length; i++) {
    //     timeDiffs.push(memoryTimes[ i ] - memoryTimes[ i - 1 ]);
    // }
    // console.log('Frame time diffs (first 100):', new Set(timeDiffs));

    if (showSummary) console.log('🎨 Generating chart...');
    const outputPath = await generateChart(processor, dataStore, basename, selectedFile);

    if (showSummary) {
        console.log('✅ chart generated successfully!');
        console.log(`📊 Chart saved to: ${outputPath}`);
    }

    return {
        file: selectedFile,
        outputPath,
    };
}

async function generateChart(processor, dataStore, basename, filename) {
    const matchDuration = processor.time;
    const maxWidth = 4320;
    const minWidth = 1920;
    const width = Math.min(Math.max(minWidth, Math.floor(matchDuration / 5000000 * maxWidth)), maxWidth);
    const height = 1080;

    // Ensure output directory
    if (!fs.existsSync('./output')) {
        fs.mkdirSync('./output', { recursive: true });
    }

    const canvas = createCanvas(width, height);
    const chart = new ThreeMetricChartGenerator(canvas, width, height, dataStore, { basename });

    const outputFile = `${basename}_readable-chart.png`;
    const outputPath = `./output/${outputFile}`;

    // Save chart
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);

    return outputPath;
}

generateMultiFileChart();