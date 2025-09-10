import Chart from 'chart.js/auto';
import annotationPlugin from 'chartjs-plugin-annotation';

// Fixed range configuration - set to true to use fixed Y-axis ranges
const USE_FIXED_RANGES = false;

// Fixed range values (when USE_FIXED_RANGES is true)
const FIXED_RANGES = {
    TPS: 75,
    PLAYERS: 125,
    MEMORY_MB: 8192,
    CPU_MS: 150,
    CPU_LOAD_PERC: 110
};

// Flexible 3-metric chart generator
export default class ThreeMetricChartGenerator {
    constructor(canvas, canvasWidth, canvasHeight, data, options = {}) {
        this.basename = options.basename || 'Chart';
        this.titleOverride = options.title || null;
        Chart.defaults.font.size = Math.round(canvasHeight / 50);

        // Get available metrics from the data store
        const availableMetrics = this.detectMetrics(data);
        // console.log('📊 Available metrics:', availableMetrics);

        // Calculate dynamic marker value from TPS data
        const dynamicMarkerValue = this.calculateDynamicMarker(data, availableMetrics);
        // console.log('🎯 Dynamic marker value:', dynamicMarkerValue);

        if (!USE_FIXED_RANGES)
            FIXED_RANGES.TPS = Math.ceil(dynamicMarkerValue / 25) * 25

        // Calculate TPS range and scaling factors
        const scaleInfo = this.calculateScaling(data, availableMetrics);
        // console.log('📏 Scaling info:', scaleInfo);

        // Create datasets for our 3 core metrics with scaling
        const datasets = this.createDatasets(data, availableMetrics, canvasHeight, scaleInfo);

        // Register background gradient plugin
        const backgroundGradient = {
            id: 'backgroundGradient',
            beforeDraw: (chart) => {
                const ctx = chart.canvas.getContext('2d');
                ctx.fillStyle = '#18181a';
                ctx.fillRect(0, 0, chart.width, chart.height);
            }
        };

        // Plugin to add dynamic marker tick
        const dynamicTickPlugin = {
            id: 'dynamicTick',
            afterUpdate: (chart) => {
                const yScale = chart.scales.y;
                if (yScale) {
                    // Check if marker value is not already close to existing ticks
                    const markerValue = dynamicMarkerValue;
                    const shouldAddMarker = !yScale.ticks.some(tick => Math.abs(tick.value - markerValue) < 12.5);

                    if (shouldAddMarker && markerValue >= yScale.min && markerValue <= yScale.max) {
                        // Add the marker value as a tick
                        yScale.ticks.push({ value: markerValue });
                        // Sort ticks by value
                        yScale.ticks.sort((a, b) => a.value - b.value);
                    }
                }
            }
        };

        // Plugin to add signature
        const signaturePlugin = {
            id: 'signature',
            afterDraw: (chart) => {
                const ctx = chart.ctx;
                ctx.save();
                
                // Set signature style
                ctx.fillStyle = '#777';
                ctx.font = `${Math.round(canvasHeight / 70)}px Arial`;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'bottom';
                
                // Draw signature in bottom right corner
                const padding = Math.round(canvasHeight / 80);
                ctx.fillText('Made with ♥ by JetDave', chart.width - padding, chart.height - padding);
                
                ctx.restore();
            }
        };

        Chart.register(backgroundGradient, annotationPlugin, dynamicTickPlugin, signaturePlugin);

        const chartConfig = {
            type: "line",
            data: {
                datasets: datasets
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        left: canvasHeight / 20,
                        right: canvasHeight / 20,
                        top: canvasHeight / 40,
                        bottom: canvasHeight / 40
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        display: true,
                        title: {
                            display: true,
                            text: 'Time (minutes)',
                            color: '#FFFFFF',
                            font: { size: Math.round(canvasHeight / 60) }
                        },
                        ticks: {
                            color: '#FFFFFF',
                            callback: function (value) {
                                const minutes = Math.round(value / 60000);
                                return minutes;
                            }
                        },
                        afterBuildTicks: function(scale) {
                            const min = scale.min;
                            const max = scale.max;
                            const duration = max - min;
                            const interval = 300000; // 10 minutes in ms
                            
                            const ticks = [];
                            
                            // Generate ticks at 10-minute intervals
                            for (let i = 0; i <= Math.ceil(duration / interval); i++) {
                                const tickValue = min + (i * interval);
                                if (tickValue <= max) {
                                    ticks.push({ value: tickValue });
                                }
                            }
                            
                            // Always include the max value if it's not already included
                            const lastTick = ticks[ticks.length - 1];
                            if (!lastTick || lastTick.value < max) {
                                ticks.push({ value: max });
                            }
                            
                            scale.ticks = ticks;
                        },
                        grid: {
                            color: '#FFFFFF22'
                        },
                        min: data.getTimePoints()[ 0 ],
                        max: data.getTimePoints()[ data.getTimePoints().length - 1 ]
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        min: 0,
                        max: scaleInfo.yMax,
                        title: {
                            display: true,
                            text: 'Tick Rate, Player Count',
                            color: '#CCCCCC',
                            font: { size: Math.round(canvasHeight / 40) }
                        },
                        ticks: {
                            color: '#CCCCCC',
                            stepSize: 5,
                            callback: function (value) {
                                const tpsVal = value.toFixed(0);
                                const playerVal = (value / scaleInfo.playerScale).toFixed(0);

                                // Highlight the dynamic marker value
                                if (Math.abs(value - dynamicMarkerValue) < 0.5) {
                                    return `${dynamicMarkerValue.toFixed(1)} TPS ★ | ${playerVal}p`;
                                }

                                return `${tpsVal} TPS | ${playerVal}p`;
                            }
                        },
                        grid: {
                            color: '#4ECDC433'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        min: 0,
                        max: scaleInfo.yMax,
                        title: {
                            display: true,
                            text: 'Memory, CPU',
                            color: '#CCCCCC',
                            font: { size: Math.round(canvasHeight / 40) }
                        },
                        ticks: {
                            color: '#CCCCCC',
                            callback: function (value) {
                                // Show memory, CPU and player values for this scale point
                                const memoryVal = (value / scaleInfo.memoryScale).toFixed(0);
                                const cpuVal = (value / scaleInfo.cpuTimeScale).toFixed(1);
                                // const cpuPerc = (value / scaleInfo.cpuLoadScale).toFixed(1);
                                return `${memoryVal}MB | ${cpuVal}ms`;
                            }
                        },
                        grid: {
                            display: false
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#FFFFFF',
                            font: { size: Math.round(canvasHeight / 70) },
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    annotation: {
                        annotations: {
                            dynamicTpsLine: {
                                type: 'line',
                                yMin: dynamicMarkerValue,
                                yMax: dynamicMarkerValue,
                                borderColor: '#FFD700',
                                borderWidth: 1,
                                borderDash: [ 5, 5 ],
                                label: {
                                    content: `${dynamicMarkerValue.toFixed(1)} TPS Avg (0-1)`,
                                    enabled: true,
                                    position: 'end',
                                    backgroundColor: 'rgba(255, 215, 0, 0.8)',
                                    color: '#000000',
                                    font: {
                                        size: Math.round(canvasHeight / 80)
                                    }
                                }
                            }
                        }
                    },
                    title: {
                        display: true,
                        text: this.titleOverride || `${this.basename}`,
                        color: '#FFFFFF',
                        font: {
                            size: Math.round(canvasHeight / 40),
                            weight: 'bold'
                        },
                        padding: 20
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#FFFFFF',
                        bodyColor: '#FFFFFF',
                        borderColor: '#FFFFFF',
                        borderWidth: 1,
                        callbacks: {
                            title: function (tooltipItems) {
                                return `${tooltipItems[ 0 ].label}`;
                            },
                            label: function (context) {
                                const datasetLabel = context.dataset.label;
                                const value = context.parsed.y;

                                if (datasetLabel.includes('Memory')) {
                                    const actualValue = value / scaleInfo.memoryScale;
                                    return `Memory: ${actualValue.toFixed(0)} MB`;
                                } else if (datasetLabel.includes('CPU')) {
                                    const actualValue = value / scaleInfo.cpuTimeScale;
                                    return `CPU: ${actualValue.toFixed(2)} ms`;
                                } else if (datasetLabel.includes('Player')) {
                                    const actualValue = value / scaleInfo.playerScale;
                                    return `Players: ${actualValue.toFixed(0)}`;
                                } else if (datasetLabel.includes('TPS')) {
                                    return `TPS: ${value.toFixed(1)}`;
                                }
                                return `${datasetLabel}: ${value.toFixed(2)}`;
                            }
                        }
                    }
                },
                elements: {
                    line: {
                        tension: 0.1
                    },
                    point: {
                        radius: 1,
                        hoverRadius: 4
                    }
                }
            }
        };

        return new Chart(canvas, chartConfig);
    }

    detectMetrics(data) {
        // Get all available counter keys from the data store
        const allKeys = [
            ...data.counters.keys(),
            ...(data.numericalCounters?.keys() || []),
            ...(data.rateCounters?.keys() || [])
        ];

        const metrics = {
            memory: null,
            tps: null,
            cpuTime: null,
            // cpuPerc: null,
            frameTime: null,
            playerCount: null
        };

        // Detect memory metrics
        const memoryKeys = allKeys.filter(key =>
            key.toLowerCase().includes('memory') && key.toLowerCase().includes('mb')
        );
        if (memoryKeys.length > 0) metrics.memory = memoryKeys[ 0 ];

        // Detect TPS metrics
        const tpsKeys = allKeys.filter(key =>
            key.toLowerCase().includes('tps')
        );
        if (tpsKeys.length > 0) metrics.tps = tpsKeys[ 0 ];

        // Detect CPU time metrics
        const cpuLoadKeys = allKeys.filter(key =>
            key.toLowerCase().includes('cpu') && key.toLowerCase().includes('ms')
        );
        if (cpuLoadKeys.length > 0) metrics.cpuTime = cpuLoadKeys[ 0 ];

        // Detect CPU perc metrics
        // const cpuPercKeys = allKeys.filter(key =>
        //     key.toLowerCase().includes('cpu') && key.toLowerCase().includes('%')
        // );
        // if (cpuPercKeys.length > 0) metrics.cpuPerc = cpuPercKeys[ 0 ];

        // Detect FrameTime (for TPS calculation)
        const frameTimeKeys = allKeys.filter(key =>
            key.toLowerCase().includes('frame') && key.toLowerCase().includes('time')
        );
        if (frameTimeKeys.length > 0) metrics.frameTime = frameTimeKeys[ 0 ];

        // Detect Player Count metrics
        const playerCountKeys = allKeys.filter(key =>
            key.toLowerCase().includes('player') && key.toLowerCase().includes('count')
        );
        if (playerCountKeys.length > 0) metrics.playerCount = playerCountKeys[ 0 ];

        return metrics;
    }

    calculateScaling(data, metrics) {
        if (USE_FIXED_RANGES) {
            // Use fixed ranges instead of dynamic scaling
            const yMax = FIXED_RANGES.TPS;

            // Calculate scaling factors to map fixed ranges to the TPS scale
            const memoryScale = yMax / FIXED_RANGES.MEMORY_MB;
            const cpuTimeScale = /*yMax /*/ FIXED_RANGES.CPU_MS;
            const playerScale = yMax / FIXED_RANGES.PLAYERS;

            return {
                yMax,
                memoryScale,
                cpuTimeScale,
                playerScale,
                maxTPS: FIXED_RANGES.TPS,
                originalMemoryMax: FIXED_RANGES.MEMORY_MB,
                originalCPUMax: FIXED_RANGES.CPU_MS,
                originalPlayerMax: FIXED_RANGES.PLAYERS
            };
        }

        // Dynamic scaling (original behavior)
        // Get TPS data to determine primary scale
        let tpsData = [];

        if (metrics.tps) {
            tpsData = data.getCounterData(metrics.tps) || [];
        } else if (metrics.frameTime) {
            const frameTimeData = data.getCounterData(metrics.frameTime) || [];
            tpsData = frameTimeData.map(point => ({
                x: point.x,
                y: point.y > 0 ? 1000 / point.y : 0
            }));
        }

        if (tpsData.length === 0) {
            // Fallback if no TPS data
            return {
                yMax: FIXED_RANGES.TPS,
                memoryScale: FIXED_RANGES.MEMORY_MB,
                cpuTimeScale: FIXED_RANGES.CPU_MS,
                playerScale: FIXED_RANGES.PLAYERS
            };
        }

        // Calculate max TPS
        const maxTPS = Math.max(...tpsData.map(d => d.y));

        // Find closest multiple of 50 greater than maxTPS
        const yMax = Math.ceil(maxTPS / 50) * 50;

        // Calculate scaling factors for Memory, CPU, and Player Count
        const memoryData = data.getCounterData(metrics.memory) || [];
        const cpuData = data.getCounterData(metrics.cpuTime) || [];
        const playerData = data.getCounterData(metrics.playerCount) || [];

        let memoryScale = 1; // Default scale
        let cpuTimeScale = 1;     // Default scale
        let playerScale = 1;   // Default scale

        if (memoryData.length > 0) {
            const maxMemory = Math.max(...memoryData.map(d => d.y));
            // Scale memory to fit within yMax range (use about 80% of range)
            memoryScale = (yMax * 0.8) / maxMemory;
        }

        if (false && cpuData.length > 0) {
            const maxCPU = Math.max(...cpuData.map(d => d.y));
            // Scale CPU to fit within yMax range (use about 60% of range)
            cpuTimeScale = (yMax * 0.3) / maxCPU;
        }

        if (playerData.length > 0) {
            const maxPlayers = Math.max(...playerData.map(d => d.y));
            // Scale player count to fit within yMax range (use about 40% of range)
            playerScale = (yMax * 0.4) / maxPlayers;
        }

        return {
            yMax,
            memoryScale,
            cpuTimeScale,
            playerScale,
            maxTPS,
            originalMemoryMax: memoryData.length > 0 ? Math.max(...memoryData.map(d => d.y)) : 0,
            originalCPUMax: cpuData.length > 0 ? Math.max(...cpuData.map(d => d.y)) : 0,
            originalPlayerMax: playerData.length > 0 ? Math.max(...playerData.map(d => d.y)) : 0
        };
    }

    createDatasets(data, metrics, canvasHeight, scaleInfo) {
        const datasets = [];
        const borderWidth = Math.ceil(canvasHeight / 500);


        // Player Count Dataset (scaled)
        if (metrics.playerCount) {
            const maxTime = data.getTimePoints()[ data.getTimePoints().length - 1 ];
            const playerData = data.getCounterDataExtended(metrics.playerCount, maxTime) || [];
            if (playerData.length > 0) {
                // Scale player count to fit TPS range
                const scaledPlayerData = playerData.map(point => ({
                    x: point.x,
                    y: point.y * scaleInfo.playerScale
                }));

                datasets.push({
                    label: 'Player Count',
                    data: scaledPlayerData,
                    borderColor: '#C6C',
                    backgroundColor: '#9B59B622',
                    borderWidth: borderWidth,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: false,
                    yAxisID: 'y',
                    stepped: 'before'
                });
            }
        }
        // Memory Dataset (scaled)
        if (metrics.memory) {
            const memoryData = data.getCounterData(metrics.memory) || [];
            if (memoryData.length > 0) {
                // Scale memory data to fit TPS range
                const scaledMemoryData = memoryData.map(point => ({
                    x: point.x,
                    y: point.y * scaleInfo.memoryScale
                }));

                datasets.push({
                    label: 'Memory Usage (MB)',
                    data: scaledMemoryData,
                    borderColor: '#F36',
                    backgroundColor: '#FF6B6B22',
                    borderWidth: borderWidth,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: false,
                    yAxisID: 'y1',
                    // stepped: 'before'
                });
            }
        }

        // TPS Dataset
        if (metrics.tps) {
            const maxTime = data.getTimePoints()[ data.getTimePoints().length - 1 ];
            const tpsData = data.getCounterDataExtended(metrics.tps, maxTime) || [];
            if (tpsData.length > 0) {
                datasets.push({
                    label: 'Tick Rate (TPS)',
                    data: tpsData,
                    borderColor: '#4ECDC4',
                    backgroundColor: '#4ECDC422',
                    borderWidth: borderWidth,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: false,
                    yAxisID: 'y',
                    // stepped: 'before'
                });
            }
        }

        // CPU Perc Dataset (scaled)
        if (metrics.cpuPerc) {
            const maxTime = data.getTimePoints()[ data.getTimePoints().length - 1 ];
            const cpuData = data.getCounterDataExtended(metrics.cpuPerc, maxTime) || [];
            if (cpuData.length > 0) {
                // Scale CPU data to fit TPS range
                const scaledCPUData = cpuData.map(point => ({
                    x: point.x,
                    y: point.y * scaleInfo.cpuLoadScale
                }));

                datasets.push({
                    label: 'CPU Load (%)',
                    data: scaledCPUData,
                    borderColor: '#F92',
                    backgroundColor: '#F7931E22',
                    borderWidth: borderWidth,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: false,
                    yAxisID: 'y1',
                    // stepped: 'before'
                });
            }
        }

        // CPU Time Dataset (scaled)
        if (metrics.cpuTime) {
            const maxTime = data.getTimePoints()[ data.getTimePoints().length - 1 ];
            const cpuData = data.getCounterDataExtended(metrics.cpuTime, maxTime) || [];
            if (cpuData.length > 0) {
                // Scale CPU data to fit TPS range
                const scaledCPUData = cpuData.map(point => ({
                    x: point.x,
                    y: point.y * scaleInfo.cpuTimeScale
                }));

                datasets.push({
                    label: 'CPU Time (ms)',
                    data: scaledCPUData,
                    borderColor: '#C60',
                    backgroundColor: '#F7931E22',
                    borderWidth: borderWidth,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: false,
                    yAxisID: 'y1',
                    // stepped: 'before'
                });
            }
        }

        // If no specific metrics found, show any available data
        if (datasets.length === 0) {
            console.log('⚠️  No standard metrics found, showing available data...');
            const allKeys = [ ...data.counters.keys() ];
            const colors = [ '#FF6B6B', '#4ECDC4', '#F7931E', '#45B7D1', '#96CEB4' ];

            allKeys.slice(0, 5).forEach((key, index) => {
                const keyData = data.getCounterData(key) || [];
                if (keyData.length > 0) {
                    datasets.push({
                        label: key,
                        data: keyData,
                        borderColor: colors[ index % colors.length ],
                        backgroundColor: colors[ index % colors.length ] + '22',
                        borderWidth: borderWidth,
                        pointRadius: 0,
                        pointHoverRadius: 3,
                        fill: false,
                        yAxisID: 'y'
                    });
                }
            });
        }

        return datasets;
    }

    calculateDynamicMarker(data, metrics) {
        // Get TPS data for samples 0 and 1
        let tpsData = [];

        if (metrics.tps) {
            tpsData = data.getCounterData(metrics.tps) || [];
        } else if (metrics.frameTime) {
            const frameTimeData = data.getCounterData(metrics.frameTime) || [];
            tpsData = frameTimeData.map(point => ({
                x: point.x,
                y: point.y > 0 ? 1000 / point.y : 0
            }));
        }

        if (tpsData.length < 2) {
            // Fallback to 64 if not enough data
            return 64;
        }

        // Get samples 0 and 1 (first two data points)
        const sample0 = tpsData[ 0 ] ? tpsData[ 0 ].y : 0;
        const sample1 = tpsData[ 1 ] ? tpsData[ 1 ].y : 0;

        // Calculate average between samples 0 and 1
        const average = (sample0 + sample1) / 2;

        // Return the average, or fallback to 64 if invalid
        return average > 0 ? average : 64;
    }
}