// Show error message
function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    document.getElementById('loading').style.display = 'none';
    console.error(message);
}

const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            osm: {
                type: 'raster',
                tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256
            }
        },
        layers: [
            {
                id: 'osm-layer',
                type: 'raster',
                source: 'osm',
                minzoom: 0,
                maxzoom: 19,
                paint: {
                    'raster-opacity': 0.7
                }
            }
        ]
    },
    center: [12, 53],  // Center map over Europe
    zoom: 2.9,
    pitch: 40,         // Enable 3D view
    bearing: 0,
    antialias: true
});

// Add Navigation Controls
map.addControl(new maplibregl.NavigationControl());

// Add Scale Control
map.addControl(new maplibregl.ScaleControl({
    maxWidth: 100,
    unit: 'metric'
}), 'bottom-right');

// Store extrusion states
const extrusionState = {};
const COLOR_SCALE = {
    low: '#feebe2',
    mediumLow: '#fbb4b9',
    medium: '#f768a1',
    mediumHigh: '#c51b8a',
    high: '#7a0177'
};

function getColorScale() {
    return [
    'step', ['coalesce', ['get', 'Alcohol'], 0],
    COLOR_SCALE.low, 16, COLOR_SCALE.mediumLow, 20, COLOR_SCALE.medium, 24, COLOR_SCALE.mediumHigh, 28, COLOR_SCALE.high
    ];
}

// Store all year data
const yearData = {};
let allYears = [];
let currentYear = 1990;
let isPlaying = false;
let animationInterval;
let speed = 5; // Default speed (1-10)
let trendChart = null;
let selectedCountry = null; // Track selected country

map.on('load', () => {
    // Load data for all years
    const yearPromises = [];
    
    // Generate years from 1990 to 2019
    for (let year = 1990; year <= 2019; year++) {
        yearPromises.push(
            fetch(`./eu_${year}.geojson`)
                .then(response => {
                    if (!response.ok) throw new Error(`Failed to load ${year} data: ${response.status}`);
                    return response.json();
                })
                .then(data => {
                    if (!data || !data.features || !data.features.length) {
                        console.warn(`${year} data is empty or invalid`);
                        return null;
                    }
                    yearData[year] = data;
                    return year;
                })
                .catch(error => {
                    console.error(`Failed to load ${year} data: ${error.message}`);
                    return null;
                })
        );
    }

    Promise.all(yearPromises).then(loadedYears => {
        // Filter out null values (failed loads)
        allYears = loadedYears.filter(year => year !== null).sort((a, b) => a - b);
        
        if (allYears.length === 0) {
            showError("No data could be loaded. Please check your data files or network connection.");
            return;
        }

        console.log('Data loaded successfully for years:', allYears);
        document.getElementById('loading').style.display = 'none';
        
        // Initialize with first available year
        currentYear = allYears[0];
        updateYearDisplay();
        
        // Add source for current year
        map.addSource('current-data', {
            type: 'geojson',
            data: yearData[currentYear],
            promoteId: 'NAME_ENGL'
        });

        // Color scale with fallback for missing Alcohol values
        const colorScale = getColorScale();

        // Add fill layer
        map.addLayer({
            id: 'data-fill',
            type: 'fill',
            source: 'current-data',
            paint: {
                'fill-color': colorScale,
                'fill-opacity': 1,
                'fill-outline-color': '#000'
            }
        });

        // Add extrusion layer
        map.addLayer({
            id: 'data-extrusion',
            type: 'fill-extrusion',
            source: 'current-data',
            paint: {
                'fill-extrusion-color': colorScale,
                'fill-extrusion-height': [
                    '*', ['coalesce', ['get', 'Alcohol'], 0], 10000
                ], // Initial height based on Alcohol * 10000
                'fill-extrusion-opacity': 1,
                'fill-extrusion-translate': [0, 0],
                'fill-extrusion-translate-anchor': 'map',
                'fill-extrusion-base': 1,
                'fill-extrusion-vertical-gradient': true
            }
        });

        // Set up timelapse controls
        setupTimelapseControls();
        
        // Set up click interaction for extrusion
        setupExtrusionInteraction();

        // Initialize trend chart
        initializeTrendChart();

    }).catch(error => {
        showError(`Error loading data: ${error.message}`);
    });
});

map.on('error', (e) => {
    showError(`Map error: ${e.error.message}`);
});

function setupTimelapseControls() {
    const playButton = document.getElementById('play-button');
    const yearSlider = document.getElementById('year-slider');
    const speedSlider = document.getElementById('speed-slider');
    const showStatsButton = document.getElementById('show-stats-button');
    //const refreshMapButton = document.getElementById('refresh-map-button');
    const toggle3DButton = document.getElementById('toggle-3d-button');
    const chartContainer = document.getElementById('chart-container');
    const decreaseYearButton = document.getElementById('decrease-year');
    const increaseYearButton = document.getElementById('increase-year');
    
    // Set slider min/max based on available years
    yearSlider.min = allYears[0];
    yearSlider.max = allYears[allYears.length - 1];
    yearSlider.value = currentYear;
    
    // Play/Pause button
    playButton.addEventListener('click', () => {
        isPlaying = !isPlaying;
        playButton.textContent = isPlaying ? 'Pause' : 'Play';
        
        if (isPlaying) {
            startAnimation();
        } else {
            stopAnimation();
        }
    });
    
    // Year slider
    yearSlider.addEventListener('input', () => {
        currentYear = parseInt(yearSlider.value);
        updateYearDisplay();
        updateMapData();
    });
    
    // Speed slider
    speedSlider.oninput = function() {
        var output = document.getElementById("speed-value");
        output.innerHTML = `${speedSlider.value}x`; // Display the selected speed value with 'x'
    };

    speedSlider.addEventListener('input', () => {
        speed = parseInt(speedSlider.value);

        if (isPlaying) {
            clearInterval(animationInterval);
            const delay = 1100 - (speed * 100); // Adjust delay based on speed
            animationInterval = setInterval(() => {
                const currentIndex = allYears.indexOf(currentYear);
                const nextIndex = (currentIndex + 1) % allYears.length;

                if (nextIndex === 0) {
                    currentYear = allYears[0];
                    stopAnimation();
                    document.getElementById('play-button').textContent = 'Play';
                } else {
                    currentYear = allYears[nextIndex];
                }

                document.getElementById('year-slider').value = currentYear;
                updateYearDisplay();
                updateMapData();
            }, delay);
        }
    });

    // Decrease year button
    decreaseYearButton.addEventListener('click', () => {
        const currentIndex = allYears.indexOf(currentYear);
        if (currentIndex > 0) {
            currentYear = allYears[currentIndex - 1];
            yearSlider.value = currentYear;
            updateYearDisplay();
            updateMapData();
        }
    });

    // Increase year button
    increaseYearButton.addEventListener('click', () => {
        const currentIndex = allYears.indexOf(currentYear);
        if (currentIndex < allYears.length - 1) {
            currentYear = allYears[currentIndex + 1];
            yearSlider.value = currentYear;
            updateYearDisplay();
            updateMapData();
        }
    });

    // Show statistics button
    showStatsButton.addEventListener('click', () => {
        const chartContainer = document.getElementById('chart-container');
        const button = document.getElementById('show-stats-button');

        if (chartContainer.style.display === 'none') {
            chartContainer.style.display = 'block';
            button.textContent = 'Hide Statistics 📉';
        } else {
            chartContainer.style.display = 'none';
            button.textContent = 'Show Statistics 📉';
        }
    });

    // Toggle 3D view button
    toggle3DButton.addEventListener('click', () => {
        const button = document.getElementById('toggle-3d-button');
        const is3DEnabled = map.getPaintProperty('data-extrusion', 'fill-extrusion-height') !== 0;

        if (is3DEnabled) {
            // Disable 3D view
            map.setPaintProperty('data-extrusion', 'fill-extrusion-height', 0);
            map.setPaintProperty('data-extrusion', 'fill-extrusion-opacity', 0);
            button.textContent = '2D View 🗺️';
        } else {
            // Enable 3D view
            map.setPaintProperty('data-extrusion', 'fill-extrusion-height', [
                '*', ['coalesce', ['get', 'Alcohol'], 0], 10000
            ]);
            map.setPaintProperty('data-extrusion', 'fill-extrusion-opacity', 1);
            button.textContent = '3D View 🌐';
        }
    });

    // Double-click to clear country selection
    document.getElementById('map').addEventListener('dblclick', () => {
        selectedCountry = null;
        updateTrendChart();
    });
}

function startAnimation() {
    const delay = 1100 - (speed * 100); // Speed ranges from 1 (slow) to 10 (fast)
    
    animationInterval = setInterval(() => {
        const currentIndex = allYears.indexOf(currentYear);
        const nextIndex = (currentIndex + 1) % allYears.length;
        
        if (nextIndex === 0) {
            // Loop back to beginning
            currentYear = allYears[0];
            stopAnimation();
            document.getElementById('play-button').textContent = 'Play';
        } else {
            currentYear = allYears[nextIndex];
        }
        
        document.getElementById('year-slider').value = currentYear;
        updateYearDisplay();
        updateMapData();
    }, delay);
}

function stopAnimation() {
    clearInterval(animationInterval);
    isPlaying = false;
}

function updateYearDisplay() {
    document.getElementById('current-year').textContent = currentYear;
    document.getElementById('map-title').textContent = `Alcohol Use Disorders (${currentYear})`;
}

function updateMapData() {
    if (!yearData[currentYear]) return;
    
    // Update the source data
    map.getSource('current-data').setData(yearData[currentYear]);
    
    // Update trend chart
    updateTrendChart();
}

function setupExtrusionInteraction() {
    // Click handler for both layers
    map.on('click', ['data-fill', 'data-extrusion'], (e) => {
        if (!e.features || e.features.length === 0) return;
        
        const feature = e.features[0];
        const featureId = feature.id || feature.properties?.NAME_ENGL || 'unknown';
        const alcohol = feature.properties?.Alcohol || 0;
        
        // Set the selected country
        selectedCountry = feature.properties?.NAME_ENGL;
        
        // Toggle extrusion
        const isExtruded = !extrusionState[featureId];
        
        // Set extrusion properties
        map.setPaintProperty('data-extrusion', 'fill-extrusion-opacity', isExtruded ? 1 : 0);
        map.setPaintProperty('data-extrusion', 'fill-extrusion-height', [
            'case',
            ['==', ['id'], featureId],
            isExtruded ? alcohol * 10000 : 0,
            0
        ]);
        
        extrusionState[featureId] = isExtruded;
        
        // Show popup
        new maplibregl.Popup({ offset: 25 })
            .setLngLat(e.lngLat)
            .setHTML(`
                <h2>${feature.properties?.NAME_ENGL || 'Unknown'} (${currentYear})</h2>
                <p>Alcohol Use Disorders (${currentYear}): <h3> ${alcohol.toFixed(2)} <small>Cases per 1000 people</small> </h3></p>
                <footer><em>Data: <a href='https://ourworldindata.org/grapher/prevalence-by-mental-and-substance-use-disorder?time=earliest..2019' target="_blank">IHME, Global Burden of Disease (2024) – with major processing by Our World in Data</em></a></footer> <br>
                <footer><small>Click to ${isExtruded ? 'flatten' : 'extrude'}</small></footer>
            `)
            .addTo(map);
        
        // Update the chart with this country's data
        updateTrendChart();
    });
    
    // Change cursor on hover
    map.on('mouseenter', ['data-fill', 'data-extrusion'], () => {
        map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', ['data-fill', 'data-extrusion'], () => {
        map.getCanvas().style.cursor = '';
    });
}

function initializeTrendChart() {
    const ctx = document.getElementById('trend-chart').getContext('2d');

    // Destroy the existing chart instance if it exists
    if (trendChart) {
        trendChart.destroy();
    }

    // Create a new chart instance
    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: allYears, // X-axis: Years
            datasets: [
                {
                    label: 'Mean Alcohol Use Disorders',
                    data: calculateAverageData(),
                    borderColor: '#7a0177',
                    backgroundColor: 'rgba(122, 1, 119, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    hidden: selectedCountry !== null // Hide mean if a country is selected
                },
                {
                    label: selectedCountry || 'Selected Country',
                    data: selectedCountry ? getCountryData(selectedCountry) : [],
                    borderColor: '#ff7f00',
                    backgroundColor: 'rgba(255, 127, 0, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.4,
                    hidden: selectedCountry === null
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true // Show legend
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y.toFixed(2)} cases per 1000 people`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    title: {
                        display: true,
                        text: 'Cases per 1000 people'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Year'
                    }
                }
            }
        }
    });
}

function calculateAverageData() {
    const averages = [];
    
    for (const year of allYears) {
        const data = yearData[year];
        if (!data || !data.features) continue;
        
        let sum = 0;
        let count = 0;
        
        for (const feature of data.features) {
            if (feature.properties && feature.properties.Alcohol !== undefined) {
                sum += feature.properties.Alcohol;
                count++;
            }
        }
        
        averages.push(count > 0 ? sum / count : 0); // Calculate mean
    }
    
    return averages;
}

function getCountryData(countryName) {
    const countryData = [];
    
    for (const year of allYears) {
        const data = yearData[year];
        if (!data || !data.features) continue;
        
        // Find the feature for this country
        const feature = data.features.find(f => 
            f.properties?.NAME_ENGL === countryName
        );
        
        if (feature && feature.properties?.Alcohol !== undefined) {
            countryData.push(feature.properties.Alcohol);
        } else {
            countryData.push(null); // or 0 if you prefer
        }
    }
    
    return countryData;
}

function updateTrendChart() {
    if (!trendChart) return;
    
    // Update datasets
    trendChart.data.datasets[0].data = calculateAverageData();
    trendChart.data.datasets[0].hidden = selectedCountry !== null;
    
    if (selectedCountry) {
        trendChart.data.datasets[1].data = getCountryData(selectedCountry);
        trendChart.data.datasets[1].label = selectedCountry;
        trendChart.data.datasets[1].hidden = false;
    } else {
        trendChart.data.datasets[1].hidden = true;
    }
    
    // Highlight current year
    const yearIndex = allYears.indexOf(currentYear);
    trendChart.data.datasets.forEach(dataset => {
        dataset.pointBackgroundColor = allYears.map((year, index) => 
            index === yearIndex ? dataset.borderColor : 'rgba(0, 0, 0, 0.1)'
        );
    });
    
    trendChart.update();
}
