#!/usr/bin/env node

import fs from 'fs';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { createCanvas } from 'canvas';
import { CsvProfileProcessor } from './scripts/multi-file-chart.js';
import ThreeMetricChartGenerator from './src/services/three-metric-chart-generator.js';

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