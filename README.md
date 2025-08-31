# Squad CSV profile to graph (and stuff)

A tool for reading CSV files and generating performance graphs with memory usage and tickrate analysis.

## Usage

```bash
# Process all CSV files in ./input directory
npm run chart

# Process specific file by number
npm run chart 2

# Run with Docker
npm run chart:docker
```

## Directory Structure

- `./input/` - Place CSV files here (supports subdirectories)
  - For comparisons, use subdirectories named `UE4` and `UE5` 
  - Files with same map name will be compared between versions
- `./output/` - Generated charts and JSON stats will be saved here

## Requirements

- Node.js ≥18.0.0