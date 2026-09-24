let map;

let standardLayer;
let satelliteLayer;

let aircraftMarkers = new Map();

let selectedAircraft = null;
let selectedMarker = null;

let trajectoryLine = null;

let aircraftData = new Map();

let refreshTimer = null;
let isLoading = false;

let userMarker = null;


/* =========================================================
   MAP
========================================================= */

function initMap() {

    map = L.map("map", {
        zoomControl: true,
        preferCanvas: true
    }).setView([31.5, 34.8], 7);


    standardLayer = L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors"
        }
    );


    satelliteLayer = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
            maxZoom: 19,
            attribution: "Tiles &copy; Esri"
        }
    );


    standardLayer.addTo(map);


    L.control.layers(
        {
            "Обычная карта": standardLayer,
            "Спутник": satelliteLayer
        },
        {},
        {
            position: "topright"
        }
    ).addTo(map);


    map.on("moveend", function () {
        loadAircraft();
    });


    map.on("zoomend", function () {
        loadAircraft();
    });


    loadAircraft();

    refreshTimer = setInterval(
        loadAircraft,
        10000
    );
}


/* =========================================================
   AIRCRAFT ICON
========================================================= */

function createAircraftIcon(track, selected = false) {

    const rotation = Number.isFinite(track)
        ? track
        : 0;


    const html = `
        <div
            class="aircraft-marker ${selected ? "selected" : ""}"
            style="transform: rotate(${rotation}deg);"
        >
            <div class="aircraft-icon">
                ✈
            </div>
        </div>
    `;


    return L.divIcon({
        className: "",
        html: html,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -15]
    });
}


/* =========================================================
   LOAD AIRCRAFT
========================================================= */

async function loadAircraft() {

    if (!map || isLoading) {
        return;
    }


    isLoading = true;

    setConnectionStatus(
        "Обновление..."
    );


    try {

        const bounds = map.getBounds();


        const params = new URLSearchParams({

            lamin: bounds.getSouth().toFixed(4),

            lomin: bounds.getWest().toFixed(4),

            lamax: bounds.getNorth().toFixed(4),

            lomax: bounds.getEast().toFixed(4)

        });


        const response = await fetch(
            `/api/radar/states?${params.toString()}`,
            {
                cache: "no-store"
            }
        );


        const data = await response.json();


        if (!response.ok) {

            throw new Error(
                data.error ||
                "Ошибка получения данных"
            );
        }


        aircraftData.clear();


        for (const aircraft of data.aircraft || []) {

            if (
                aircraft.latitude === null ||
                aircraft.longitude === null
            ) {
                continue;
            }


            aircraftData.set(
                aircraft.icao24,
                aircraft
            );
        }


        updateMarkers();


        document.getElementById(
            "aircraftCount"
        ).textContent =
            `${aircraftData.size} воздушных судов в текущей области`;


        setConnectionStatus(
            "Данные получены"
        );

    } catch (error) {

        console.error(
            "Radar error:",
            error
        );


        setConnectionStatus(
            "Ошибка соединения"
        );


        document.getElementById(
            "aircraftCount"
        ).textContent =
            "Не удалось получить данные";


        if (
            error.message &&
            error.message.length
        ) {

            document.getElementById(
                "aircraftInfo"
            ).innerHTML = `
                <div class="error">
                    ${escapeHtml(error.message)}
                </div>
            `;
        }

    } finally {

        isLoading = false;
    }
}


/* =========================================================
   UPDATE MARKERS
========================================================= */

function updateMarkers() {

    const visibleIds = new Set();


    for (const [icao24, aircraft] of aircraftData) {

        visibleIds.add(icao24);


        let marker =
            aircraftMarkers.get(icao24);


        const isSelected =
            selectedAircraft === icao24;


        const icon =
            createAircraftIcon(
                aircraft.true_track,
                isSelected
            );


        if (!marker) {

            marker = L.marker(
                [
                    aircraft.latitude,
                    aircraft.longitude
                ],
                {
                    icon: icon,
                    keyboard: false
                }
            );


            marker.on(
                "click",
                () => selectAircraft(icao24)
            );


            aircraftMarkers.set(
                icao24,
                marker
            );


            marker.addTo(map);

        } else {

            marker.setIcon(icon);

            marker.setLatLng([
                aircraft.latitude,
                aircraft.longitude
            ]);
        }


        marker.bindPopup(
            createPopup(aircraft)
        );
    }


    /*
     * Remove aircraft which are no longer
     * inside the current viewport response.
     */

    for (
        const [icao24, marker]
        of aircraftMarkers
    ) {

        if (
            !visibleIds.has(icao24)
        ) {

            map.removeLayer(marker);

            aircraftMarkers.delete(
                icao24
            );
        }
    }
}


/* =========================================================
   POPUP
========================================================= */

function createPopup(aircraft) {

    const callsign =
        aircraft.callsign ||
        "Без позывного";


    return `
        <div>

            <div class="popup-title">
                ✈ ${escapeHtml(callsign)}
            </div>

            <div class="popup-line">
                ICAO24:
                ${escapeHtml(aircraft.icao24)}
            </div>

            <div class="popup-line">
                Высота:
                ${formatAltitude(aircraft.altitude)}
            </div>

            <div class="popup-line">
                Скорость:
                ${formatSpeed(aircraft.velocity)}
            </div>

            <div class="popup-line">
                Курс:
                ${formatTrack(aircraft.true_track)}
            </div>

        </div>
    `;
}


/* =========================================================
   SELECT AIRCRAFT
========================================================= */

async function selectAircraft(icao24) {

    const aircraft =
        aircraftData.get(icao24);


    if (!aircraft) {
        return;
    }


    selectedAircraft = icao24;


    if (selectedMarker) {

        const previousAircraft =
            aircraftData.get(
                selectedMarker._radarIcao24
            );

        if (previousAircraft) {

            selectedMarker.setIcon(
                createAircraftIcon(
                    previousAircraft.true_track,
                    false
                )
            );
        }
    }


    selectedMarker =
        aircraftMarkers.get(icao24);


    if (selectedMarker) {

        selectedMarker._radarIcao24 =
            icao24;

        selectedMarker.setIcon(
            createAircraftIcon(
                aircraft.true_track,
                true
            )
        );

        selectedMarker.openPopup();
    }


    showAircraftInfo(
        aircraft
    );


    await loadTrajectory(
        icao24
    );
}


/* =========================================================
   AIRCRAFT INFO
========================================================= */

function showAircraftInfo(
    aircraft
) {

    const callsign =
        aircraft.callsign ||
        "Не указан";


    const altitude =
        formatAltitude(
            aircraft.altitude
        );


    const geoAltitude =
        formatAltitude(
            aircraft.geo_altitude
        );


    const speed =
        formatSpeed(
            aircraft.velocity
        );


    const track =
        formatTrack(
            aircraft.true_track
        );


    const verticalRate =
        formatVerticalRate(
            aircraft.vertical_rate
        );


    const status =
        aircraft.on_ground
            ? "На земле"
            : "В воздухе";


    document.getElementById(
        "aircraftInfo"
    ).innerHTML = `

        <div class="aircraft-name">
            ✈ ${escapeHtml(callsign)}
        </div>

        <div class="callsign">
            ICAO24: ${escapeHtml(aircraft.icao24)}
        </div>

        <div class="info-grid">

            <div class="info">
                <div class="info-label">
                    Страна
                </div>

                <div class="info-value">
                    ${escapeHtml(
                        aircraft.origin_country ||
                        "—"
                    )}
                </div>
            </div>


            <div class="info">
                <div class="info-label">
                    Статус
                </div>

                <div class="info-value">
                    ${status}
                </div>
            </div>


            <div class="info">
                <div class="info-label">
                    Высота
                </div>

                <div class="info-value">
                    ${altitude}
                </div>
            </div>


            <div class="info">
                <div class="info-label">
                    Геометрическая
                </div>

                <div class="info-value">
                    ${geoAltitude}
                </div>
            </div>


            <div class="info">
                <div class="info-label">
                    Скорость
                </div>

                <div class="info-value">
                    ${speed}
                </div>
            </div>


            <div class="info">
                <div class="info-label">
                    Курс
                </div>

                <div class="info-value">
                    ${track}
                </div>
            </div>


            <div class="info wide">
                <div class="info-label">
                    Вертикальная скорость
                </div>

                <div class="info-value">
                    ${verticalRate}
                </div>
            </div>


            <div class="info wide">
                <div class="info-label">
                    Координаты
                </div>

                <div class="info-value">
                    ${Number(
                        aircraft.latitude
                    ).toFixed(5)},
                    ${Number(
                        aircraft.longitude
                    ).toFixed(5)}
                </div>
            </div>

        </div>

        <button
            class="track-button primary"
            onclick="loadTrajectory('${escapeJs(aircraft.icao24)}')"
        >
            🛫 Показать траекторию
        </button>
    `;
}


/* =========================================================
   TRAJECTORY
========================================================= */

async function loadTrajectory(
    icao24
) {

    try {

        if (trajectoryLine) {

            map.removeLayer(
                trajectoryLine
            );

            trajectoryLine = null;
        }


        const response =
            await fetch(
                `/api/radar/track/${encodeURIComponent(icao24)}`,
                {
                    cache: "no-store"
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.error ||
                "Не удалось загрузить траекторию"
            );
        }


        const path =
            data.path || [];


        const coordinates =
            path
                .filter(
                    point =>
                        point.latitude !== null &&
                        point.longitude !== null
                )
                .map(
                    point => [
                        point.latitude,
                        point.longitude
                    ]
                );


        if (coordinates.length < 2) {

            console.log(
                "Для этого самолёта пока недостаточно точек траектории."
            );

            return;
        }


        trajectoryLine =
            L.polyline(
                coordinates,
                {
                    color: "#ffcc33",
                    weight: 4,
                    opacity: 0.9
                }
            ).addTo(map);


        /*
         * The selected aircraft remains visible
         * while its trajectory is highlighted.
         */

    } catch (error) {

        console.error(
            "Track error:",
            error
        );
    }
}


/* =========================================================
   CENTER ON USER
========================================================= */

function centerOnMe() {

    if (
        !navigator.geolocation
    ) {

        alert(
            "Ваш браузер не поддерживает геолокацию."
        );

        return;
    }


    navigator.geolocation.getCurrentPosition(

        position => {

            const lat =
                position.coords.latitude;

            const lon =
                position.coords.longitude;


            if (userMarker) {

                userMarker.setLatLng([
                    lat,
                    lon
                ]);

            } else {

                userMarker =
                    L.circleMarker(
                        [lat, lon],
                        {
                            radius: 8,
                            color: "#ffffff",
                            weight: 3,
                            fillColor: "#1677ff",
                            fillOpacity: 1
                        }
                    ).addTo(map);

                userMarker.bindPopup(
                    "📍 Ваше местоположение"
                );
            }


            map.setView(
                [lat, lon],
                Math.max(
                    map.getZoom(),
                    8
                )
            );

        },

        error => {

            console.error(
                error
            );

            alert(
                "Не удалось получить ваше местоположение."
            );
        },

        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 10000
        }
    );
}


/* =========================================================
   REFRESH
========================================================= */

function refreshAircraft() {

    loadAircraft();
}


/* =========================================================
   CONNECTION STATUS
========================================================= */

function setConnectionStatus(
    text
) {

    const element =
        document.getElementById(
            "connectionStatus"
        );


    if (element) {
        element.textContent =
            text;
    }
}


/* =========================================================
   FORMATTERS
========================================================= */

function formatAltitude(
    meters
) {

    if (
        meters === null ||
        meters === undefined ||
        !Number.isFinite(
            Number(meters)
        )
    ) {
        return "—";
    }


    const m =
        Number(meters);


    const feet =
        m * 3.28084;


    return `${Math.round(m).toLocaleString()} м / ${Math.round(feet).toLocaleString()} ft`;
}


function formatSpeed(
    metersPerSecond
) {

    if (
        metersPerSecond === null ||
        metersPerSecond === undefined ||
        !Number.isFinite(
            Number(metersPerSecond)
        )
    ) {
        return "—";
    }


    const kmh =
        Number(
            metersPerSecond
        ) * 3.6;


    const knots =
        Number(
            metersPerSecond
        ) * 1.94384;


    return `${Math.round(kmh)} км/ч / ${Math.round(knots)} kt`;
}


function formatTrack(
    degrees
) {

    if (
        degrees === null ||
        degrees === undefined ||
        !Number.isFinite(
            Number(degrees)
        )
    ) {
        return "—";
    }


    return `${Math.round(
        Number(degrees)
    )}°`;
}


function formatVerticalRate(
    metersPerSecond
) {

    if (
        metersPerSecond === null ||
        metersPerSecond === undefined ||
        !Number.isFinite(
            Number(metersPerSecond)
        )
    ) {
        return "—";
    }


    const fpm =
        Number(
            metersPerSecond
        ) * 196.8504;


    return `${Number(
        metersPerSecond
    ).toFixed(1)} м/с / ${Math.round(
        fpm
    )} ft/min`;
}


/* =========================================================
   SECURITY HELPERS
========================================================= */

function escapeHtml(
    value
) {

    return String(
        value ?? ""
    )
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


function escapeJs(
    value
) {

    return String(
        value ?? ""
    )
        .replaceAll("\\", "\\\\")
        .replaceAll("'", "\\'");
}


/* =========================================================
   START
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        initMap();

    }
);
